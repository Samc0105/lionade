// Referral growth loop — server-side helpers.
//
// Flow:
//   1. Every user has a deterministic-ish shareable `referral_code`
//      (stored on profiles, assigned lazily via ensureReferralCode).
//   2. A NEW user arrives with ?ref=CODE. The client stashes it and, once
//      authenticated, calls POST /api/referral/claim which writes a `pending`
//      row in `referrals` (referrer_id, referee_id, code). UNIQUE(referee_id)
//      + a self-referral check make this a one-time, no-self operation.
//   3. On the referee's FIRST qualifying quiz completion, maybeRewardReferral()
//      atomically flips the pending row to `rewarded` and grants BOTH sides a
//      one-time Fang reward via the shared atomic money RPC update_user_coins.
//
// Everything here FAILS SOFT: if the migration (profiles.referral_code /
// referrals / reward_referral) hasn't been applied, calls no-op and never
// break the surrounding request. The economy stays server-authoritative — no
// Fang is ever minted on the client.

import { supabaseAdmin } from "@/lib/supabase-server";
import { notifyUser } from "@/lib/db";

// One-time reward, in Fangs, granted to EACH side when a referral qualifies.
export const REFERRAL_REWARD_FANGS = 100;

// Bound the REFERRER faucet: only the first N rewarded referrals per user mint
// Fangs to that referrer. Caps the cashable-Fang liability so disposable-account
// farming can't produce unbounded rewards. The referee's one-time welcome bonus
// is never capped (each is a distinct real new account).
export const REFERRAL_REWARD_CAP = 50;

// Postgres "undefined column" / "undefined table" / "undefined function" codes.
// When we see these it means the HELD migration hasn't been applied yet, so we
// treat the whole feature as disabled instead of surfacing an error.
const MISSING_SCHEMA_CODES = new Set(["42703", "42P01", "42883"]);

function isMissingSchema(err: { code?: string } | null | undefined): boolean {
  return !!err?.code && MISSING_SCHEMA_CODES.has(err.code);
}

// Human-friendly alphabet — no 0/O/1/I/L to avoid share-by-voice confusion.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 7;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Normalize a user-supplied code: uppercase, strip whitespace + non-alphabet. */
export function normalizeCode(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16); // generous ceiling; our own codes are CODE_LEN
}

export interface ReferralCodeResult {
  enabled: boolean; // false when the migration isn't applied
  code: string | null;
}

/**
 * Return the user's referral code, assigning one on first call. Fails soft:
 * returns { enabled:false, code:null } if profiles.referral_code doesn't exist.
 */
export async function ensureReferralCode(userId: string): Promise<ReferralCodeResult> {
  // Read existing.
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("profiles")
    .select("referral_code")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    if (isMissingSchema(readErr)) return { enabled: false, code: null };
    console.error("[referral] ensureReferralCode read:", readErr.message);
    return { enabled: false, code: null };
  }

  const current = (existing as { referral_code?: string | null } | null)?.referral_code ?? null;
  if (current) return { enabled: true, code: current };

  // Assign — retry a few times on the UNIQUE collision (astronomically rare
  // for a 7-char code, but correctness over luck).
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = randomCode();
    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({ referral_code: candidate })
      // Only claim the code if this user still has none — prevents two parallel
      // requests for the same user from overwriting each other.
      .eq("id", userId)
      .is("referral_code", null);

    if (!updErr) {
      // Confirm we actually own it (the .is(null) guard means a racing call
      // may have set a different code first — re-read to return the winner).
      const { data: after } = await supabaseAdmin
        .from("profiles")
        .select("referral_code")
        .eq("id", userId)
        .maybeSingle();
      const owned = (after as { referral_code?: string | null } | null)?.referral_code ?? null;
      if (owned) return { enabled: true, code: owned };
      continue; // no code yet — try again
    }

    if (isMissingSchema(updErr)) return { enabled: false, code: null };
    // 23505 = unique_violation on referral_code — collided with another user's
    // code; loop and try a fresh candidate.
    if (updErr.code === "23505") continue;

    console.error("[referral] ensureReferralCode update:", updErr.message);
    return { enabled: false, code: null };
  }

  return { enabled: false, code: null };
}

export interface ClaimResult {
  claimed: boolean;
  reason?: "no-code" | "self" | "already-referred" | "invalid-code" | "disabled" | "already-active";
}

/**
 * Attach a pending referral for `refereeId` using `rawCode`. Idempotent and
 * abuse-resistant:
 *   - self-referral (code belongs to the referee) -> rejected
 *   - referee already has a referral row          -> rejected (UNIQUE guard)
 *   - referee already earned XP/quizzes elsewhere  -> still allowed to claim,
 *     but see maybeRewardReferral for the "first quiz" gating; the eligibility
 *     window is enforced by the caller (claim is only offered right after
 *     signup, and reward only fires on first qualifying quiz).
 *
 * Fails soft: returns { claimed:false, reason:"disabled" } if schema missing.
 */
export async function claimReferral(refereeId: string, rawCode: string): Promise<ClaimResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { claimed: false, reason: "no-code" };

  // Resolve code -> referrer.
  const { data: referrer, error: refErr } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("referral_code", code)
    .maybeSingle();

  if (refErr) {
    if (isMissingSchema(refErr)) return { claimed: false, reason: "disabled" };
    console.error("[referral] claim resolve:", refErr.message);
    return { claimed: false, reason: "disabled" };
  }

  const referrerId = (referrer as { id?: string } | null)?.id ?? null;
  if (!referrerId) return { claimed: false, reason: "invalid-code" };

  // Self-referral guard (also enforced by the DB CHECK).
  if (referrerId === refereeId) return { claimed: false, reason: "self" };

  // Insert the pending edge. UNIQUE(referee_id) makes re-referral a 23505.
  const { error: insErr } = await supabaseAdmin.from("referrals").insert({
    referrer_id: referrerId,
    referee_id: refereeId,
    code,
    status: "pending",
    reward_fangs: REFERRAL_REWARD_FANGS,
  });

  if (insErr) {
    if (isMissingSchema(insErr)) return { claimed: false, reason: "disabled" };
    if (insErr.code === "23505") return { claimed: false, reason: "already-referred" };
    // 23514 = check_violation (self-referral caught at DB level).
    if (insErr.code === "23514") return { claimed: false, reason: "self" };
    console.error("[referral] claim insert:", insErr.message);
    return { claimed: false, reason: "disabled" };
  }

  return { claimed: true };
}

/** Grant a one-time Fang reward to a single side via the atomic money RPC. */
async function grantSide(userId: string, source: string, description: string): Promise<boolean> {
  const { error: rpcErr } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: userId,
    p_delta: REFERRAL_REWARD_FANGS,
    p_min_balance: 0,
    p_source: "cashable",
  });
  if (rpcErr) {
    console.error("[referral] grant rpc:", rpcErr.message);
    return false;
  }
  // Audit row — non-fatal (coin_transactions may have fewer columns).
  const { error: txnErr } = await supabaseAdmin.from("coin_transactions").insert({
    user_id: userId,
    amount: REFERRAL_REWARD_FANGS,
    type: source,
    description,
  });
  if (txnErr) console.warn("[referral] grant audit:", txnErr.message);
  return true;
}

/**
 * Reward a referral IFF the referee has a pending row. Called from the first
 * qualifying quiz completion path. Idempotency + double-reward protection:
 *
 *   reward_referral() atomically flips the SINGLE pending row to `rewarded` in
 *   one UPDATE ... WHERE status='pending' RETURNING. If two quiz completions
 *   race (parallel tabs), the row lock + status predicate mean only ONE UPDATE
 *   returns a row; the other returns zero rows and grants nothing. A retry
 *   after the flip also returns zero rows. So both sides are credited exactly
 *   once, forever.
 *
 * Fails soft: any schema/RPC error is swallowed (logged) so the quiz save is
 * never blocked by the referral feature.
 */
export async function maybeRewardReferral(refereeId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin.rpc("reward_referral", {
      p_referee_id: refereeId,
    });

    if (error) {
      if (!isMissingSchema(error)) console.error("[referral] reward_referral:", error.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return; // no pending referral, or already rewarded — nothing to do.

    const referrerId = (row as { referrer_id?: string }).referrer_id;
    if (!referrerId) return;

    // Grant both sides. If a grant fails, the row is already `rewarded` so it
    // won't retry — we log loudly. In practice update_user_coins failing is a
    // hard DB fault; the audit log + console surface it for manual repair.
    // Cap the referrer faucet. The current row is already flipped to 'rewarded',
    // so it's included in this count; a referrer earns for their first
    // REFERRAL_REWARD_CAP rewarded referrals, then the flip still happens
    // (social credit) but no more referrer Fangs are minted.
    let referrerOk = false;
    const { count: referrerRewarded } = await supabaseAdmin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", referrerId)
      .eq("status", "rewarded");
    if ((referrerRewarded ?? 0) <= REFERRAL_REWARD_CAP) {
      referrerOk = await grantSide(
        referrerId,
        "referral_reward",
        "A friend you invited started learning on Lionade",
      );
    } else {
      console.info("[referral] referrer reward cap reached; skipping referrer grant:", referrerId);
    }
    const refereeOk = await grantSide(
      refereeId,
      "referral_bonus",
      "Welcome bonus for joining through a friend",
    );

    // Notify both. notifyUser itself is fail-soft.
    if (referrerOk) {
      void notifyUser({
        userId: referrerId,
        prefKey: "fangs_received",
        type: "referral_reward",
        title: "Referral reward",
        message: `A friend you invited joined and started learning. You earned ${REFERRAL_REWARD_FANGS} Fangs.`,
        action_url: "/social",
        related_user_id: refereeId,
      });
    }
    if (refereeOk) {
      void notifyUser({
        userId: refereeId,
        prefKey: "fangs_received",
        type: "referral_bonus",
        title: "Welcome bonus",
        message: `You joined through a friend and earned ${REFERRAL_REWARD_FANGS} Fangs. Nice start.`,
        action_url: "/social",
        related_user_id: referrerId,
      });
    }
  } catch (err) {
    console.error("[referral] maybeRewardReferral unexpected:", err instanceof Error ? err.message : err);
  }
}

export interface ReferralStats {
  enabled: boolean;
  code: string | null;
  pending: number;
  rewarded: number;
}

/** Counts of a user's outgoing referrals by status. Fails soft to zeros. */
export async function getReferralStats(userId: string, code: string | null): Promise<ReferralStats> {
  const base: ReferralStats = { enabled: code != null, code, pending: 0, rewarded: 0 };
  if (!code) return base;

  const { data, error } = await supabaseAdmin
    .from("referrals")
    .select("status")
    .eq("referrer_id", userId);

  if (error) {
    if (!isMissingSchema(error)) console.error("[referral] stats:", error.message);
    return base;
  }

  for (const r of (data as { status: string }[] | null) ?? []) {
    if (r.status === "rewarded") base.rewarded += 1;
    else base.pending += 1;
  }
  return base;
}
