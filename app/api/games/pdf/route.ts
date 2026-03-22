import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// POST — Process extracted PDF text with Claude to generate game content
export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || text.trim().length < 50) {
      return NextResponse.json({ error: "Not enough text to analyze" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "AI processing not configured" }, { status: 500 });
    }

    const truncated = text.slice(0, 15000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: `You are an educational content extractor. Analyze this study material and return ONLY a valid JSON object with these fields:
{
  "vocabulary": [{"term": "string", "definition": "string"}],
  "facts": [{"statement": "string", "isTrue": true}],
  "concepts": [{"question": "string", "answer": "string", "options": ["string", "string", "string", "string"]}],
  "timeline": [{"event": "string", "date": "string", "year": 0}],
  "keyTerms": ["string"]
}
Extract as many items as possible from the material. keyTerms should be single words between 4-6 letters suitable for a word guessing game. For concepts, provide exactly 4 options with the correct answer being one of them. Return ONLY the JSON, no other text.

Material:
${truncated}`,
        }],
      }),
    });

    if (!res.ok) {
      return NextResponse.json({ error: "AI processing failed" }, { status: 500 });
    }

    const data = await res.json();
    const responseText = data.content?.[0]?.text ?? "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return NextResponse.json({ error: "Could not parse AI response" }, { status: 500 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ content: parsed });
  } catch (e) {
    console.error("[games/pdf POST]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
