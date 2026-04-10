import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { NINNY_REWARDS, type NinnyMode } from "@/lib/ninny";

export const dynamic = "force-dynamic";

interface WrongAnswer {
  question: string;
  correctAnswer: string;
}

interface CompleteRequest {
  userId: string;
  materialId: string;
  mode: NinnyMode;
  score: number;
  total: number;
  wrongAnswers?: WrongAnswer[];
}

const VALID_MODES: NinnyMode[] = [
  "flashcards",
  "match",
  "mcq",
  "fill",
  "tf",
  "ordering",
  "blitz",
];

export async function POST(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let body: CompleteRequest;
  try {
    body = (await req.json()) as CompleteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, materialId, mode, score, total } = body;
  const wrongAnswers = body.wrongAnswers ?? [];

  if (!userId || !materialId || !mode) {
    return NextResponse.json(
      { error: "Missing userId, materialId, or mode" },
      { status: 400 },
    );
  }

  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  if (typeof score !== "number" || typeof total !== "number" || total <= 0) {
    return NextResponse.json({ error: "Invalid score/total" }, { status: 400 });
  }

  // Verify material belongs to user (cheap auth check via service role)
  const { data: material, error: matErr } = await supabaseAdmin
    .from("ninny_materials")
    .select("id, user_id")
    .eq("id", materialId)
    .single();

  if (matErr || !material || material.user_id !== userId) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  // Calculate rewards (scale by accuracy)
  const reward = NINNY_REWARDS[mode];
  const accuracy = Math.max(0, Math.min(1, score / total));
  const coinsEarned = Math.round(reward.coins * accuracy);
  const xpEarned = Math.round(reward.xp * accuracy);

  // 1. Insert session
  const { data: session, error: sessionErr } = await supabaseAdmin
    .from("ninny_sessions")
    .insert({
      user_id: userId,
      material_id: materialId,
      mode,
      score,
      total,
      coins_earned: coinsEarned,
      xp_earned: xpEarned,
    })
    .select("id")
    .single();

  if (sessionErr) {
    console.error("[ninny/complete] session insert:", sessionErr.message);
    return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  }

  // 2. Update profile coins/xp
  const { data: profile, error: profileFetchErr } = await supabaseAdmin
    .from("profiles")
    .select("coins, xp")
    .eq("id", userId)
    .single();

  if (profileFetchErr) {
    console.error("[ninny/complete] profile fetch:", profileFetchErr.message);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }

  const newCoins = (profile.coins ?? 0) + coinsEarned;
  const newXp = (profile.xp ?? 0) + xpEarned;

  const { error: profileUpdateErr } = await supabaseAdmin
    .from("profiles")
    .update({ coins: newCoins, xp: newXp })
    .eq("id", userId);

  if (profileUpdateErr) {
    console.error("[ninny/complete] profile update:", profileUpdateErr.message);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  // 3. Log coin transaction
  if (coinsEarned > 0) {
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: coinsEarned,
      type: "ninny_session",
      reference_id: String(session.id),
      description: `Ninny ${mode}: ${score}/${total}`,
    });
  }

  // 4. Save wrong answers (upsert with miss_count increment)
  if (wrongAnswers.length > 0) {
    for (const wa of wrongAnswers) {
      if (!wa.question || !wa.correctAnswer) continue;
      const { data: existing } = await supabaseAdmin
        .from("ninny_wrong_answers")
        .select("id, miss_count")
        .eq("user_id", userId)
        .eq("material_id", materialId)
        .eq("question_text", wa.question)
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from("ninny_wrong_answers")
          .update({
            miss_count: existing.miss_count + 1,
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("ninny_wrong_answers").insert({
          user_id: userId,
          material_id: materialId,
          question_text: wa.question,
          correct_answer: wa.correctAnswer,
          miss_count: 1,
        });
      }
    }
  }

  return NextResponse.json({
    success: true,
    sessionId: session.id,
    coinsEarned,
    xpEarned,
    newCoins,
    newXp,
  });
}
