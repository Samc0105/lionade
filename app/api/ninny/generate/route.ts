import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  buildNinnyPrompt,
  validateGeneratedContent,
  getNinnyFangCost,
  NINNY_DAILY_LIMIT,
  NINNY_FREE_PER_DAY,
  type NinnyDifficulty,
  type NinnyGeneratedContent,
  type NinnySourceType,
} from "@/lib/ninny";

const MAX_CONTENT_BYTES = 20 * 1024; // 20 KB cap on user content

const MIN_ITEMS_PER_MODE = 8;
const ARRAY_KEYS: (keyof NinnyGeneratedContent)[] = [
  "flashcards",
  "match",
  "multipleChoice",
  "fillBlank",
  "trueFalse",
  "ordering",
  "blitz",
];

function isShortContent(c: NinnyGeneratedContent): boolean {
  return ARRAY_KEYS.some((k) => {
    const arr = c[k];
    return Array.isArray(arr) && arr.length < MIN_ITEMS_PER_MODE;
  });
}

async function callOpenAI(prompt: string): Promise<NinnyGeneratedContent | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Ninny, an AI study companion that returns ONLY valid JSON matching the requested schema. Never include markdown fences or explanatory text. You MUST generate exactly 10 items in every array — never fewer.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 8000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[ninny/generate] OpenAI error:", res.status, errText);
    return null;
  }

  const data = await res.json();
  const rawText: string = data.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(rawText);
    return validateGeneratedContent(parsed);
  } catch {
    console.error("[ninny/generate] JSON parse failed:", rawText.slice(0, 200));
    return null;
  }
}

export const dynamic = "force-dynamic";

interface GenerateRequest {
  sourceType: NinnySourceType;
  content: string;
  difficulty?: NinnyDifficulty;
}

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "AI not configured" },
      { status: 500 },
    );
  }
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // Auth: derive userId from session, NEVER trust the body
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceType, content } = body;
  const difficulty: NinnyDifficulty = body.difficulty ?? "medium";

  if (!sourceType || !content) {
    return NextResponse.json(
      { error: "Missing sourceType or content" },
      { status: 400 },
    );
  }

  if (!["pdf", "text", "topic"].includes(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  if (typeof content !== "string" || content.trim().length < 3) {
    return NextResponse.json({ error: "Content too short" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT_BYTES) {
    return NextResponse.json(
      { error: "Content too large (max 20 KB)" },
      { status: 413 },
    );
  }

  // 1. Today's generation count
  const todayUTC = new Date().toISOString().split("T")[0];
  const todayStart = `${todayUTC}T00:00:00.000Z`;
  const { count: todayCountRaw } = await supabaseAdmin
    .from("ninny_materials")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", todayStart);
  const todayCount = todayCountRaw ?? 0;

  // 2. Hard daily cap (protects OpenAI rate limits + cost)
  if (todayCount >= NINNY_DAILY_LIMIT) {
    return NextResponse.json(
      {
        error: `Daily cap reached (${NINNY_DAILY_LIMIT}/${NINNY_DAILY_LIMIT}). Come back tomorrow!`,
        limitReached: true,
      },
      { status: 429 },
    );
  }

  // 3. Free quota OR Fangs charge — atomic deduct, refund on failure
  const isFree = todayCount < NINNY_FREE_PER_DAY;
  const fangCost = isFree ? 0 : getNinnyFangCost(sourceType);
  let coinsBeforeCharge: number | null = null;

  if (!isFree) {
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("id", userId)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 500 });
    }
    if ((profile.coins ?? 0) < fangCost) {
      return NextResponse.json(
        {
          error: `Not enough Fangs. Need ${fangCost}, you have ${profile.coins ?? 0}.`,
          fangCost,
          userCoins: profile.coins ?? 0,
          insufficientFangs: true,
        },
        { status: 402 },
      );
    }
    const beforeCharge = profile.coins ?? 0;
    coinsBeforeCharge = beforeCharge;
    // Deduct now; refund below if generation fails
    const { error: chargeErr } = await supabaseAdmin
      .from("profiles")
      .update({ coins: beforeCharge - fangCost })
      .eq("id", userId);
    if (chargeErr) {
      console.error("[ninny/generate] charge:", chargeErr.message);
      return NextResponse.json({ error: "Charge failed" }, { status: 500 });
    }
    // Log the spend
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: -fangCost,
      type: "ninny_unlock",
      description: `Ninny ${sourceType} generation`,
    });
  }

  // Helper to refund the user if anything below this point fails
  const refundOnFailure = async (reason: string) => {
    if (isFree || coinsBeforeCharge === null) return;
    await supabaseAdmin
      .from("profiles")
      .update({ coins: coinsBeforeCharge + fangCost })
      .eq("id", userId);
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: fangCost,
      type: "ninny_refund",
      description: `Refund: ${reason}`,
    });
  };

  const prompt = buildNinnyPrompt(sourceType, content, difficulty);

  try {
    // First attempt
    let validated = await callOpenAI(prompt);
    if (!validated) {
      await refundOnFailure("OpenAI call failed");
      return NextResponse.json(
        { error: "AI generation failed" },
        { status: 502 },
      );
    }

    // Retry once if any array is short — protects against gpt-4o-mini cheaping out
    if (isShortContent(validated)) {
      console.warn("[ninny/generate] short content on first attempt, retrying");
      const retryPrompt =
        prompt +
        `\n\nIMPORTANT: Your previous attempt returned fewer than ${MIN_ITEMS_PER_MODE} items in at least one array. You MUST return exactly 10 items in EVERY array this time. No exceptions.`;
      const retried = await callOpenAI(retryPrompt);
      if (retried && !isShortContent(retried)) {
        validated = retried;
      } else {
        console.warn("[ninny/generate] retry still short, accepting anyway");
      }
    }

    const { data: material, error: insertErr } = await supabaseAdmin
      .from("ninny_materials")
      .insert({
        user_id: userId,
        title: validated.title,
        source_type: sourceType,
        raw_content: sourceType === "topic" ? content : content.slice(0, 15000),
        generated_content: validated,
        subject: validated.subject,
        difficulty: validated.difficulty,
      })
      .select("id, title, subject, difficulty, generated_content, created_at")
      .single();

    if (insertErr) {
      console.error("[ninny/generate] insert error:", insertErr.message);
      await refundOnFailure("DB insert failed");
      return NextResponse.json({ error: "Failed to save material" }, { status: 500 });
    }

    return NextResponse.json({ material, fangCost, wasFree: isFree });
  } catch (e) {
    console.error("[ninny/generate] unexpected:", e);
    await refundOnFailure("server error");
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
