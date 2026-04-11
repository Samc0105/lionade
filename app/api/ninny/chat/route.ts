import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { buildNinnyChatSystemPrompt } from "@/lib/ninny";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_BYTES = 2000; // 2 KB user message cap
const HISTORY_LIMIT = 12; // last 12 messages (6 turns) for context

// ─── GET — fetch chat history for a material ────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const materialId = req.nextUrl.searchParams.get("materialId");
  if (!materialId) {
    return NextResponse.json({ error: "Missing materialId" }, { status: 400 });
  }

  // Verify material ownership
  const { data: material } = await supabaseAdmin
    .from("ninny_materials")
    .select("id, user_id")
    .eq("id", materialId)
    .single();
  if (!material || material.user_id !== userId) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  const { data: messages, error } = await supabaseAdmin
    .from("ninny_chat_messages")
    .select("id, role, content, created_at")
    .eq("material_id", materialId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[ninny/chat GET]", error.message);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [] });
}

// ─── POST — send a message, get Ninny's response ────────────────────────────
export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 500 });
  }
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: { materialId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { materialId } = body;
  const message = String(body.message ?? "").trim();

  if (!materialId) {
    return NextResponse.json({ error: "Missing materialId" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_BYTES) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_MESSAGE_BYTES} chars)` },
      { status: 413 },
    );
  }

  // Fetch material + verify ownership
  const { data: material, error: matErr } = await supabaseAdmin
    .from("ninny_materials")
    .select("id, user_id, title, subject, raw_content, generated_content")
    .eq("id", materialId)
    .single();
  if (matErr || !material || material.user_id !== userId) {
    return NextResponse.json({ error: "Material not found" }, { status: 404 });
  }

  // Fetch recent history for context
  const { data: history } = await supabaseAdmin
    .from("ninny_chat_messages")
    .select("role, content")
    .eq("material_id", materialId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  // Reverse to chronological + map to OpenAI format
  const historyMessages = (history ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const systemPrompt = buildNinnyChatSystemPrompt(material);

  // Save user message FIRST so it's persisted even if OpenAI fails
  const { data: userMsgRow, error: userMsgErr } = await supabaseAdmin
    .from("ninny_chat_messages")
    .insert({
      user_id: userId,
      material_id: materialId,
      role: "user",
      content: message,
    })
    .select("id, role, content, created_at")
    .single();

  if (userMsgErr) {
    console.error("[ninny/chat POST] save user msg:", userMsgErr.message);
    return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
  }

  try {
    // 20s hard timeout — chat replies are short, must not pin the worker.
    let openaiRes: Response;
    try {
      openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(20000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            { role: "user", content: message },
          ],
          temperature: 0.7,
          max_tokens: 400,
        }),
      });
    } catch (fetchErr) {
      console.error("[ninny/chat POST] OpenAI fetch failed/timed out:", fetchErr);
      return NextResponse.json(
        { error: "Ninny took too long to respond. Try again." },
        { status: 504 },
      );
    }

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("[ninny/chat POST] OpenAI:", openaiRes.status, errText);
      return NextResponse.json(
        { error: "Ninny is unreachable. Try again in a moment." },
        { status: 502 },
      );
    }

    const data = await openaiRes.json();
    const assistantText: string =
      data.choices?.[0]?.message?.content?.trim() ?? "";

    if (!assistantText) {
      return NextResponse.json(
        { error: "Empty response from Ninny" },
        { status: 502 },
      );
    }

    // Save assistant message
    const { data: assistantMsgRow, error: assistantErr } = await supabaseAdmin
      .from("ninny_chat_messages")
      .insert({
        user_id: userId,
        material_id: materialId,
        role: "assistant",
        content: assistantText,
      })
      .select("id, role, content, created_at")
      .single();

    if (assistantErr) {
      console.error("[ninny/chat POST] save assistant msg:", assistantErr.message);
      // Return the text anyway — user already has it
      return NextResponse.json({
        userMessage: userMsgRow,
        assistantMessage: {
          id: "unsaved",
          role: "assistant",
          content: assistantText,
          created_at: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({
      userMessage: userMsgRow,
      assistantMessage: assistantMsgRow,
    });
  } catch (e) {
    console.error("[ninny/chat POST] unexpected:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
