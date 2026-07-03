// POST /api/focus-rooms/[code]/complete — a member claims their finished session.
//
// Payout rules (server-authoritative, all timing trusted from focus_rooms.ends_at
// which /start stamped server-side):
//   - Valid only once the SERVER clock is within COMPLETE_GRACE_MS of ends_at
//     (drift tolerance for clients whose countdown ran a hair fast).
//   - BASE PAY: the solo Focus Lock-In table (25/50/75 Fangs, ledger type
//     `focus_session`) under the SAME daily cap — rows of BOTH types
//     focus_session AND focus_room_bonus count toward MAX 6/day.
//   - GROUP BONUS: +15 Fangs (type `focus_room_bonus`) to every completed
//     member once >= 2 members have completed. Idempotent per member via a
//     compare-and-swap on focus_room_members.bonus_granted.
//
// Idempotency:
//   - Base pay: CAS on `completed` (false -> true) is the claim; the loser of
//     a double-tap race takes the alreadyCompleted path and never re-credits.
//   - Bonus: CAS on `bonus_granted`; the ledger row is inserted BEFORE the
//     balance moves (marker-first, settle_competitive_credit pattern) so a
//     rejected ledger type can never leave an unledgered credit.
//
// FAIL-SOFT (HELD migration 20260702090000 not applied): the focus_room_bonus
// ledger insert fails 23514 -> the CAS is reverted (so a later call can grant
// it), the bonus is skipped, completion still sticks, bonusPending: true rides
// back for honest UI copy. Base pay is unaffected (focus_session is already
// legal in prod — the solo route uses it today).
//
// Re-calling /complete after completion is allowed and cheap: it skips base
// pay and re-runs the bonus pass, which is exactly how pending bonuses get
// retro-granted once Sam applies the ledger migration.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";
import {
  isValidFocusRoomCode,
  normalizeFocusRoomCode,
} from "@/lib/focus-rooms/room-code";
import {
  FANGS_BY_DURATION,
  GROUP_BONUS_FANGS,
  MAX_FOCUS_SESSIONS_PER_DAY,
  FOCUS_CAP_LEDGER_TYPES,
  COMPLETE_GRACE_MS,
  type FocusRoomDuration,
} from "@/lib/focus-rooms/constants";
import {
  isMissingFocusRoomsSchema,
  focusRoomsUnavailableResponse,
} from "@/lib/focus-rooms/schema-guard";
import {
  focusRoomChannel,
  FOCUS_ROOM_EVENTS,
} from "@/lib/focus-rooms/channels";

/** Today's focus payouts (both ledger types) for a user. Null on read error. */
async function focusPayoutsToday(userId: string): Promise<number | null> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  const { count, error } = await supabaseAdmin
    .from("coin_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("type", FOCUS_CAP_LEDGER_TYPES)
    .gte("created_at", `${todayUtc}T00:00:00.000Z`);
  if (error) {
    console.error("[focus-rooms/complete] cap count", error.message);
    return null;
  }
  return count ?? 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  if (isDemoUser(userId)) return demoBlockedResponse();

  const code = normalizeFocusRoomCode(params.code);
  if (!isValidFocusRoomCode(code)) {
    return NextResponse.json({ error: "Invalid room code" }, { status: 400 });
  }

  // ── Room + timing gate ──────────────────────────────────────────────
  // Resolve the newest room with this code WHERE THE CALLER IS A MEMBER
  // (inner join through focus_room_members). A done room frees its code for
  // reuse, so the bare newest-first lookup could hand a slow claimer someone
  // ELSE's newer room and strand their payout ("You're not in this room").
  // Member-scoped resolution means a late /complete always finds THEIR room.
  const { data: roomRows, error: roomErr } = await supabaseAdmin
    .from("focus_rooms")
    .select("id, status, duration_minutes, started_at, ends_at, focus_room_members!inner(user_id)")
    .eq("code", code)
    .eq("focus_room_members.user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (roomErr) {
    if (isMissingFocusRoomsSchema(roomErr)) return focusRoomsUnavailableResponse();
    console.error("[focus-rooms/complete] room lookup", roomErr.message);
    return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
  }
  const room = roomRows?.[0];
  if (!room) {
    // No room of theirs under this code. Distinguish "no such room" (404)
    // from "a room exists but you're not in it" (403, pre-change behavior).
    const { data: anyRooms, error: anyErr } = await supabaseAdmin
      .from("focus_rooms")
      .select("id, status")
      .eq("code", code)
      .order("created_at", { ascending: false })
      .limit(1);
    if (anyErr) {
      if (isMissingFocusRoomsSchema(anyErr)) return focusRoomsUnavailableResponse();
      console.error("[focus-rooms/complete] fallback lookup", anyErr.message);
      return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
    }
    if (anyRooms?.[0] && anyRooms[0].status !== "expired") {
      return NextResponse.json({ error: "You're not in this room." }, { status: 403 });
    }
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.status === "expired") {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (room.status === "lobby" || !room.ends_at) {
    return NextResponse.json({ error: "This session hasn't started." }, { status: 409 });
  }

  const endsAtMs = new Date(room.ends_at).getTime();
  if (!Number.isFinite(endsAtMs)) {
    console.error("[focus-rooms/complete] unparseable ends_at", room.id);
    return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
  }
  const now = Date.now();
  if (now < endsAtMs - COMPLETE_GRACE_MS) {
    return NextResponse.json(
      { error: "The session isn't over yet.", retryInMs: endsAtMs - now },
      { status: 409 },
    );
  }

  const duration = room.duration_minutes as FocusRoomDuration;
  const baseReward = FANGS_BY_DURATION[duration] ?? 0;
  if (baseReward <= 0) {
    console.error("[focus-rooms/complete] unknown duration", room.duration_minutes);
    return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
  }

  // ── Membership ──────────────────────────────────────────────────────
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("focus_room_members")
    .select("user_id, left_at, completed")
    .eq("room_id", room.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberErr) {
    console.error("[focus-rooms/complete] member lookup", memberErr.message);
    return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ error: "You're not in this room." }, { status: 403 });
  }
  if (member.left_at && !member.completed) {
    return NextResponse.json(
      { error: "You left this session early, so there's nothing to claim." },
      { status: 403 },
    );
  }

  let alreadyCompleted = member.completed === true;
  let coinsEarned = 0;
  let capped = false;
  let sessionsToday: number | null = null;

  // ── Base pay (fresh completion only) ────────────────────────────────
  if (!alreadyCompleted) {
    // CAS claim: exactly one request per member flips completed false->true.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("focus_room_members")
      .update({ completed: true })
      .eq("room_id", room.id)
      .eq("user_id", userId)
      .eq("completed", false)
      .is("left_at", null)
      .select("user_id");
    if (claimErr) {
      console.error("[focus-rooms/complete] completion CAS", claimErr.message);
      return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
    }

    if (!claimed || claimed.length === 0) {
      // Lost a double-tap race — the winner is paying. Idempotent path.
      alreadyCompleted = true;
    } else {
      sessionsToday = await focusPayoutsToday(userId);
      if (sessionsToday === null) {
        // Can't verify the cap: revert the claim so a retry can pay, fail honestly.
        await supabaseAdmin
          .from("focus_room_members")
          .update({ completed: false })
          .eq("room_id", room.id)
          .eq("user_id", userId)
          .eq("completed", true);
        return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
      }

      if (sessionsToday >= MAX_FOCUS_SESSIONS_PER_DAY) {
        // Cap hit: completion still counts (it can unlock the group's bonus),
        // the base payout is skipped with honest copy client-side.
        capped = true;
      } else {
        const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
          p_user_id: userId,
          p_delta: baseReward,
          p_min_balance: 0,
          p_source: "cashable",
        });
        if (creditErr) {
          console.error("[focus-rooms/complete] base credit", creditErr.message);
          // Refund-on-downstream-failure: release the claim so a retry pays.
          await supabaseAdmin
            .from("focus_room_members")
            .update({ completed: false })
            .eq("room_id", room.id)
            .eq("user_id", userId)
            .eq("completed", true);
          return NextResponse.json({ error: "Couldn't record the session." }, { status: 500 });
        }
        coinsEarned = baseReward;
        sessionsToday += 1;

        const { error: ledgerErr } = await supabaseAdmin.from("coin_transactions").insert({
          user_id: userId,
          amount: baseReward,
          type: "focus_session",
          reference_id: room.id,
          description: `Focus Room ${code} (${duration} min)`,
        });
        if (ledgerErr) {
          // Balance already moved; never claw it back for an audit-row miss.
          // Log loudly for the reconciler instead (solo route parity).
          console.error("[focus-rooms/complete] base ledger", ledgerErr.message);
        }
      }
    }
  }

  // ── Room terminates on first valid completion (status-guarded) ──────
  await supabaseAdmin
    .from("focus_rooms")
    .update({ status: "done" })
    .eq("id", room.id)
    .eq("status", "running");

  // ── Group bonus pass ────────────────────────────────────────────────
  // Runs on EVERY call (including idempotent re-calls) so pending bonuses
  // retro-grant once the HELD ledger migration lands.
  let bonusFangs = 0;
  let bonusPending = false;
  // Distinct from `capped` (base pay cap-eaten): the caller's base can pay as
  // session #6 and the cap then eats ONLY the bonus. One shared flag made the
  // client claim the whole payout was skipped when the base actually landed.
  let bonusCapped = false;

  const { data: completedMembers, error: completedErr } = await supabaseAdmin
    .from("focus_room_members")
    .select("user_id, bonus_granted")
    .eq("room_id", room.id)
    .eq("completed", true);
  if (completedErr) {
    console.error("[focus-rooms/complete] completed list", completedErr.message);
  }
  const completedCount = completedMembers?.length ?? 0;

  if (completedCount >= 2) {
    for (const cm of completedMembers ?? []) {
      if (cm.bonus_granted) continue;

      // CAS: single-writer claim on this member's bonus.
      const { data: won, error: casErr } = await supabaseAdmin
        .from("focus_room_members")
        .update({ bonus_granted: true })
        .eq("room_id", room.id)
        .eq("user_id", cm.user_id)
        .eq("completed", true)
        .eq("bonus_granted", false)
        .select("user_id");
      if (casErr) {
        console.error("[focus-rooms/complete] bonus CAS", casErr.message);
        continue;
      }
      if (!won || won.length === 0) continue; // another completer's request got it

      const revertCas = async () => {
        await supabaseAdmin
          .from("focus_room_members")
          .update({ bonus_granted: false })
          .eq("room_id", room.id)
          .eq("user_id", cm.user_id)
          .eq("bonus_granted", true);
      };

      // Shared daily cap: bonus rows count toward the same 6/day. A capped
      // member's bonus is consumed unpaid (flag stays true — mirrors the solo
      // route eating a capped session) so it can't be banked for tomorrow.
      const memberPayouts = await focusPayoutsToday(cm.user_id);
      if (memberPayouts === null) {
        await revertCas(); // unknown cap state: leave it grantable later
        continue;
      }
      if (memberPayouts >= MAX_FOCUS_SESSIONS_PER_DAY) {
        if (cm.user_id === userId) bonusCapped = true;
        continue;
      }

      // Ledger FIRST (the type CHECK is the fail-soft gate), then the balance.
      const { data: ledgerRow, error: bonusLedgerErr } = await supabaseAdmin
        .from("coin_transactions")
        .insert({
          user_id: cm.user_id,
          amount: GROUP_BONUS_FANGS,
          type: "focus_room_bonus",
          reference_id: room.id,
          description: `Focus Room ${code} group bonus`,
        })
        .select("id")
        .single();
      if (bonusLedgerErr || !ledgerRow) {
        await revertCas();
        if (bonusLedgerErr?.code === "23514") {
          // HELD migration 20260702090000 not applied yet: skip, report pending.
          bonusPending = true;
        } else {
          console.error("[focus-rooms/complete] bonus ledger", bonusLedgerErr?.message);
        }
        continue;
      }

      const { error: bonusCreditErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: cm.user_id,
        p_delta: GROUP_BONUS_FANGS,
        p_min_balance: 0,
        p_source: "cashable",
      });
      if (bonusCreditErr) {
        console.error("[focus-rooms/complete] bonus credit", bonusCreditErr.message);
        // Roll the marker back so nothing is ledgered without a balance move.
        await supabaseAdmin.from("coin_transactions").delete().eq("id", ledgerRow.id);
        await revertCas();
        continue;
      }

      if (cm.user_id === userId) bonusFangs = GROUP_BONUS_FANGS;
    }
  }

  // ── Broadcast (best-effort) ─────────────────────────────────────────
  const ch = supabaseAdmin.channel(focusRoomChannel(code));
  try {
    await ch.send({
      type: "broadcast",
      event: FOCUS_ROOM_EVENTS.MEMBER_COMPLETED,
      payload: { user_id: userId },
    });
  } catch (err: unknown) {
    console.warn("[focus-rooms/complete] broadcast warn:", err);
  } finally {
    void supabaseAdmin.removeChannel(ch);
  }

  return NextResponse.json({
    ok: true,
    alreadyCompleted,
    coinsEarned,
    bonusFangs,
    bonusPending,
    capped,
    bonusCapped,
    completedCount,
    sessionsToday,
    cap: MAX_FOCUS_SESSIONS_PER_DAY,
  });
}
