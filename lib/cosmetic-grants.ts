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
 * Fire-and-forget grant of a Streak Warrior emblem. Pass the user's CURRENT
 * streak length; the RPC picks the highest tier crossed (10/30/100/365) and is
 * idempotent. (Wired directly via supabaseAdmin.rpc in app/api/login-bonus;
 * this wrapper exists for any other caller — note the RPC param is
 * `p_streak_days`, the raw streak, NOT a tier.)
 */
export async function grantStreakEmblem(
  client: SupabaseClient,
  userId: string,
  streakDays: number,
): Promise<void> {
  try {
    const { error } = await client.rpc("grant_streak_emblem", {
      p_user_id: userId,
      p_streak_days: streakDays,
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
 * Fire-and-forget grant of a FREE earned cosmetic at a milestone (the
 * earn-a-cosmetic faucet). The CALLER must have already verified the milestone
 * was crossed — this helper does no gating (the underlying RPC is service-role
 * only and takes an arbitrary cosmetic id). `cosmeticId` should be an EXISTING
 * slot-backed catalog id (e.g. a common aura/frame) so it equips for free
 * through the normal locker plumbing. Idempotent: re-hitting a milestone never
 * re-grants (earned_cosmetics UNIQUE on user_id + cosmetic_id).
 */
export async function grantEarnedCosmetic(
  client: SupabaseClient,
  userId: string,
  cosmeticId: string,
  earnedVia: string,
): Promise<void> {
  try {
    const { error } = await client.rpc("grant_earned_cosmetic", {
      p_user_id: userId,
      p_cosmetic_id: cosmeticId,
      p_earned_via: earnedVia,
    });
    if (error) {
      console.error("[cosmetic-grants] grant_earned_cosmetic", error.message);
    }
  } catch (err) {
    console.error(
      "[cosmetic-grants] grant_earned_cosmetic threw",
      err instanceof Error ? err.message : "unknown",
    );
  }
}

/**
 * Fire-and-forget grant of a Mastery medal for a specific exam. The medal id
 * is generated server-side as `medal_mastery_subject_<exam_id>` inside the
 * RPC. The deployed signature is grant_mastery_medal(p_user_id, p_exam_id,
 * p_exam_name) with NO default on p_exam_name — the exam title is
 * snapshotted into earned_cosmetics.metadata so the profile UI can label the
 * medal without joining a possibly renamed/deleted user_exams row. Omitting
 * p_exam_name makes PostgREST fail with PGRST202 (no function match), so
 * `examName` is required here.
 *
 * NOT YET wired into a route. The live >=95% grant in
 * app/api/mastery/sessions/[id]/complete/route.ts calls the RPC directly
 * with the same three params — keep the two call shapes in sync.
 */
export async function grantMasteryMedal(
  client: SupabaseClient,
  userId: string,
  examId: string,
  examName: string,
): Promise<void> {
  try {
    const { error } = await client.rpc("grant_mastery_medal", {
      p_user_id: userId,
      p_exam_id: examId,
      p_exam_name: examName,
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
