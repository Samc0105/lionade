// Shop V2 — Identity & Status Pack auto-grant helpers.
//
// Centralizes the calls to the cosmetic-grant RPCs (built in parallel by
// dev-database) so every route that triggers a grant uses the same shape.
//
// Every helper is FIRE-AND-FORGET: it MUST NOT throw or block the calling
// route's primary work. Auto-grants are a "nice to have" reward on top of an
// already-successful primary action (creating a bank, cloning, subscribing).
// If the RPC fails we log and move on — the user's action still succeeded.
//
// All RPC calls run against `supabaseAdmin` (service role). The RPCs handle
// idempotency internally (the `founder_grants` / `earned_cosmetics` tables
// have UNIQUE constraints on user_id + badge/cosmetic id).

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Race-safe founder-cap check. Wraps the `is_founder_cap_open(badge_id, cap)`
 * RPC. Returns true if there is still room under the cap, false otherwise.
 * Defensive: returns false on any RPC error so we never over-grant.
 */
export async function isFounderCapOpen(
  client: SupabaseClient,
  badgeId: string,
  cap: number,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("is_founder_cap_open", {
      p_badge_id: badgeId,
      p_cap: cap,
    });
    if (error) {
      console.error("[cosmetic-grants] is_founder_cap_open", error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error(
      "[cosmetic-grants] is_founder_cap_open threw",
      err instanceof Error ? err.message : "unknown",
    );
    return false;
  }
}

/**
 * Fire-and-forget grant of the Polyglot badge. Caller already verified the
 * trigger condition (user has 3+ language banks); the RPC itself is the
 * authoritative re-check + idempotent insert into `earned_cosmetics`.
 */
export async function grantPolyglotBadge(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    const { error } = await client.rpc("grant_polyglot_badge", {
      p_user_id: userId,
    });
    if (error) {
      console.error("[cosmetic-grants] grant_polyglot_badge", error.message);
    }
  } catch (err) {
    console.error(
      "[cosmetic-grants] grant_polyglot_badge threw",
      err instanceof Error ? err.message : "unknown",
    );
  }
}

/**
 * Fire-and-forget grant of the Knowledge Sharer badge. Caller passes the
 * BANK OWNER's user id (not the cloner). The RPC re-verifies that the bank
 * actually has >= 10 clones before inserting.
 */
export async function grantKnowledgeSharerBadge(
  client: SupabaseClient,
  bankOwnerId: string,
): Promise<void> {
  try {
    const { error } = await client.rpc("grant_knowledge_sharer_badge", {
      p_user_id: bankOwnerId,
    });
    if (error) {
      console.error(
        "[cosmetic-grants] grant_knowledge_sharer_badge",
        error.message,
      );
    }
  } catch (err) {
    console.error(
      "[cosmetic-grants] grant_knowledge_sharer_badge threw",
      err instanceof Error ? err.message : "unknown",
    );
  }
}

/**
 * Fire-and-forget grant of a Streak Warrior emblem tier. `tier` must be one
 * of 10 / 30 / 100 / 365 — the RPC validates and rejects unknown tiers.
 *
 * NOT YET wired into a route. The streak-increment site (likely
 * `app/api/clock-in/route.ts` or wherever `advance_streak` is called) must
 * call this AFTER the streak number is locked in. Out of scope for this
 * wave — flagged in the vault entry under "wiring pending".
 */
export async function grantStreakEmblem(
  client: SupabaseClient,
  userId: string,
  tier: 10 | 30 | 100 | 365,
): Promise<void> {
  try {
    const { error } = await client.rpc("grant_streak_emblem", {
      p_user_id: userId,
      p_tier: tier,
    });
    if (error) {
      console.error("[cosmetic-grants] grant_streak_emblem", error.message);
    }
  } catch (err) {
    console.error(
      "[cosmetic-grants] grant_streak_emblem threw",
      err instanceof Error ? err.message : "unknown",
    );
  }
}

/**
 * Fire-and-forget grant of a Mastery medal for a specific exam. The medal id
 * is generated server-side as `medal_mastery_subject_<exam_id>` inside the
 * RPC; we only pass user + exam.
 *
 * NOT YET wired into a route. The Mastery session-complete site must call
 * this after verifying the final score >= 95%. Out of scope for this wave —
 * flagged in the vault entry under "wiring pending".
 */
export async function grantMasteryMedal(
  client: SupabaseClient,
  userId: string,
  examId: string,
): Promise<void> {
  try {
    const { error } = await client.rpc("grant_mastery_medal", {
      p_user_id: userId,
      p_exam_id: examId,
    });
    if (error) {
      console.error("[cosmetic-grants] grant_mastery_medal", error.message);
    }
  } catch (err) {
    console.error(
      "[cosmetic-grants] grant_mastery_medal threw",
      err instanceof Error ? err.message : "unknown",
    );
  }
}
