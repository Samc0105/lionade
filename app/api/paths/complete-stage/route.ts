// POST /api/paths/complete-stage — server-authoritative Learning Paths reward.
//
// Body: { stageId: string (learning_paths.id uuid), correct: number, total: number }
//
// Replaces the old client-side flow where the web Learning Paths page wrote
// user_stage_progress AND credited Fangs from the browser (lib/db
// saveQuizSession -> incrementCoins) — the client-grant exploit class. This
// route now owns BOTH the progress write and the reward:
//
//   - Stars use the same thresholds the client used (>=90% 3, >=70% 2, >=50% 1).
//   - Fang reward = correct*5 + stars*10, hard-capped at PATHS_MAX_REWARD (50),
//     then boosted by the plan multiplier (Pro 1.5x / Platinum 2x) — mirrors
//     /api/games/reward.
//   - Idempotent per user+stage: the reward is paid exactly ONCE, on the FIRST
//     completion (stars > 0). The claim rides user_stage_progress's
//     UNIQUE(user_id, stage_id) row — a fresh insert or a conditional
//     completed=false -> true flip wins the claim; replays and races lose it.
//   - Credit goes through the atomic update_user_coins RPC (same as
//     save-quiz-results / place-bet), with a coin_transactions ledger row.
//     If the credit fails, the completion claim is reverted so a retry can pay.
//
// Response 200:
//   { success: true, stars, isNewBest, completed, firstCompletion,
//     fangsAwarded, newCoins }
//   fangsAwarded is 0 (and newCoins null) on replays/non-completions.
//
// Ledger type is "quiz_reward" — the same type the old client path logged for
// path stages (and the one the live coin_transactions_type_check allows);
// reference_id carries the stageId.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { applyFangMultiplierFromTier } from "@/lib/mastery-plan";
import { recordDailyActivity } from "@/lib/daily-activity-server";

export const dynamic = "force-dynamic";

const PATHS_MAX_REWARD = 50;
const MAX_TOTAL_QUESTIONS = 50;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: { stageId?: unknown; correct?: unknown; total?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const stageId = String(body.stageId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stageId)) {
      return NextResponse.json({ error: "Invalid stageId" }, { status: 400 });
    }
    const total = Math.floor(Number(body.total ?? 0));
    if (!Number.isFinite(total) || total < 1 || total > MAX_TOTAL_QUESTIONS) {
      return NextResponse.json({ error: "Invalid total" }, { status: 400 });
    }
    const correct = Math.floor(Number(body.correct ?? -1));
    if (!Number.isFinite(correct) || correct < 0 || correct > total) {
      return NextResponse.json({ error: "Invalid correct" }, { status: 400 });
    }

    // Stage must exist — also gives us the name for the ledger description.
    const { data: stage } = await supabaseAdmin
      .from("learning_paths")
      .select("id, subject, stage_name")
      .eq("id", stageId)
      .maybeSingle();
    if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });

    // Same star thresholds as the old client-side saveStageProgress.
    const pct = correct / total;
    const stars = pct >= 0.9 ? 3 : pct >= 0.7 ? 2 : pct >= 0.5 ? 1 : 0;
    const completedNow = stars > 0;
    const nowIso = new Date().toISOString();

    // ── Progress write + first-completion claim ──────────────────────────
    // firstCompletion=true means THIS request transitioned the stage to
    // completed — the only state that pays.
    let firstCompletion = false;
    let isNewBest = false;
    let finalStars = stars;
    let completed = completedNow;

    const { data: existing } = await supabaseAdmin
      .from("user_stage_progress")
      .select("id, best_score, stars, attempts, completed, completed_at")
      .eq("user_id", userId)
      .eq("stage_id", stageId)
      .maybeSingle();

    if (!existing) {
      const { error: insertErr } = await supabaseAdmin
        .from("user_stage_progress")
        .insert({
          user_id: userId,
          stage_id: stageId,
          stars,
          completed: completedNow,
          best_score: correct,
          total_questions: total,
          attempts: 1,
          completed_at: completedNow ? nowIso : null,
        });
      if (insertErr) {
        // 23505 on UNIQUE(user_id, stage_id): a parallel submit won the race.
        // Treat this request as the replay — no reward.
        if (insertErr.code !== "23505") {
          console.error("[paths/complete-stage] progress insert", insertErr.message);
          return NextResponse.json({ error: "Couldn't save progress" }, { status: 500 });
        }
        const { data: raceRow } = await supabaseAdmin
          .from("user_stage_progress")
          .select("stars, best_score, completed")
          .eq("user_id", userId)
          .eq("stage_id", stageId)
          .maybeSingle();
        finalStars = Math.max(stars, raceRow?.stars ?? 0);
        completed = completedNow || Boolean(raceRow?.completed);
        isNewBest = correct > (raceRow?.best_score ?? 0);
      } else {
        firstCompletion = completedNow;
        isNewBest = true;
      }
    } else {
      isNewBest = correct > (existing.best_score ?? 0);
      finalStars = Math.max(stars, existing.stars ?? 0);
      completed = completedNow || existing.completed;
      const updates = {
        stars: finalStars,
        completed,
        best_score: isNewBest ? correct : existing.best_score,
        total_questions: total,
        attempts: (existing.attempts ?? 0) + 1,
        completed_at: completedNow && !existing.completed ? nowIso : existing.completed_at,
      };
      if (completedNow && !existing.completed) {
        // Conditional flip claims the first completion — a concurrent request
        // that already flipped it makes this match zero rows (no double pay).
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from("user_stage_progress")
          .update(updates)
          .eq("id", existing.id)
          .eq("completed", false)
          .select("id")
          .maybeSingle();
        if (claimErr) {
          console.error("[paths/complete-stage] progress claim", claimErr.message);
          return NextResponse.json({ error: "Couldn't save progress" }, { status: 500 });
        }
        firstCompletion = Boolean(claimed);
      } else {
        const { error: updErr } = await supabaseAdmin
          .from("user_stage_progress")
          .update(updates)
          .eq("id", existing.id);
        if (updErr) {
          console.error("[paths/complete-stage] progress update", updErr.message);
          return NextResponse.json({ error: "Couldn't save progress" }, { status: 500 });
        }
      }
    }

    // ── Reward (first completion only) ────────────────────────────────────
    let fangsAwarded = 0;
    let newCoins: number | null = null;

    if (firstCompletion) {
      const base = Math.min(PATHS_MAX_REWARD, correct * 5 + stars * 10);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("plan, subscription_status")
        .eq("id", userId)
        .single();

      fangsAwarded = applyFangMultiplierFromTier(
        base,
        (profile?.plan as string | null) ?? null,
        (profile?.subscription_status as string | null) ?? null,
      );

      // Atomic credit — same RPC as save-quiz-results / games flows.
      const { data: creditData, error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: fangsAwarded,
        p_min_balance: 0,
        p_source: "cashable",
      });

      if (creditErr) {
        console.error("[paths/complete-stage] coin credit", creditErr.message);
        // Refund-on-failure pattern, inverted for a grant: release the
        // completion claim so a retry can pay.
        await supabaseAdmin
          .from("user_stage_progress")
          .update({ completed: false, completed_at: null })
          .eq("user_id", userId)
          .eq("stage_id", stageId);
        return NextResponse.json({ error: "Couldn't award Fangs" }, { status: 500 });
      }

      newCoins = Array.isArray(creditData)
        ? (creditData[0]?.new_coins ?? null)
        : ((creditData as { new_coins: number } | null)?.new_coins ?? null);

      // Ledger row — non-blocking is wrong for financial writes, but a failed
      // log shouldn't claw back the grant either; log loudly instead.
      const { error: txnErr } = await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: fangsAwarded,
        type: "quiz_reward",
        reference_id: stageId,
        description: `Learning Path stage completed: ${stage.stage_name} (${correct}/${total})`,
      });
      if (txnErr) {
        console.error("[paths/complete-stage] coin_transactions", txnErr.message);
      }
    }

    // ── Session log + XP + daily activity (Phase 2: moved off the browser) ──
    // The old flow ran lib/db.saveQuizSession from the CLIENT here, writing
    // profiles.xp + streak via the anon client. Migration 078 phase 2 guards
    // those columns, so we do it server-side. Runs on EVERY attempt (matching
    // the old per-call behavior); XP is DERIVED from the validated score (the
    // client used score*20 + stars*25), never client-supplied. Best-effort —
    // a failure here must not fail the already-committed progress/reward.
    const xpEarned = correct * 20 + finalStars * 25;
    try {
      await supabaseAdmin.from("quiz_sessions").insert({
        user_id: userId,
        subject: stage.subject,
        total_questions: total,
        correct_answers: correct,
        coins_earned: 0, // Fangs paid above via the RPC; don't double-count here
        xp_earned: xpEarned,
        streak_bonus: false,
      });

      if (xpEarned > 0) {
        // Server-side XP grant (on_profile_xp_change recomputes level). Raw
        // read-modify-write mirrors the old incrementXP; the XP lost-update
        // race is a pre-existing low-impact item tracked separately.
        const { data: xpRow } = await supabaseAdmin
          .from("profiles")
          .select("xp")
          .eq("id", userId)
          .single();
        if (xpRow) {
          await supabaseAdmin
            .from("profiles")
            .update({ xp: (xpRow.xp ?? 0) + xpEarned })
            .eq("id", userId);
        }
      }

      await recordDailyActivity(supabaseAdmin, userId, total);
    } catch (e) {
      console.error("[paths/complete-stage] session/xp/activity", e);
    }

    return NextResponse.json({
      success: true,
      stars: finalStars,
      isNewBest,
      completed,
      firstCompletion,
      fangsAwarded,
      newCoins,
    });
  } catch (e) {
    console.error("[paths/complete-stage POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
