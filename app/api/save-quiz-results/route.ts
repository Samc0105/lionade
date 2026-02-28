import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — health check
export async function GET() {
  const { count, error } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message });
  return NextResponse.json({ ok: true, profiles: count });
}

export async function POST(req: NextRequest) {
  console.log("[save-quiz-results] ===== POST received =====");

  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error("[save-quiz-results] SUPABASE_SECRET_KEY is missing!");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const body = await req.json();
    const {
      userId,
      subject,
      totalQuestions,
      correctAnswers,
      coinsEarned,
      xpEarned,
      answers,
    } = body;

    console.log("[save-quiz-results] Payload:", JSON.stringify({ userId, subject, totalQuestions, correctAnswers, coinsEarned, xpEarned, answersCount: answers?.length ?? 0 }));

    if (!userId || !subject) {
      return NextResponse.json({ error: "Missing userId or subject" }, { status: 400 });
    }

    // 1. Insert quiz session
    console.log("[save-quiz-results] Step 1: Inserting quiz_sessions...");
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
      return NextResponse.json({ error: "quiz_sessions: " + sessionErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] Step 1 OK — session:", session.id);

    // 2. Save individual answers (skip if user_answers table doesn't exist)
    if (answers && Array.isArray(answers) && answers.length > 0) {
      console.log("[save-quiz-results] Step 2: Inserting", answers.length, "user_answers...");
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
      } else {
        console.log("[save-quiz-results] Step 2 OK —", answerRows.length, "answers saved");
      }
    }

    // 3. Update profile: add coins and xp
    console.log("[save-quiz-results] Step 3: Fetching profile...");
    const { data: profile, error: profileFetchErr } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp, streak, max_streak")
      .eq("id", userId)
      .single();

    if (profileFetchErr) {
      console.error("[save-quiz-results] Step 3 FAILED — profile fetch:", profileFetchErr.message);
      return NextResponse.json({ error: "profile fetch: " + profileFetchErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] Step 3 — current:", JSON.stringify(profile));

    const newCoins = (profile.coins ?? 0) + coinsEarned;
    const newXp = (profile.xp ?? 0) + xpEarned;

    console.log("[save-quiz-results] Step 3: Updating — coins:", profile.coins, "→", newCoins, "xp:", profile.xp, "→", newXp);
    const { error: profileUpdateErr } = await supabaseAdmin
      .from("profiles")
      .update({ coins: newCoins, xp: newXp })
      .eq("id", userId);

    if (profileUpdateErr) {
      console.error("[save-quiz-results] Step 3 FAILED — profile update:", profileUpdateErr.message);
      return NextResponse.json({ error: "profile update: " + profileUpdateErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] Step 3 OK");

    // 4. Log coin transaction
    if (coinsEarned > 0) {
      console.log("[save-quiz-results] Step 4: Coin transaction...");
      const { error: txnErr } = await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: coinsEarned,
        type: "quiz_reward",
        reference_id: String(session.id),
        description: `${subject} quiz — ${correctAnswers}/${totalQuestions} correct`,
      });
      if (txnErr) {
        // Non-fatal — coin_transactions might have fewer columns
        console.warn("[save-quiz-results] Step 4 WARN:", txnErr.message);
      } else {
        console.log("[save-quiz-results] Step 4 OK");
      }
    }

    // 5. Daily activity + streak
    console.log("[save-quiz-results] Step 5: Daily activity...");
    const today = new Date().toISOString().split("T")[0];

    const { data: existingDaily } = await supabaseAdmin
      .from("daily_activity")
      .select("id, questions_answered, coins_earned")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    if (existingDaily) {
      const { error: dailyErr } = await supabaseAdmin
        .from("daily_activity")
        .update({
          questions_answered: existingDaily.questions_answered + totalQuestions,
          coins_earned: existingDaily.coins_earned + coinsEarned,
          streak_maintained: true,
        })
        .eq("id", existingDaily.id);
      if (dailyErr) console.warn("[save-quiz-results] Step 5 daily update WARN:", dailyErr.message);
      else console.log("[save-quiz-results] Step 5 OK — daily updated");
    } else {
      const { error: dailyErr } = await supabaseAdmin.from("daily_activity").insert({
        user_id: userId,
        date: today,
        questions_answered: totalQuestions,
        coins_earned: coinsEarned,
        streak_maintained: true,
      });
      if (dailyErr) console.warn("[save-quiz-results] Step 5 daily insert WARN:", dailyErr.message);
      else console.log("[save-quiz-results] Step 5 OK — daily inserted");

      // Streak logic
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const { data: yesterdayActivity } = await supabaseAdmin
        .from("daily_activity")
        .select("streak_maintained")
        .eq("user_id", userId)
        .eq("date", yesterdayStr)
        .maybeSingle();

      const currentStreak = profile.streak ?? 0;
      const newStreak = yesterdayActivity?.streak_maintained ? currentStreak + 1 : 1;
      const newMaxStreak = Math.max(newStreak, profile.max_streak ?? 0);

      const { error: streakErr } = await supabaseAdmin
        .from("profiles")
        .update({ streak: newStreak, max_streak: newMaxStreak })
        .eq("id", userId);
      if (streakErr) console.warn("[save-quiz-results] Step 5 streak WARN:", streakErr.message);
      else console.log("[save-quiz-results] Step 5 streak:", currentStreak, "→", newStreak);
    }

    // 6. Achievement checking
    console.log("[save-quiz-results] Step 6: Checking achievements...");
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
        else console.log("[save-quiz-results] Step 6 OK — checked", toAward.length, "achievements");
      }
    } catch (achException) {
      // Non-fatal — achievements table might not exist yet
      console.warn("[save-quiz-results] Step 6 WARN (non-fatal):", achException);
    }

    // 7. Bounty progress checking
    console.log("[save-quiz-results] Step 7: Checking bounties...");
    try {
      const { data: activeBounties } = await supabaseAdmin
        .from("bounties")
        .select("id, requirement_type, requirement_value, requirement_subject, requirement_difficulty")
        .eq("active", true);

      if (activeBounties && activeBounties.length > 0) {
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
              // Count quizzes today (or this week for weekly)
              const since = new Date();
              since.setHours(0, 0, 0, 0);
              const { count } = await supabaseAdmin
                .from("quiz_sessions")
                .select("id", { count: "exact", head: true })
                .eq("user_id", userId)
                .gte("completed_at", since.toISOString())
                .match(bounty.requirement_subject ? { subject: bounty.requirement_subject } : {});
              progress = count ?? 0;
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

          // Upsert user_bounty
          const { data: existing } = await supabaseAdmin
            .from("user_bounties")
            .select("id, progress, completed")
            .eq("user_id", userId)
            .eq("bounty_id", bounty.id)
            .maybeSingle();

          if (existing) {
            const newProgress = Math.max(existing.progress, progress);
            const nowCompleted = existing.completed || completed;
            if (newProgress !== existing.progress || nowCompleted !== existing.completed) {
              await supabaseAdmin
                .from("user_bounties")
                .update({
                  progress: newProgress,
                  completed: nowCompleted,
                  ...(nowCompleted && !existing.completed ? { completed_at: new Date().toISOString() } : {}),
                })
                .eq("id", existing.id);
            }
          } else {
            await supabaseAdmin.from("user_bounties").insert({
              user_id: userId,
              bounty_id: bounty.id,
              progress,
              completed,
              ...(completed ? { completed_at: new Date().toISOString() } : {}),
            });
          }
        }
        console.log("[save-quiz-results] Step 7 OK — bounties checked");
      }
    } catch (bountyErr) {
      console.warn("[save-quiz-results] Step 7 WARN (non-fatal):", bountyErr);
    }

    // 8. Resolve active daily bet
    console.log("[save-quiz-results] Step 8: Resolving daily bet...");
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
        const coinsWon = won ? Math.floor(activeBet.coins_staked * (multipliers[activeBet.target_score] ?? 1)) : 0;

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
          // Award winnings
          const { data: betProfile } = await supabaseAdmin
            .from("profiles")
            .select("coins")
            .eq("id", userId)
            .single();

          if (betProfile) {
            await supabaseAdmin
              .from("profiles")
              .update({ coins: betProfile.coins + coinsWon })
              .eq("id", userId);
          }

          await supabaseAdmin.from("coin_transactions").insert({
            user_id: userId,
            amount: coinsWon,
            type: "bet_won",
            reference_id: activeBet.id,
            description: `Won bet: ${correctAnswers}/${totalQuestions} (target ${activeBet.target_score})`,
          });
        }

        console.log("[save-quiz-results] Step 8 OK — bet resolved:", won ? "WON" : "LOST", coinsWon);
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

    console.log("[save-quiz-results] ===== DONE =====", JSON.stringify(finalProfile));

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      profile: finalProfile,
    });
  } catch (err) {
    console.error("[save-quiz-results] UNEXPECTED:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
