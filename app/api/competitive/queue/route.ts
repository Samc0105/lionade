// Competitive platform — matchmaking queue.
//
// POST   /api/competitive/queue   — join the queue; attempt an immediate match.
//   Body: { format: "1v1"|"2v2", mode?: CompetitiveMode|null, partyCode?: string }
//   Returns { status: "matched", matchId } OR { status: "waiting" }.
//
// GET    /api/competitive/queue   — poll: am I matched yet? Re-runs the matcher
//   (in case enough players have since arrived) and returns { status, matchId }.
//
// DELETE /api/competitive/queue   — leave the queue.
//
// NO BOTS (carried from Arena V2). If no opponent exists, the player simply
// waits; the client surfaces an honest "no opponents yet" dead-end after a
// timeout. userId comes only from requireAuth — never the body.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  isFormat,
  isCompetitiveMode,
  eloColumnForFormat,
  type CompetitiveFormat,
  type CompetitiveMode,
} from "@/lib/competitive/types";
import {
  find1v1Opponent,
  build2v2Teams,
  resolveMode,
  type QueueRow,
} from "@/lib/competitive/matchmaking";
import { isValidRoomCode } from "@/lib/party/room-code";
import { seedRoundsForMatch } from "@/lib/competitive/seed-rounds";
import { setActiveSession } from "@/lib/presence";

const DEFAULT_MODE: CompetitiveMode = "sabotage";

// Server-anchored round START lead. When a match row is created we stamp
// starts_at = now + this lead; BOTH clients anchor the 3-2-1-GO overlay AND
// round 1's clock to that single timestamp, so they hit "GO!" together (modulo
// each device's own sub-second NTP skew) instead of each running a local
// countdown from its own mount time. The 3-2-1-GO sequence is ~3.2s of beats;
// 4500ms reliably covers both clients loading the match screen after they're
// matched (poll/redirect → fetch match → render) plus a small buffer.
const COUNTDOWN_LEAD_MS = 4500;

async function readMyQueueRow(userId: string): Promise<QueueRow | null> {
  const { data } = await supabaseAdmin
    .from("competitive_queue")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as QueueRow) ?? null;
}

async function readWaitingRows(format: CompetitiveFormat): Promise<QueueRow[]> {
  const { data } = await supabaseAdmin
    .from("competitive_queue")
    .select("*")
    .eq("format", format)
    .eq("status", "waiting");
  return (data as QueueRow[]) ?? [];
}

/**
 * Attempt to match the searcher against the current waiting pool. On success,
 * creates the match, seeds the rounds, marks all involved queue rows matched,
 * and returns the matchId. Returns null if no match could be formed.
 */
async function tryMatch(
  searcher: QueueRow,
  mode: CompetitiveMode,
): Promise<string | null> {
  const now = Date.now();
  const pool = await readWaitingRows(searcher.format);

  if (searcher.format === "1v1") {
    const opp = find1v1Opponent(searcher, pool, now);
    if (!opp) return null;
    const agreedMode = resolveMode(searcher.mode, opp.mode, mode);
    return await createMatch({
      mode: agreedMode,
      format: "1v1",
      teamA: [searcher.user_id],
      teamB: [opp.user_id],
      queueIds: [searcher.id, opp.id],
    });
  }

  // 2v2
  const teams = build2v2Teams(searcher, pool);
  if (!teams) return null;
  const agreedMode = resolveMode(searcher.mode, null, mode);
  return await createMatch({
    mode: agreedMode,
    format: "2v2",
    teamA: teams.teamA,
    teamB: teams.teamB,
    queueIds: teams.queueIds,
  });
}

async function createMatch(args: {
  mode: CompetitiveMode;
  format: CompetitiveFormat;
  teamA: string[];
  teamB: string[];
  queueIds: string[];
}): Promise<string | null> {
  const participants = [...args.teamA, ...args.teamB];

  // ── CLAIM-FIRST (double-match race fix) ──
  // Two players POSTing /queue simultaneously each read the same waiting pool and
  // each saw the other as an opponent, so BOTH ran createMatch and produced TWO
  // match rows. If they then subscribed to different `competitive-match-<id>`
  // channels they'd never connect. We now atomically CLAIM all involved queue
  // rows (conditional on status='waiting') BEFORE creating the match. The DB
  // serializes these updates, so only one concurrent matcher can claim a given
  // row. If we don't claim every expected row, another matcher beat us: release
  // whatever we grabbed back to 'waiting' and bail (the caller falls back to the
  // GET poll, which returns the winning matcher's stored match_id).
  const { data: claimed } = await supabaseAdmin
    .from("competitive_queue")
    .update({ status: "claimed" })
    .in("id", args.queueIds)
    .eq("status", "waiting")
    .select("id");

  if (!claimed || claimed.length !== args.queueIds.length) {
    // Lost the race for at least one row. Roll back our partial claim.
    if (claimed && claimed.length > 0) {
      await supabaseAdmin
        .from("competitive_queue")
        .update({ status: "waiting" })
        .in("id", claimed.map((r) => r.id))
        .eq("status", "claimed");
    }
    return null;
  }

  // Capture each participant's pre-match ladder rating for elo_before.
  const eloCol = eloColumnForFormat(args.format);
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select(`id, competitive_elo, squad_elo`)
    .in("id", participants);
  const eloBefore: Record<string, number> = {};
  for (const p of profiles ?? []) {
    eloBefore[p.id] = (eloCol === "squad_elo" ? p.squad_elo : p.competitive_elo) ?? 1000;
  }

  const { data: match, error } = await supabaseAdmin
    .from("competitive_matches")
    .insert({
      mode: args.mode,
      format: args.format,
      status: "active",
      team_a: args.teamA,
      team_b: args.teamB,
      elo_before: eloBefore,
      // Server-anchored round START — both clients derive the pre-round
      // countdown + round 1's clock from this single instant (see migration
      // 059 + Countdown.tsx). Server-derived so it never depends on a client.
      starts_at: new Date(Date.now() + COUNTDOWN_LEAD_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !match) {
    console.error("[competitive/queue] match insert", error?.message);
    // Release the rows we claimed so the players can be matched again.
    await supabaseAdmin
      .from("competitive_queue")
      .update({ status: "waiting" })
      .in("id", args.queueIds)
      .eq("status", "claimed");
    return null;
  }

  // Finalize: mark the claimed rows matched and point them at our match.
  await supabaseAdmin
    .from("competitive_queue")
    .update({ status: "matched", match_id: match.id })
    .in("id", args.queueIds)
    .eq("status", "claimed");

  // Seed the per-mode rounds so the screen has content immediately.
  await seedRoundsForMatch(supabaseAdmin, match.id, args.mode);

  // Pin every participant to this match for presence/AFK tracking. Roles
  // are coarse — "team_a" / "team_b" — which is enough for the reaper.
  for (const uid of args.teamA) {
    void setActiveSession(uid, "competitive_match", match.id, "team_a");
  }
  for (const uid of args.teamB) {
    void setActiveSession(uid, "competitive_match", match.id, "team_b");
  }

  return match.id;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json().catch(() => ({}));
    const format: CompetitiveFormat = isFormat(body?.format) ? body.format : "1v1";
    const mode: CompetitiveMode | null = isCompetitiveMode(body?.mode) ? body.mode : null;
    const partyCode: string | null =
      typeof body?.partyCode === "string" && isValidRoomCode(body.partyCode)
        ? body.partyCode
        : null;

    // Read the user's ladder ELO for the chosen format.
    const eloCol = eloColumnForFormat(format);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select(`competitive_elo, squad_elo`)
      .eq("id", userId)
      .single();
    const elo = (eloCol === "squad_elo" ? profile?.squad_elo : profile?.competitive_elo) ?? 1000;

    // Upsert our queue row (one per user via the UNIQUE(user_id) constraint).
    await supabaseAdmin
      .from("competitive_queue")
      .upsert(
        {
          user_id: userId,
          format,
          mode,
          elo,
          party_code: partyCode,
          status: "waiting",
          joined_at: new Date().toISOString(),
          match_id: null,
        },
        { onConflict: "user_id" },
      );

    const myRow = await readMyQueueRow(userId);
    if (!myRow) {
      return NextResponse.json({ error: "Queue join failed" }, { status: 500 });
    }

    const matchId = await tryMatch(myRow, mode ?? DEFAULT_MODE);
    if (matchId) {
      return NextResponse.json({ status: "matched", matchId });
    }
    return NextResponse.json({ status: "waiting" });
  } catch (e) {
    console.error("[competitive/queue POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const myRow = await readMyQueueRow(userId);
    if (!myRow) {
      return NextResponse.json({ status: "not_queued" });
    }
    if (myRow.status === "matched" && myRow.match_id) {
      return NextResponse.json({ status: "matched", matchId: myRow.match_id });
    }

    // Re-run the matcher (more players may have arrived since we joined).
    const matchId = await tryMatch(myRow, myRow.mode ?? DEFAULT_MODE);
    if (matchId) {
      return NextResponse.json({ status: "matched", matchId });
    }
    return NextResponse.json({ status: "waiting" });
  } catch (e) {
    console.error("[competitive/queue GET]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    await supabaseAdmin
      .from("competitive_queue")
      .delete()
      .eq("user_id", userId)
      .eq("status", "waiting"); // don't delete a row that already matched
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[competitive/queue DELETE]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
