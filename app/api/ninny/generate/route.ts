import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  buildNinnyPrompt,
  validateGeneratedContent,
  type NinnyDifficulty,
  type NinnySourceType,
} from "@/lib/ninny";

export const dynamic = "force-dynamic";

interface GenerateRequest {
  userId: string;
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

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, sourceType, content } = body;
  const difficulty: NinnyDifficulty = body.difficulty ?? "medium";

  if (!userId || !sourceType || !content) {
    return NextResponse.json(
      { error: "Missing userId, sourceType, or content" },
      { status: 400 },
    );
  }

  if (!["pdf", "text", "topic"].includes(sourceType)) {
    return NextResponse.json({ error: "Invalid sourceType" }, { status: 400 });
  }

  if (content.trim().length < 3) {
    return NextResponse.json({ error: "Content too short" }, { status: 400 });
  }

  const prompt = buildNinnyPrompt(sourceType, content, difficulty);

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
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
              "You are Ninny, an AI study companion that returns ONLY valid JSON matching the requested schema. Never include markdown fences or explanatory text.",
          },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("[ninny/generate] OpenAI error:", openaiRes.status, errText);
      return NextResponse.json(
        { error: "AI generation failed" },
        { status: 502 },
      );
    }

    const openaiData = await openaiRes.json();
    const rawText: string = openaiData.choices?.[0]?.message?.content ?? "";

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error("[ninny/generate] JSON parse failed:", rawText.slice(0, 200));
      return NextResponse.json(
        { error: "AI returned invalid JSON" },
        { status: 502 },
      );
    }

    const validated = validateGeneratedContent(parsed);
    if (!validated) {
      return NextResponse.json(
        { error: "AI returned malformed content" },
        { status: 502 },
      );
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
      return NextResponse.json({ error: "Failed to save material" }, { status: 500 });
    }

    return NextResponse.json({ material });
  } catch (e) {
    console.error("[ninny/generate] unexpected:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
