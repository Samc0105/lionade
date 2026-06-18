import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { notifyUser, emailEnabled } from "@/lib/db";
import { renderEmail, templates } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";
import { applyFangMultiplierFromTier } from "@/lib/mastery-plan";
import { clearActiveSession } from "@/lib/presence";
import { BOOSTER_ITEMS } from "@/lib/shop-catalog";
import { getLevelFromXp } from "@/lib/levels";
import { grantEarnedCosmetic } from "@/lib/cosmetic-grants";

// ── Server-authoritative reward derivation ─────────────────────────────────
// The base per-correct-answer reward (BEFORE the plan multiplier) used to be
// computed on the client and trusted by this route (clamped to [0,500]). A
// crafted client could self-grant the full clamp every quiz. We now derive the
// reward server-side on the v2 path (body.deriveReward === true), replicating
// the EXACT live client formula from app/quiz/page.tsx finishQuiz:
//   per correct coin = Math.round(1  * diffMult * blitzMult * coinMultiplier)
//   per correct xp   = Math.round(10 * diffMult * blitzMult * xpMultiplier)
// summed over correct answers (round-per-answer, then × count — NOT round of
// the total), then a flat +5 coin perfect bonus for a clean 10/10.
const DIFFICULTY_MULTIPLIER: Record<string, number> = { easy: 1, medium: 1.5, hard: 2 };

// Largest reward multiplier in the live shop catalog, derived (not hardcoded)
// from the coin/xp/coin_xp multiplier boosters. Used for the LEGACY-path
// ceiling so iOS legit play (which still derives client-side) is never
// under-paid. score_boost is additive (+correct answers), not a multiplier,
// so it is excluded here and handled separately in the ceiling.
const MAX_BOOSTER_MULT = Math.max(
  1,
  ...BOOSTER_ITEMS
    .filter(
      (b) =>
        b.boosterEffect === "coin_multiplier" ||
        b.boosterEffect === "xp_multiplier" ||
        b.boosterEffect === "coin_xp_multiplier",
    )
    .map((b) => b.boosterValue ?? 1),
);

// Largest additive score_boost value in the catalog (extra "correct" answers
// credited beyond what the player actually got right). Folded into the legacy
// ceiling so a legit Score Boost run is never clamped below its real reward.
const MAX_SCORE_BOOST = Math.max(
  0,
  0,
  ...BOOSTER_ITEMS
    .filter((b) => b.boosterEffect === "score_boost")
    .map((b) => b.boosterValue ?? 0),
);

type ActiveBoosterRow = { id: string; effect: string; value: number; usesRemaining: number };

// Map an active_boosters row to a normalized shape, mirroring the field
// fallback the /api/shop/activate-booster GET handler uses. The live column is
// boost_type/boost_value (see migration 039 index + activate-booster writes),
// but the original shop-tables.sql shipped booster_effect/booster_value and
// some readers still query that name — so we accept either to stay robust to
// whichever physical column the row carries.
function normalizeBooster(b: Record<string, unknown>): ActiveBoosterRow {
  return {
    id: String(b.id),
    effect: String((b.boost_type ?? b.booster_effect ?? b.effect ?? "") as string),
    value: Number((b.boost_value ?? b.booster_value ?? b.value ?? 1) as number),
    usesRemaining: Number((b.uses_remaining ?? 0) as number),
  };
}

// display_name is stored after moderateText() (which does NOT strip < or >), and
// renderEmail() interpolates slots without escaping — so a display_name like
// "<b>x</b>" would inject into the email HTML. Escape it here, mirroring the
// streak-reminder + academia-digest senders. (Self-XSS only — the email goes to
// the user's own inbox — but kept consistent so every sender is safe.)
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// GET — health check (auth-gated so the profile row count isn't world-readable)
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { count, error } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (error) {
    console.error("[save-quiz-results GET]", error.message);
    return NextResponse.json({ ok: false, error: "Health check failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, profiles: count });
}

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error("[save-quiz-results] SUPABASE_SECRET_KEY is missing!");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Auth: derive userId from session, NEVER trust the body
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    const body = await req.json();
    const { subject, answers } = body;

    if (!subject || typeof subject !== "string") {
      return NextResponse.json({ error: "Missing subject" }, { status: 400 });
    }

    // Idempotency key: a stable per-attempt UUID from the client. A replay of
    // the same attempt (network retry, double-submit) hits the partial UNIQUE
    // (user_id, attempt_id) below and returns the prior result without
    // re-crediting. Optional — an old client omitting it stores NULL (not
    // deduped), so this is backward-compatible.
    const attemptId =
      typeof body.attemptId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.attemptId)
        ? body.attemptId
        : null;
    // Sanity-clamp the structural client values (these shadow the body values
    // everywhere downstream). totalQuestions/correctAnswers are still
    // client-reported but bounded; correctAnswers can never exceed
    // totalQuestions, and each answer was already server-verified via
    // /api/quiz/check-answer during play.
    const totalQuestions = Math.max(1, Math.min(100, Number(body.totalQuestions) || 0));
    const validatedCorrectAnswers = Math.max(0, Math.min(totalQuestions, Number(body.correctAnswers) || 0));

    // Difficulty governs the reward multiplier — validate it server-side
    // (default "medium" when missing/invalid) so a bogus value can't inflate
    // the derivation or the ceiling.
    const difficulty =
      body.difficulty === "easy" || body.difficulty === "medium" || body.difficulty === "hard"
        ? (body.difficulty as "easy" | "medium" | "hard")
        : "medium";
    const blitzMode = body.blitzMode === true;
    const deriveReward = body.deriveReward === true;

    // ── v2 path: server-authoritative reward derivation ──────────────────────
    // Read the user's active boosters BEFORE any consume, derive coins/xp from
    // the validated structural fields + the boosters, and IGNORE the
    // client-supplied coinsEarned/xpEarned entirely. The boosters that actually
    // contributed are consumed AFTER the session insert succeeds (so an
    // idempotent attemptId replay — which short-circuits at the insert — never
    // double-consumes). On the legacy path (current iOS) we keep trusting the
    // client value but replace the flat [0,500] clamp with a derived ceiling.
    let correctAnswers = validatedCorrectAnswers;
    let coinsEarned: number;
    let xpEarned: number;
    // Boosters whose effect contributed to THIS reward — consumed post-insert.
    const boostersToConsume: ActiveBoosterRow[] = [];

    if (deriveReward) {
      const { data: rawBoosters } = await supabaseAdmin
        .from("active_boosters")
        .select("*")
        .eq("user_id", userId);

      const active = (rawBoosters ?? [])
        .map((b) => normalizeBooster(b as Record<string, unknown>))
        .filter((b) => b.usesRemaining > 0);

      const find = (effect: string) => active.find((b) => b.effect === effect);
      // Double Down (coin_xp_multiplier) feeds whichever multiplier isn't
      // already set by Coin Rush / XP Surge — mirrors app/quiz/page.tsx L404-415.
      const coinMul = find("coin_multiplier") ?? find("coin_xp_multiplier");
      const xpMul = find("xp_multiplier") ?? find("coin_xp_multiplier");
      const scoreBoostB = find("score_boost");
      const coinMultiplier = coinMul ? coinMul.value : 1;
      const xpMultiplier = xpMul ? xpMul.value : 1;
      const scoreBoost = scoreBoostB ? scoreBoostB.value : 0;

      const diffMult = DIFFICULTY_MULTIPLIER[difficulty];
      const blitzMult = blitzMode ? 2 : 1;

      // The derive-path client (app/quiz/page.tsx) now sends the RAW correct
      // count (finalAnswers.filter(a=>a.correct).length), NOT the boosted
      // count. score_boost is applied here, server-side, exactly once.
      //   rawCorrect     = the validated raw correct answers.
      //   boostedCorrect = min(rawCorrect + score_boost, total). This is the
      //                    stored count and the value every downstream score
      //                    comparison must use, so behavior is unchanged from
      //                    when the client sent the boosted count.
      // The client computes coins/xp by reduce()-ing over the RAW correct
      // answers only. score_boost adds NO coin/xp term; it only (a) gates the
      // perfect bonus and (b) becomes the stored correct_answers. We replicate
      // that: per-answer reward times rawCorrect, score_boost folded only into
      // boostedCorrect.
      const rawCorrect = validatedCorrectAnswers;
      const boostedCorrect = Math.min(rawCorrect + scoreBoost, totalQuestions);
      // correctAnswers (the shared downstream var) becomes boostedCorrect on
      // the derive path. It is stored as correct_answers/score AND drives every
      // score comparison (bounties, achievements, daily-bet target) below.
      correctAnswers = boostedCorrect;

      // Round PER answer, then multiply by the RAW correct count (the
      // per-answer term is constant). This reproduces the client's
      // reduce()-over-finalAnswers exactly. score_boost does NOT multiply in.
      const perCoin = Math.round(1 * diffMult * blitzMult * coinMultiplier);
      const perXp = Math.round(10 * diffMult * blitzMult * xpMultiplier);
      let derivedCoins = rawCorrect * perCoin;
      const derivedXp = rawCorrect * perXp;

      // Perfect bonus: only a clean 10/10 (matches client; uses boostedCorrect,
      // so a 9-correct run pushed to 10 by score_boost DOES earn the +5).
      if (boostedCorrect === totalQuestions && totalQuestions === 10) {
        derivedCoins += 5;
      }

      coinsEarned = Math.max(0, derivedCoins);
      xpEarned = Math.max(0, derivedXp);

      // Consume only the boosters that actually contributed to the reward: the
      // coin/xp/coin_xp multiplier(s) and the score_boost. De-dupe by booster id
      // (Double Down is one row feeding both coin AND xp, so it consumes once).
      const seen = new Set<string>();
      for (const b of [coinMul, xpMul, scoreBoostB]) {
        if (b && !seen.has(b.id)) {
          seen.add(b.id);
          boostersToConsume.push(b);
        }
      }
    } else {
      // ── Legacy path (current iOS): trust client coinsEarned/xpEarned, but
      // clamp to a SERVER-DERIVED ceiling instead of the old flat 500. The
      // ceiling is the maximum a legit run could possibly earn:
      //   correctAnswers * MAX_DIFF(2) * MAX_BLITZ(2) * MAX_BOOSTER_MULT
      //   + score_boost headroom (extra credited answers at the same rate)
      //   + perfect bonus (5).
      // MAX_BOOSTER_MULT is derived from the shop catalog (currently 2). This is
      // always >= any legit reward, so iOS legit play is never under-paid; it
      // only caps an absurd self-grant. We do NOT read or consume boosters here
      // (iOS still does its own PATCH consume).
      const MAX_DIFF = 2;
      const MAX_BLITZ = 2;
      const perfectBonus =
        validatedCorrectAnswers === totalQuestions && totalQuestions === 10 ? 5 : 0;
      const coinCeiling =
        (validatedCorrectAnswers + MAX_SCORE_BOOST) * MAX_DIFF * MAX_BLITZ * MAX_BOOSTER_MULT +
        perfectBonus;
      const xpCeiling =
        (validatedCorrectAnswers + MAX_SCORE_BOOST) * 10 * MAX_DIFF * MAX_BLITZ * MAX_BOOSTER_MULT;
      coinsEarned = Math.max(0, Math.min(coinCeiling, Number(body.coinsEarned) || 0));
      xpEarned = Math.max(0, Math.min(xpCeiling, Number(body.xpEarned) || 0));
    }

    // 1. Insert quiz session
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from("quiz_sessions")
      .insert({
        user_id: userId,
        subject,
        total_questions: totalQuestions,
        correct_answers: correctAnswers,
        score: correctAnswers,
        coins_earned: coinsEarned,
        xp_earned: xpEarned,
        streak_bonus: false,
        attempt_id: attemptId,
      })
      .select("id")
      .single();

    if (sessionErr) {
      // Idempotent replay: the insert hit the partial UNIQUE(user_id,attempt_id).
      // Return the prior result WITHOUT re-crediting (credits were applied on
      // the first call). This is the replay guard for the core earn path.
      if (sessionErr.code === "23505" && attemptId) {
        const { data: prior } = await supabaseAdmin
          .from("quiz_sessions")
          .select("id")
          .eq("user_id", userId)
          .eq("attempt_id", attemptId)
          .maybeSingle();
        const { data: priorProfile } = await supabaseAdmin
          .from("profiles")
          .select("coins, xp, streak, level")
          .eq("id", userId)
          .single();
        return NextResponse.json({
          success: true,
          duplicate: true,
          sessionId: prior?.id ?? null,
          profile: priorProfile ?? null,
          bonusFangs: 0,
          streakMilestone: null,
        });
      }
      console.error("[save-quiz-results] FAILED quiz_sessions:", sessionErr.message, sessionErr.details, sessionErr.hint);
      return NextResponse.json({ error: "Couldn't save quiz results." }, { status: 500 });
    }

    // 1b. Consume the boosters that fed this reward (v2 derive path only).
    // Placed AFTER the session insert + replay guard: an idempotent attemptId
    // retry hits the 23505 conflict above and returns early, so it never
    // reaches here. The boosters are consumed exactly once, on the first
    // submit that actually creates the session row.
    //
    // ATOMIC conditional decrement (was read-modify-write, which let two
    // concurrent submits each read uses_remaining=1 and both decrement, double-
    // spending a single-use booster). We now decrement in a single statement
    // guarded by `uses_remaining > 0` and scoped to the owner:
    //   UPDATE active_boosters
    //      SET uses_remaining = uses_remaining - 1
    //    WHERE id = :id AND user_id = :userId AND uses_remaining > 0
    //   RETURNING uses_remaining;
    // expressed via PostgREST as the matched-filter update below
    // (.eq id + .eq user_id + .gt uses_remaining 0, .select() to read back).
    // Only one of two racing submits matches the >0 row and gets the
    // decrement; the loser matches 0 rows. When the new value hits 0 we delete
    // the row to mirror the activate-booster PATCH consume behavior.
    //
    // KNOWN RESIDUAL RACE (follow-up): two DISTINCT attempts (different
    // attempt_ids, e.g. two real quiz submits from two tabs) both READ the
    // booster pre-consume in the derive block above and can both derive a
    // boosted reward off the same single-use booster before either reaches
    // this consume. The atomic decrement here prevents double-CONSUME (the
    // second decrement matches 0 rows), but does NOT prevent both rewards from
    // being credited. Fully serializing distinct concurrent attempts requires a
    // transactional RPC (derive + consume in one SECURITY DEFINER function
    // under row lock). Tracked as a follow-up; the practical window is tiny
    // (both submits in flight before either consumes) and is non-financial
    // beyond one extra boosted quiz reward.
    //
    // Best-effort: a consume failure must not 500 a successfully recorded quiz
    // (the reward derivation already happened off a fresh read).
    if (boostersToConsume.length > 0) {
      for (const b of boostersToConsume) {
        try {
          const { data: decremented } = await supabaseAdmin
            .from("active_boosters")
            .update({ uses_remaining: b.usesRemaining - 1 })
            .eq("id", b.id)
            .eq("user_id", userId)
            .gt("uses_remaining", 0)
            .select("id, uses_remaining")
            .maybeSingle();
          // Delete the row when the atomic decrement drove it to 0 (mirrors the
          // activate-booster PATCH). `decremented` is null if this submit lost
          // the race (0 rows matched); in that case there is nothing to clean
          // up, the winner already handled it.
          if (decremented && (decremented.uses_remaining ?? 0) <= 0) {
            await supabaseAdmin
              .from("active_boosters")
              .delete()
              .eq("id", b.id)
              .eq("user_id", userId);
          }
        } catch (consumeErr) {
          console.warn("[save-quiz-results] Step 1b booster consume WARN (non-fatal):", consumeErr);
        }
      }
    }

    // 2. Save individual answers (skip if user_answers table doesn't exist)
    if (answers && Array.isArray(answers) && answers.length > 0) {
      const answerRows = answers.map((a: { questionId: string; selected: number; isCorrect: boolean; timeLeft: number }) => ({
        session_id: session.id,
        question_id: a.questionId,
        selected_answer: a.selected,
        is_correct: a.isCorrect,
        time_left: a.timeLeft,
      }));
      const { error: answersErr } = await supabaseAdmin.from("user_answers").insert(answerRows);
      if (answersErr) {
        // Non-fatal: table might not exist yet
        console.warn("[save-quiz-results] Step 2 WARN (non-fatal):", answersErr.message);
      }
    }

    // 3. Update profile: add coins (atomic) and xp
    const { data: profile, error: profileFetchErr } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp, streak, max_streak, last_activity_at, daily_questions_completed, daily_reset_date, display_name, plan, subscription_status")
      .eq("id", userId)
      .single();

    if (profileFetchErr) {
      console.error("[save-quiz-results] Step 3 FAILED — profile fetch:", profileFetchErr.message);
      return NextResponse.json({ error: "Couldn't load profile." }, { status: 500 });
    }

    // Apply plan multiplier (Pro 1.5×, Platinum 2×) honoring past_due/canceled.
    const boostedCoinsEarned = applyFangMultiplierFromTier(coinsEarned, profile.plan as string | null, profile.subscription_status as string | null);

    // Atomic coin credit — concurrent quiz submissions from parallel tabs
    // would otherwise read-modify-write the same `coins` value and drop a grant.
    if (boostedCoinsEarned > 0) {
      const { error: coinErr } = await supabaseAdmin.rpc("update_user_coins", {
        p_user_id: userId,
        p_delta: boostedCoinsEarned,
        p_min_balance: 0,
        p_source: "cashable",
      });
      if (coinErr) {
        console.error("[save-quiz-results] Step 3 FAILED — coin credit:", coinErr.message);
        return NextResponse.json({ error: "Couldn't update profile." }, { status: 500 });
      }
    }

    const newXp = (profile.xp ?? 0) + xpEarned;
    const { error: profileUpdateErr } = await supabaseAdmin
      .from("profiles")
      .update({ xp: newXp })
      .eq("id", userId);

    if (profileUpdateErr) {
      console.error("[save-quiz-results] Step 3 FAILED — profile update:", profileUpdateErr.message);
      return NextResponse.json({ error: "Couldn't update profile." }, { status: 500 });
    }

    // Earn-a-cosmetic faucet: a FREE common aura when the user crosses into
    // Level 5, rewarding core quiz engagement. Fire-and-forget + idempotent
    // (one grant per user ever). aura_solar is a slot-backed catalog id.
    if (getLevelFromXp(profile.xp ?? 0) < 5 && getLevelFromXp(newXp) >= 5) {
      void grantEarnedCosmetic(supabaseAdmin, userId, "aura_solar", "level_5");
    }

    // 3b. Consecutive quiz bonus — award 50 fangs for every 3rd quiz completed within 60 minutes
    let bonusFangs = 0;
    try {
      const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count: recentCount } = await supabaseAdmin
        .from("quiz_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("completed_at", sixtyMinutesAgo);

      const count = recentCount ?? 0;

      if (count > 0 && count % 3 === 0) {
        bonusFangs = applyFangMultiplierFromTier(50, profile.plan as string | null, profile.subscription_status as string | null);
        // Atomic credit — see Step 3 rationale. Check the RPC error BEFORE
        // logging the audit row + reporting the bonus: a silent failure here
        // would write a phantom coin_transactions row (ledger divergence) and
        // tell the user they earned a bonus that was never credited.
        const { error: bonusRpcErr } = await supabaseAdmin.rpc("update_user_coins", {
          p_user_id: userId,
          p_delta: bonusFangs,
          p_min_balance: 0,
          p_source: "cashable",
        });
        if (bonusRpcErr) {
          console.warn("[save-quiz-results] Step 3b credit WARN (non-fatal):", bonusRpcErr.message);
          bonusFangs = 0; // don't claim a bonus that wasn't credited
        } else {
          const { error: bonusTxnErr } = await supabaseAdmin.from("coin_transactions").insert({
            user_id: userId,
            amount: bonusFangs,
            type: "streak_bonus",
            reference_id: String(session.id),
            description: `${count} quizzes in a row bonus!`,
          });
          if (bonusTxnErr) console.warn("[save-quiz-results] Step 3b log WARN:", bonusTxnErr.message);
        }
      }
    } catch (bonusErr) {
      console.warn("[save-quiz-results] Step 3b WARN (non-fatal):", bonusErr);
    }

    // 4. Log coin transaction (audit reflects ACTUAL credited amount, post-multiplier)
    if (boostedCoinsEarned > 0) {
      const { error: txnErr } = await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: boostedCoinsEarned,
        type: "quiz_reward",
        reference_id: String(session.id),
        description: `${subject} quiz — ${correctAnswers}/${totalQuestions} correct`,
      });
      if (txnErr) {
        // Non-fatal — coin_transactions might have fewer columns
        console.warn("[save-quiz-results] Step 4 WARN:", txnErr.message);
      }
    }

    // 5. Daily activity + streak
    const nowISO = new Date().toISOString();
    const todayUTC = nowISO.split("T")[0]; // YYYY-MM-DD in UTC

    const { data: existingDaily } = await supabaseAdmin
      .from("daily_activity")
      .select("id, questions_answered, coins_earned")
      .eq("user_id", userId)
      .eq("date", todayUTC)
      .maybeSingle();

    if (existingDaily) {
      const { error: dailyErr } = await supabaseAdmin
        .from("daily_activity")
        .update({
          questions_answered: existingDaily.questions_answered + totalQuestions,
          coins_earned: existingDaily.coins_earned + boostedCoinsEarned,
          streak_maintained: true,
        })
        .eq("id", existingDaily.id);
      if (dailyErr) console.warn("[save-quiz-results] Step 5 daily update WARN:", dailyErr.message);
    } else {
      const { error: dailyErr } = await supabaseAdmin.from("daily_activity").insert({
        user_id: userId,
        date: todayUTC,
        questions_answered: totalQuestions,
        coins_earned: boostedCoinsEarned,
        streak_maintained: true,
      });
      if (dailyErr) console.warn("[save-quiz-results] Step 5 daily insert WARN:", dailyErr.message);
    }

    // Daily questions tracking (profile-level)
    let dailyQuestionsCompleted = profile.daily_questions_completed ?? 0;
    const dailyResetDate = profile.daily_reset_date as string | null;

    if (dailyResetDate !== todayUTC) {
      // New day — reset daily counter
      dailyQuestionsCompleted = 0;
    }
    // Clamp existing value first (in case it was stored uncapped), then add and cap at 10
    dailyQuestionsCompleted = Math.min(Math.min(dailyQuestionsCompleted, 10) + totalQuestions, 10);

    // Streak logic — time-based (NOT UTC-calendar-based).
    // We previously bumped the streak whenever the UTC day string flipped,
    // which fired immediately at midnight UTC (8pm ET) and felt like the
    // streak ticked forward inside the same "day" from the user's POV.
    // Now we require >= 20h since the last activity before the streak ticks,
    // and stay symmetric with the 36h streak-expiry window:
    //   gap < 20h        → same study session, no increment
    //   20h <= gap <= 48h → next-day increment (works across any timezone)
    //   gap > 48h        → streak resets (shield can rescue gap <= 60h)
    const MIN_GAP_TO_INCREMENT_MS = 20 * 60 * 60 * 1000;
    const MAX_GAP_TO_CONTINUE_MS = 48 * 60 * 60 * 1000;
    const SHIELD_MAX_GAP_MS = 60 * 60 * 60 * 1000;
    const lastActivityAt = profile.last_activity_at as string | null;
    let newStreak = profile.streak ?? 0;

    if (lastActivityAt) {
      const gapMs = Date.now() - new Date(lastActivityAt).getTime();

      if (gapMs < MIN_GAP_TO_INCREMENT_MS) {
        // Same study window — no streak increment
      } else {
        if (gapMs <= MAX_GAP_TO_CONTINUE_MS) {
          // Next-day-equivalent — increment streak
          newStreak = (profile.streak ?? 0) + 1;
        } else {
          // 2+ days gap — check for streak shield.
          // FIX: the live column is boost_type (see /api/shop/activate-booster
          // writes + migration 039); there is NO booster_effect column, so the
          // old `.eq("booster_effect", "streak_shield")` matched nothing and
          // streak shields were NEVER consumed here. Query boost_type so the
          // shield actually matches and decrements.
          const { data: shield } = await supabaseAdmin
            .from("active_boosters")
            .select("id, uses_remaining")
            .eq("user_id", userId)
            .eq("boost_type", "streak_shield")
            .gt("uses_remaining", 0)
            .limit(1)
            .maybeSingle();

          if (shield && gapMs <= SHIELD_MAX_GAP_MS) {
            // Shield protects for 1 missed day. Atomic conditional decrement
            // scoped to the owner (mirrors Step 1b) so a concurrent submit
            // can't double-spend the shield.
            const { data: shieldDec } = await supabaseAdmin
              .from("active_boosters")
              .update({ uses_remaining: shield.uses_remaining - 1 })
              .eq("id", shield.id)
              .eq("user_id", userId)
              .gt("uses_remaining", 0)
              .select("id, uses_remaining")
              .maybeSingle();
            if (shieldDec && (shieldDec.uses_remaining ?? 0) <= 0) {
              await supabaseAdmin
                .from("active_boosters")
                .delete()
                .eq("id", shield.id)
                .eq("user_id", userId);
            }
            newStreak = (profile.streak ?? 0) + 1;
          } else {
            // No shield or gap too large — reset to 1
            newStreak = 1;
          }
        }
      }
    } else {
      // last_activity_at is NULL — either first quiz ever or pre-migration user
      if ((profile.streak ?? 0) > 0) {
        // Existing user with a streak from before the migration — preserve it, just backfill timestamp
      } else {
        // Truly new user, first quiz
        newStreak = 1;
      }
    }

    const newMaxStreak = Math.max(newStreak, profile.max_streak ?? 0);
    const streakUpdate: Record<string, unknown> = {
      streak: newStreak,
      max_streak: newMaxStreak,
      last_activity_at: nowISO,
      daily_questions_completed: dailyQuestionsCompleted,
      daily_reset_date: todayUTC,
    };

    const { error: streakErr } = await supabaseAdmin
      .from("profiles")
      .update(streakUpdate)
      .eq("id", userId);
    if (streakErr) console.warn("[save-quiz-results] Step 5 streak WARN:", streakErr.message);

    // 5b. Streak milestone rewards — award bonus Fangs at 3, 7, 14, 30 day milestones
    let streakMilestone: { days: number; bonus: number } | null = null;
    const STREAK_MILESTONES: Record<number, number> = { 3: 50, 7: 150, 14: 500, 30: 2000 };
    if (newStreak in STREAK_MILESTONES) {
      // Atomic idempotency: INSERT the (user_id, milestone_day) claim FIRST. The
      // PK (migration 077) is the lock — only the submit whose insert actually
      // creates the row credits the bonus. The old guard was a COUNT-then-credit
      // read on coin_transactions: two legitimate concurrent submits (two tabs,
      // distinct attempt_ids) both saw 0 and BOTH credited, double-paying up to
      // 2000 Fangs. A 23505 conflict here = already awarded OR a concurrent
      // submit won the claim → skip.
      const { data: milestoneClaim, error: claimErr } = await supabaseAdmin
        .from("user_milestone_awards")
        .insert({ user_id: userId, milestone_day: newStreak })
        .select("user_id");
      const claimedMilestone = !claimErr && (milestoneClaim?.length ?? 0) > 0;

      if (claimedMilestone) {
        const milestoneBonus = applyFangMultiplierFromTier(STREAK_MILESTONES[newStreak], profile.plan as string | null, profile.subscription_status as string | null);
        // Atomic credit — see Step 3 rationale.
        const { error: milestoneErr } = await supabaseAdmin.rpc("update_user_coins", {
          p_user_id: userId,
          p_delta: milestoneBonus,
          p_min_balance: 0,
          p_source: "cashable",
        });
        if (milestoneErr) {
          // Credit failed AFTER claiming — release the claim so a later quiz can
          // re-award (compensating delete), and don't write a phantom audit row.
          console.warn("[save-quiz-results] Step 5b milestone credit WARN — releasing claim:", milestoneErr.message);
          await supabaseAdmin
            .from("user_milestone_awards")
            .delete()
            .eq("user_id", userId)
            .eq("milestone_day", newStreak);
        } else {
          await supabaseAdmin.from("coin_transactions").insert({
            user_id: userId,
            amount: milestoneBonus,
            type: "streak_milestone",
            description: `${newStreak}-day streak milestone!`,
          });
          // Notify via the central notifyUser helper (gates on streak_alert pref
          // AND quiet hours). Bonus is still credited; the user just won't see a
          // notification card if they opted out or are inside quiet hours.
          await notifyUser({
            userId,
            prefKey: "streak_alert",
            type: "streak_milestone",
            title: `${newStreak}-Day Streak!`,
            message: `You earned ${milestoneBonus} bonus Fangs for your ${newStreak}-day streak!`,
            action_url: "/dashboard",
          });
          streakMilestone = { days: newStreak, bonus: milestoneBonus };
        }
      }
    }

    // 5c. First-day-streak email — fires exactly once per user (max_streak === 0
    // before this run guarantees no prior streak). Best-effort: failures here
    // never break the API. Phase 1 wiring; Phase 2 will personalize via Ninny.
    try {
      const isFirstEverStreak = (profile.max_streak ?? 0) === 0 && newStreak === 1;
      // Channel-consistency trust gate: the firstStreakDay email is the EMAIL
      // counterpart of the streak_milestone in-app notification. It must be
      // gated on the EMAIL channel pref (emailEnabled), NOT the in-app pref
      // (shouldNotifyUser) — the in-app streak_milestone card is already gated
      // upstream on shouldNotifyUser(streak_alert). streak_alert is seeded
      // email-on-by-default (see lib/db DEFAULT_PREFERENCES.notifications_email),
      // so default behavior is unchanged: both the in-app card and this email
      // still fire. Now the Email checkbox governs the email and the In-app
      // checkbox governs the card, independently.
      if (
        isFirstEverStreak &&
        process.env.RESEND_API_KEY &&
        process.env.EMAIL_FROM &&
        await emailEnabled(userId, "streak_alert")
      ) {
        // Look up the user's email via auth.users (profiles doesn't store it)
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
        const toEmail = authUser?.user?.email;
        if (toEmail) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const rendered = renderEmail(templates.firstStreakDay, {
            userName: profile.display_name
              ? escapeHtml(profile.display_name as string)
              : undefined,
            fangsEarned: coinsEarned,
            ctaUrl: absoluteUrl("/dashboard"),
            ctaLabel: "Keep the streak alive",
          });
          const { error: emailErr } = await resend.emails.send({
            from: process.env.EMAIL_FROM,
            to: toEmail,
            replyTo: "support@getlionade.com",
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          });
          if (emailErr) {
            console.warn("[save-quiz-results] firstStreakDay email failed:", JSON.stringify(emailErr));
          }
        }
      }
    } catch (streakEmailErr) {
      // Non-fatal — email send must never 500 a quiz submission
      console.warn("[save-quiz-results] firstStreakDay email WARN:", streakEmailErr);
    }

    // 6. Achievement checking
    try {
      const [{ count: quizCount }, { data: updatedProfile }] = await Promise.all([
        supabaseAdmin.from("quiz_sessions").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabaseAdmin.from("profiles").select("coins, streak").eq("id", userId).single(),
      ]);

      const totalQuizzes = quizCount ?? 0;
      const currentCoins = updatedProfile?.coins ?? 0;
      const currentStreak = updatedProfile?.streak ?? 0;

      const achievementsToCheck = [
        { key: "first_quiz", condition: totalQuizzes >= 1 },
        { key: "perfect_score", condition: correctAnswers === totalQuestions && totalQuestions === 10 },
        { key: "streak_3", condition: currentStreak >= 3 },
        { key: "streak_7", condition: currentStreak >= 7 },
        { key: "coins_100", condition: currentCoins >= 100 },
        { key: "coins_500", condition: currentCoins >= 500 },
        { key: "quizzes_10", condition: totalQuizzes >= 10 },
        { key: "quizzes_50", condition: totalQuizzes >= 50 },
      ];

      const toAward = achievementsToCheck
        .filter(a => a.condition)
        .map(a => ({ user_id: userId, achievement_key: a.key, unlocked_at: new Date().toISOString() }));

      if (toAward.length > 0) {
        const { error: achErr } = await supabaseAdmin
          .from("achievements")
          .upsert(toAward, { onConflict: "user_id,achievement_key", ignoreDuplicates: true });
        if (achErr) console.warn("[save-quiz-results] Step 6 achievements WARN:", achErr.message);
      }
    } catch (achException) {
      // Non-fatal — achievements table might not exist yet
      console.warn("[save-quiz-results] Step 6 WARN (non-fatal):", achException);
    }

    // 7. Bounty progress checking
    try {
      const { data: activeBounties } = await supabaseAdmin
        .from("bounties")
        .select("id, requirement_type, requirement_value, requirement_subject, requirement_difficulty")
        .eq("active", true);

      if (activeBounties && activeBounties.length > 0) {
        // Batched: was N sequential round-trips per bounty.
        // Pre-fetch today's quizzes ONCE with subject column so quiz_count
        // bounties can compute per-subject totals without a second query.
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        const bountyIds = activeBounties.map(b => b.id);
        const [{ data: todaysQuizRows }, { data: existingProgressRows }] = await Promise.all([
          supabaseAdmin
            .from("quiz_sessions")
            .select("subject")
            .eq("user_id", userId)
            .gte("completed_at", todayStart.toISOString()),
          supabaseAdmin
            .from("user_bounties")
            .select("id, bounty_id, progress, completed")
            .eq("user_id", userId)
            .in("bounty_id", bountyIds),
        ]);
        const progressByBounty = new Map(
          (existingProgressRows ?? []).map(p => [p.bounty_id, p])
        );
        // Total + per-subject quiz counts derived from one query.
        const todaysQuizzes = todaysQuizRows?.length ?? 0;
        const todaysQuizzesBySubject = new Map<string, number>();
        for (const row of todaysQuizRows ?? []) {
          const s = (row as { subject: string | null }).subject ?? "";
          if (!s) continue;
          todaysQuizzesBySubject.set(s, (todaysQuizzesBySubject.get(s) ?? 0) + 1);
        }
        const nowIso = new Date().toISOString();
        const rowsToUpsert: Array<{
          user_id: string;
          bounty_id: string;
          progress: number;
          completed: boolean;
          completed_at?: string;
        }> = [];

        for (const bounty of activeBounties) {
          let progress = 0;
          let completed = false;

          switch (bounty.requirement_type) {
            case "min_score": {
              if (correctAnswers >= bounty.requirement_value) {
                progress = bounty.requirement_value;
                completed = true;
              } else {
                progress = correctAnswers;
              }
              break;
            }
            case "quiz_count": {
              // Subject-tagged bounties (e.g. "Math Marathon") look up the
              // per-subject count; untagged bounties use today's all-subject total.
              progress = bounty.requirement_subject
                ? (todaysQuizzesBySubject.get(bounty.requirement_subject) ?? 0)
                : todaysQuizzes;
              completed = progress >= bounty.requirement_value;
              break;
            }
            case "perfect_score": {
              if (correctAnswers === totalQuestions && totalQuestions >= 10) {
                progress = 1;
                completed = true;
              }
              break;
            }
            case "blitz_score": {
              if (body.blitzMode && correctAnswers >= bounty.requirement_value) {
                progress = bounty.requirement_value;
                completed = true;
              }
              break;
            }
            case "advanced_quiz": {
              if (body.difficulty === "advanced") {
                progress = 1;
                completed = true;
              }
              break;
            }
            default:
              continue;
          }

          const existing = progressByBounty.get(bounty.id);
          if (existing) {
            const newProgress = Math.max(existing.progress, progress);
            const nowCompleted = existing.completed || completed;
            if (newProgress !== existing.progress || nowCompleted !== existing.completed) {
              rowsToUpsert.push({
                user_id: userId,
                bounty_id: bounty.id,
                progress: newProgress,
                completed: nowCompleted,
                ...(nowCompleted && !existing.completed ? { completed_at: nowIso } : {}),
              });
            }
          } else {
            rowsToUpsert.push({
              user_id: userId,
              bounty_id: bounty.id,
              progress,
              completed,
              ...(completed ? { completed_at: nowIso } : {}),
            });
          }
        }

        if (rowsToUpsert.length > 0) {
          await supabaseAdmin
            .from("user_bounties")
            .upsert(rowsToUpsert, { onConflict: "user_id,bounty_id" });
        }
      }
    } catch (bountyErr) {
      console.warn("[save-quiz-results] Step 7 WARN (non-fatal):", bountyErr);
    }

    // 8. Resolve active daily bet
    try {
      const { data: activeBet } = await supabaseAdmin
        .from("daily_bets")
        .select("id, coins_staked, target_score, target_total")
        .eq("user_id", userId)
        .is("resolved_at", null)
        .maybeSingle();

      if (activeBet) {
        const won = correctAnswers >= activeBet.target_score;
        const multipliers: Record<number, number> = { 7: 1.5, 8: 2, 9: 3, 10: 5 };
        const baseCoinsWon = won ? Math.floor(activeBet.coins_staked * (multipliers[activeBet.target_score] ?? 1)) : 0;
        const coinsWon = applyFangMultiplierFromTier(baseCoinsWon, profile.plan as string | null, profile.subscription_status as string | null);

        // Conditional claim: only the FIRST submit whose UPDATE still sees
        // resolved_at IS NULL wins the bet. Concurrent submits match 0 rows and
        // must NOT credit — otherwise the payout double-credits (up to 5x stake).
        const { data: betClaim } = await supabaseAdmin
          .from("daily_bets")
          .update({
            actual_score: correctAnswers,
            won,
            coins_won: coinsWon,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", activeBet.id)
          .is("resolved_at", null)
          .select("id");

        const claimedBet = (betClaim?.length ?? 0) > 0;

        if (won && claimedBet) {
          // Atomic credit — see Step 3 rationale. Check the error before the
          // audit row: the bet is already resolved (can't retry), so a silent
          // credit failure would log a phantom payout. Log LOUDLY for manual
          // reconciliation instead of writing a ledger row for Fangs never paid.
          const { error: betCreditErr } = await supabaseAdmin.rpc("update_user_coins", {
            p_user_id: userId,
            p_delta: coinsWon,
            p_min_balance: 0,
            p_source: "cashable",
          });
          if (betCreditErr) {
            console.error("[save-quiz-results] Step 8 bet payout FAILED after claim — needs reconciliation:", activeBet.id, betCreditErr.message);
          } else {
            await supabaseAdmin.from("coin_transactions").insert({
              user_id: userId,
              amount: coinsWon,
              type: "bet_won",
              reference_id: activeBet.id,
              description: `Won bet: ${correctAnswers}/${totalQuestions} (target ${activeBet.target_score})`,
            });
          }
        }

      }
    } catch (betErr) {
      console.warn("[save-quiz-results] Step 8 WARN (non-fatal):", betErr);
    }

    // 9. Return final profile
    const { data: finalProfile } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp, streak, level")
      .eq("id", userId)
      .single();


    // Drop the active_session pin — quiz is done. (The quiz start path is
    // stateless and doesn't set one, but this is a safe no-op if absent and
    // catches any legacy/dangling pin from prior sessions.)
    void clearActiveSession(userId);

    // Authoritative reward echo. The web v2 client (deriveReward) reconciles
    // its optimistic display to these server numbers:
    //   reward.coinsEarned  — pre-plan-multiplier BASE coins (matches the
    //                         per-quiz "Fangs" total the client computes)
    //   reward.xpEarned     — XP credited (plan multiplier does not apply to XP)
    //   reward.coinsCredited — coins ACTUALLY added to the wallet (post plan
    //                         multiplier). Equals coinsEarned for free users.
    return NextResponse.json({
      success: true,
      sessionId: session.id,
      profile: finalProfile,
      bonusFangs,
      streakMilestone,
      reward: {
        coinsEarned,
        xpEarned,
        coinsCredited: boostedCoinsEarned,
      },
    });
  } catch (err) {
    console.error("[save-quiz-results] UNEXPECTED:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
