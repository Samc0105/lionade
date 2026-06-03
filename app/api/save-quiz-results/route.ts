import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { renderEmail, templates } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";
import { applyFangMultiplierFromTier } from "@/lib/mastery-plan";

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
    // Sanity-clamp client-supplied values to prevent self-grant exploits.
    // These shadow the body values everywhere downstream.
    const totalQuestions = Math.max(1, Math.min(100, Number(body.totalQuestions) || 0));
    const correctAnswers = Math.max(0, Math.min(totalQuestions, Number(body.correctAnswers) || 0));
    const coinsEarned = Math.max(0, Math.min(500, Number(body.coinsEarned) || 0));
    const xpEarned = Math.max(0, Math.min(500, Number(body.xpEarned) || 0));

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
      })
      .select("id")
      .single();

    if (sessionErr) {
      console.error("[save-quiz-results] FAILED quiz_sessions:", sessionErr.message, sessionErr.details, sessionErr.hint);
      return NextResponse.json({ error: "Couldn't save quiz results." }, { status: 500 });
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
        // Atomic credit — see Step 3 rationale.
        await supabaseAdmin.rpc("update_user_coins", {
          p_user_id: userId,
          p_delta: bonusFangs,
          p_min_balance: 0,
        });

        await supabaseAdmin.from("coin_transactions").insert({
          user_id: userId,
          amount: bonusFangs,
          type: "streak_bonus",
          reference_id: String(session.id),
          description: `${count} quizzes in a row bonus!`,
        });

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
          // 2+ days gap — check for streak shield
          const { data: shield } = await supabaseAdmin
            .from("active_boosters")
            .select("id, uses_remaining")
            .eq("user_id", userId)
            .eq("booster_effect", "streak_shield")
            .limit(1)
            .maybeSingle();

          if (shield && gapMs <= SHIELD_MAX_GAP_MS) {
            // Shield protects for 1 missed day
            if (shield.uses_remaining && shield.uses_remaining > 1) {
              await supabaseAdmin
                .from("active_boosters")
                .update({ uses_remaining: shield.uses_remaining - 1 })
                .eq("id", shield.id);
            } else {
              await supabaseAdmin
                .from("active_boosters")
                .delete()
                .eq("id", shield.id);
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
      // Check we haven't already awarded this milestone (prevents duplicate on replay)
      const { count: alreadyAwarded } = await supabaseAdmin
        .from("coin_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("type", "streak_milestone")
        .like("description", `%${newStreak}-day%`);

      if (!alreadyAwarded || alreadyAwarded === 0) {
        const milestoneBonus = applyFangMultiplierFromTier(STREAK_MILESTONES[newStreak], profile.plan as string | null, profile.subscription_status as string | null);
        // Atomic credit — see Step 3 rationale.
        await supabaseAdmin.rpc("update_user_coins", {
          p_user_id: userId,
          p_delta: milestoneBonus,
          p_min_balance: 0,
        });
        await supabaseAdmin.from("coin_transactions").insert({
          user_id: userId,
          amount: milestoneBonus,
          type: "streak_milestone",
          description: `${newStreak}-day streak milestone!`,
        });
        // Notify
        try {
          await supabaseAdmin.from("notifications").insert({
            user_id: userId,
            type: "streak_milestone",
            title: `${newStreak}-Day Streak!`,
            message: `You earned ${milestoneBonus} bonus Fangs for your ${newStreak}-day streak!`,
            action_url: "/dashboard",
          });
        } catch { /* notifications table might not exist */ }
        streakMilestone = { days: newStreak, bonus: milestoneBonus };
      }
    }

    // 5c. First-day-streak email — fires exactly once per user (max_streak === 0
    // before this run guarantees no prior streak). Best-effort: failures here
    // never break the API. Phase 1 wiring; Phase 2 will personalize via Ninny.
    try {
      const isFirstEverStreak = (profile.max_streak ?? 0) === 0 && newStreak === 1;
      if (
        isFirstEverStreak &&
        process.env.RESEND_API_KEY &&
        process.env.EMAIL_FROM
      ) {
        // Look up the user's email via auth.users (profiles doesn't store it)
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
        const toEmail = authUser?.user?.email;
        if (toEmail) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const rendered = renderEmail(templates.firstStreakDay, {
            userName: (profile.display_name as string | null) || undefined,
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

        await supabaseAdmin
          .from("daily_bets")
          .update({
            actual_score: correctAnswers,
            won,
            coins_won: coinsWon,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", activeBet.id);

        if (won) {
          // Atomic credit — see Step 3 rationale.
          await supabaseAdmin.rpc("update_user_coins", {
            p_user_id: userId,
            p_delta: coinsWon,
            p_min_balance: 0,
          });

          await supabaseAdmin.from("coin_transactions").insert({
            user_id: userId,
            amount: coinsWon,
            type: "bet_won",
            reference_id: activeBet.id,
            description: `Won bet: ${correctAnswers}/${totalQuestions} (target ${activeBet.target_score})`,
          });
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


    return NextResponse.json({
      success: true,
      sessionId: session.id,
      profile: finalProfile,
      bonusFangs,
      streakMilestone,
    });
  } catch (err) {
    console.error("[save-quiz-results] UNEXPECTED:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
