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

    // 6. Return final profile
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
