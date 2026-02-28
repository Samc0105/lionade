import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      subject,
      totalQuestions,
      correctAnswers,
      coinsEarned,
      xpEarned,
      answers, // array of { questionId, selected, isCorrect, timeLeft }
    } = body;

    console.log("[save-quiz-results] Received:", { userId, subject, totalQuestions, correctAnswers, coinsEarned, xpEarned });

    if (!userId || !subject) {
      return NextResponse.json({ error: "Missing userId or subject" }, { status: 400 });
    }

    // 1. Insert quiz session
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from("quiz_sessions")
      .insert({
        user_id: userId,
        subject,
        total_questions: totalQuestions,
        correct_answers: correctAnswers,
        coins_earned: coinsEarned,
        xp_earned: xpEarned,
        streak_bonus: false,
      })
      .select("id")
      .single();

    if (sessionErr) {
      console.error("[save-quiz-results] quiz_sessions insert error:", sessionErr.message);
      return NextResponse.json({ error: "Failed to save quiz session: " + sessionErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] quiz_sessions inserted:", session.id);

    // 2. Save individual answers (non-blocking)
    if (answers && Array.isArray(answers) && answers.length > 0) {
      const answerRows = answers.map((a: { questionId: string; selected: number; isCorrect: boolean; timeLeft: number }) => ({
        session_id: session.id,
        question_id: a.questionId,
        selected_answer: a.selected,
        is_correct: a.isCorrect,
        time_left: a.timeLeft,
      }));
      const { error: answersErr } = await supabaseAdmin.from("user_answers").insert(answerRows);
      if (answersErr) console.error("[save-quiz-results] user_answers insert error:", answersErr.message);
      else console.log("[save-quiz-results] user_answers inserted:", answerRows.length, "rows");
    }

    // 3. Update profile: add coins and xp
    const { data: profile, error: profileFetchErr } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp, streak, max_streak")
      .eq("id", userId)
      .single();

    if (profileFetchErr) {
      console.error("[save-quiz-results] profile fetch error:", profileFetchErr.message);
      return NextResponse.json({ error: "Failed to fetch profile: " + profileFetchErr.message }, { status: 500 });
    }

    const newCoins = (profile.coins ?? 0) + coinsEarned;
    const newXp = (profile.xp ?? 0) + xpEarned;
    // Level is auto-calculated by DB trigger on xp update

    const { error: profileUpdateErr } = await supabaseAdmin
      .from("profiles")
      .update({ coins: newCoins, xp: newXp })
      .eq("id", userId);

    if (profileUpdateErr) {
      console.error("[save-quiz-results] profile update error:", profileUpdateErr.message);
      return NextResponse.json({ error: "Failed to update profile: " + profileUpdateErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] profile updated: coins", profile.coins, "→", newCoins, "xp", profile.xp, "→", newXp);

    // 4. Log coin transaction
    if (coinsEarned > 0) {
      const { error: txnErr } = await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: coinsEarned,
        type: "quiz_reward",
        reference_id: session.id,
        description: `${subject} quiz — ${correctAnswers}/${totalQuestions} correct`,
      });
      if (txnErr) console.error("[save-quiz-results] coin_transactions error:", txnErr.message);
      else console.log("[save-quiz-results] coin_transaction logged:", coinsEarned);
    }

    // 5. Upsert daily_activity + update streak
    const today = new Date().toISOString().split("T")[0];

    const { data: existingDaily } = await supabaseAdmin
      .from("daily_activity")
      .select("id, questions_answered, coins_earned")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    if (existingDaily) {
      const { error: dailyUpdateErr } = await supabaseAdmin
        .from("daily_activity")
        .update({
          questions_answered: existingDaily.questions_answered + totalQuestions,
          coins_earned: existingDaily.coins_earned + coinsEarned,
          streak_maintained: true,
        })
        .eq("id", existingDaily.id);
      if (dailyUpdateErr) console.error("[save-quiz-results] daily_activity update error:", dailyUpdateErr.message);
      else console.log("[save-quiz-results] daily_activity updated for today");
    } else {
      const { error: dailyInsertErr } = await supabaseAdmin.from("daily_activity").insert({
        user_id: userId,
        date: today,
        questions_answered: totalQuestions,
        coins_earned: coinsEarned,
        streak_maintained: true,
      });
      if (dailyInsertErr) console.error("[save-quiz-results] daily_activity insert error:", dailyInsertErr.message);
      else console.log("[save-quiz-results] daily_activity inserted for today");

      // Streak logic: check if yesterday had activity
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
      if (streakErr) console.error("[save-quiz-results] streak update error:", streakErr.message);
      else console.log("[save-quiz-results] streak:", currentStreak, "→", newStreak);
    }

    // 6. Fetch final profile to return updated values
    const { data: finalProfile } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp, streak, level")
      .eq("id", userId)
      .single();

    console.log("[save-quiz-results] DONE. Final profile:", finalProfile);

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      profile: finalProfile,
    });
  } catch (err) {
    console.error("[save-quiz-results] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
