import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";

// GET — health check so we can verify the route + supabaseAdmin work
export async function GET() {
  console.log("[save-quiz-results] GET health check hit");
  console.log("[save-quiz-results] SUPABASE_SECRET_KEY present:", !!process.env.SUPABASE_SECRET_KEY);
  console.log("[save-quiz-results] SUPABASE_SECRET_KEY length:", process.env.SUPABASE_SECRET_KEY?.length ?? 0);

  try {
    const { count, error } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });

    if (error) {
      console.error("[save-quiz-results] Health check DB error:", error.message);
      return NextResponse.json({ ok: false, error: error.message });
    }

    console.log("[save-quiz-results] Health check OK — profiles count:", count);
    return NextResponse.json({ ok: true, profileCount: count });
  } catch (err) {
    console.error("[save-quiz-results] Health check exception:", err);
    return NextResponse.json({ ok: false, error: String(err) });
  }
}

export async function POST(req: NextRequest) {
  console.log("[save-quiz-results] ===== POST received =====");

  // Verify env
  if (!process.env.SUPABASE_SECRET_KEY) {
    console.error("[save-quiz-results] SUPABASE_SECRET_KEY is missing!");
    return NextResponse.json({ error: "Server misconfigured — missing service key" }, { status: 500 });
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
      answers, // array of { questionId, selected, isCorrect, timeLeft }
    } = body;

    console.log("[save-quiz-results] Payload:", JSON.stringify({ userId, subject, totalQuestions, correctAnswers, coinsEarned, xpEarned, answersCount: answers?.length ?? 0 }));

    if (!userId || !subject) {
      console.error("[save-quiz-results] Missing userId or subject");
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
        coins_earned: coinsEarned,
        xp_earned: xpEarned,
        streak_bonus: false,
      })
      .select("id")
      .single();

    if (sessionErr) {
      console.error("[save-quiz-results] FAILED quiz_sessions insert:", sessionErr.message, sessionErr.details, sessionErr.hint);
      return NextResponse.json({ error: "Failed to save quiz session: " + sessionErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] Step 1 OK — session id:", session.id);

    // 2. Save individual answers
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
      if (answersErr) console.error("[save-quiz-results] Step 2 FAILED:", answersErr.message, answersErr.details);
      else console.log("[save-quiz-results] Step 2 OK —", answerRows.length, "answers saved");
    } else {
      console.log("[save-quiz-results] Step 2: No answers to save");
    }

    // 3. Update profile: add coins and xp
    console.log("[save-quiz-results] Step 3: Fetching profile for", userId);
    const { data: profile, error: profileFetchErr } = await supabaseAdmin
      .from("profiles")
      .select("coins, xp, streak, max_streak")
      .eq("id", userId)
      .single();

    if (profileFetchErr) {
      console.error("[save-quiz-results] Step 3 FAILED — profile fetch:", profileFetchErr.message);
      return NextResponse.json({ error: "Failed to fetch profile: " + profileFetchErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] Step 3 — current profile:", JSON.stringify(profile));

    const newCoins = (profile.coins ?? 0) + coinsEarned;
    const newXp = (profile.xp ?? 0) + xpEarned;

    console.log("[save-quiz-results] Step 3: Updating profile — coins:", profile.coins, "→", newCoins, "xp:", profile.xp, "→", newXp);
    const { error: profileUpdateErr } = await supabaseAdmin
      .from("profiles")
      .update({ coins: newCoins, xp: newXp })
      .eq("id", userId);

    if (profileUpdateErr) {
      console.error("[save-quiz-results] Step 3 FAILED — profile update:", profileUpdateErr.message);
      return NextResponse.json({ error: "Failed to update profile: " + profileUpdateErr.message }, { status: 500 });
    }
    console.log("[save-quiz-results] Step 3 OK — profile updated");

    // 4. Log coin transaction
    if (coinsEarned > 0) {
      console.log("[save-quiz-results] Step 4: Logging coin transaction...");
      const { error: txnErr } = await supabaseAdmin.from("coin_transactions").insert({
        user_id: userId,
        amount: coinsEarned,
        type: "quiz_reward",
        reference_id: String(session.id),
        description: `${subject} quiz — ${correctAnswers}/${totalQuestions} correct`,
      });
      if (txnErr) console.error("[save-quiz-results] Step 4 FAILED:", txnErr.message);
      else console.log("[save-quiz-results] Step 4 OK — coin_transaction logged:", coinsEarned);
    }

    // 5. Upsert daily_activity + update streak
    console.log("[save-quiz-results] Step 5: Daily activity + streak...");
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
      if (dailyUpdateErr) console.error("[save-quiz-results] Step 5 FAILED daily update:", dailyUpdateErr.message);
      else console.log("[save-quiz-results] Step 5 OK — daily_activity updated");
    } else {
      const { error: dailyInsertErr } = await supabaseAdmin.from("daily_activity").insert({
        user_id: userId,
        date: today,
        questions_answered: totalQuestions,
        coins_earned: coinsEarned,
        streak_maintained: true,
      });
      if (dailyInsertErr) console.error("[save-quiz-results] Step 5 FAILED daily insert:", dailyInsertErr.message);
      else console.log("[save-quiz-results] Step 5 OK — daily_activity inserted");

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
      if (streakErr) console.error("[save-quiz-results] Step 5 FAILED streak:", streakErr.message);
      else console.log("[save-quiz-results] Step 5 OK — streak:", currentStreak, "→", newStreak);
    }

    // 6. Fetch final profile to return
    console.log("[save-quiz-results] Step 6: Fetching final profile...");
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
    console.error("[save-quiz-results] UNEXPECTED ERROR:", err);
    return NextResponse.json({ error: "Internal server error: " + String(err) }, { status: 500 });
  }
}
