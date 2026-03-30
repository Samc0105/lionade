#!/usr/bin/env npx tsx
/**
 * Auto-generate quiz questions using Google Gemini and seed them into Supabase.
 *
 * Env vars (set in GitHub Secrets or .env.local):
 *   GEMINI_API_KEY
 *   SUPABASE_URL           (or NEXT_PUBLIC_SUPABASE_URL from .env.local)
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY from .env.local)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── Env ──────────────────────────────────────────────────────
// Support both GitHub Actions env vars and local .env.local
let SUPABASE_URL = process.env.SUPABASE_URL;
let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    const env: Record<string, string> = {};
    fs.readFileSync(envPath, "utf8")
      .split("\n")
      .forEach((line) => {
        const eq = line.indexOf("=");
        if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      });
    SUPABASE_URL = SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
    SUPABASE_KEY = SUPABASE_KEY || env.SUPABASE_SECRET_KEY;
    GEMINI_API_KEY = GEMINI_API_KEY || env.GEMINI_API_KEY;
  }
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY");
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────

const TARGET_COUNT = 100;
const BATCH_SIZE = 50;
const QUESTIONS_PER_REQUEST = 20; // How many questions to ask Gemini for at once
const MAX_COMBOS_PER_RUN = 3; // Limit per hourly run to control costs

/**
 * Priority list of subject/topic/difficulty combos to fill.
 * Add new entries here to expand question coverage.
 */
const PRIORITY_COMBOS: { subject: string; topic: string; difficulty: string }[] = [
  // Astronomy (new — no questions yet)
  { subject: "Science", topic: "astronomy", difficulty: "beginner" },
  { subject: "Science", topic: "astronomy", difficulty: "intermediate" },
  { subject: "Science", topic: "astronomy", difficulty: "advanced" },
  // Add more combos below as needed, e.g.:
  // { subject: "Science", topic: "biology", difficulty: "advanced" },
  // { subject: "Math", topic: "calculus", difficulty: "intermediate" },
];

interface RawQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  subject: string;
  difficulty: string;
  topic: string;
}

// ── Helpers ──────────────────────────────────────────────────

function makeUUID(q: RawQuestion): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${q.subject}:${q.difficulty}:${q.question}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function countExisting(subject: string, topic: string, difficulty: string): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/questions?subject=eq.${encodeURIComponent(subject)}&topic=eq.${encodeURIComponent(topic)}&difficulty=eq.${encodeURIComponent(difficulty)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
    }
  );
  const range = res.headers.get("content-range"); // e.g. "0-0/42"
  if (range) {
    const total = range.split("/")[1];
    return total === "*" ? 0 : parseInt(total, 10);
  }
  return 0;
}

async function generateQuestions(
  topic: string,
  difficulty: string,
  count: number
): Promise<RawQuestion[]> {
  const prompt = `Generate exactly ${count} multiple-choice quiz questions about ${topic} at the ${difficulty} level.

Return ONLY a valid JSON array. Each object must have exactly these fields:
- "question": the question text
- "options": array of exactly 4 answer strings
- "correct_answer": one of the 4 options (must match exactly)
- "explanation": 1-2 sentence explanation of the correct answer
- "subject": "science"
- "difficulty": "${difficulty}"
- "topic": "${topic}"

Rules:
- Questions must be factually accurate
- All 4 options must be plausible
- No duplicate questions
- Difficulty guide: beginner = introductory/recall, intermediate = application/analysis, advanced = synthesis/evaluation
- Return ONLY the JSON array, no markdown fences, no extra text`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Extract JSON array — handle possible markdown fences
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array found in Gemini response");

  const questions: RawQuestion[] = JSON.parse(jsonMatch[0]);
  return questions;
}

function validateQuestion(q: unknown): q is RawQuestion {
  if (!q || typeof q !== "object") return false;
  const r = q as Record<string, unknown>;
  return (
    typeof r.question === "string" &&
    r.question.length > 0 &&
    Array.isArray(r.options) &&
    r.options.length === 4 &&
    r.options.every((o: unknown) => typeof o === "string") &&
    typeof r.correct_answer === "string" &&
    (r.options as string[]).includes(r.correct_answer) &&
    typeof r.explanation === "string" &&
    r.explanation.length > 0 &&
    typeof r.subject === "string" &&
    typeof r.difficulty === "string" &&
    typeof r.topic === "string"
  );
}

async function upsertQuestions(rows: Record<string, unknown>[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/questions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`  Upsert batch failed: ${res.status} — ${err}`);
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("=== Auto Question Generator (Gemini) ===\n");

  let combosProcessed = 0;
  let totalGenerated = 0;

  for (const combo of PRIORITY_COMBOS) {
    if (combosProcessed >= MAX_COMBOS_PER_RUN) {
      console.log(`Reached max ${MAX_COMBOS_PER_RUN} combos per run, stopping.`);
      break;
    }

    const existing = await countExisting(combo.subject, combo.topic, combo.difficulty);
    const needed = TARGET_COUNT - existing;

    console.log(`${combo.topic} (${combo.difficulty}): ${existing}/${TARGET_COUNT} exist`);

    if (needed <= 0) {
      console.log("  Already at target, skipping.\n");
      continue;
    }

    console.log(`  Generating ${needed} questions via Gemini Flash...`);

    const allGenerated: RawQuestion[] = [];
    let remaining = needed;

    while (remaining > 0) {
      const batchCount = Math.min(remaining, QUESTIONS_PER_REQUEST);
      try {
        const questions = await generateQuestions(combo.topic, combo.difficulty, batchCount);
        const valid = questions.filter(validateQuestion);
        console.log(`  Got ${questions.length} from API, ${valid.length} valid`);
        allGenerated.push(...valid);
        remaining -= valid.length;
      } catch (err) {
        console.error(`  Generation error: ${err}`);
        break;
      }
    }

    if (allGenerated.length === 0) {
      console.log("  No valid questions generated, skipping.\n");
      continue;
    }

    // Save to JSON file
    const subjectDir = path.join(__dirname, "..", "questions", "science", combo.topic);
    fs.mkdirSync(subjectDir, { recursive: true });
    const filename = `${combo.topic}-${combo.difficulty}-auto.json`;
    const filepath = path.join(subjectDir, filename);

    // Merge with existing file if it exists
    let existingQuestions: RawQuestion[] = [];
    if (fs.existsSync(filepath)) {
      existingQuestions = JSON.parse(fs.readFileSync(filepath, "utf8"));
    }
    const merged = [...existingQuestions, ...allGenerated];
    fs.writeFileSync(filepath, JSON.stringify(merged, null, 2));
    console.log(`  Saved ${allGenerated.length} questions to ${filename}`);

    // Upsert into Supabase
    const rows = allGenerated.map((q) => ({
      id: makeUUID(q),
      subject: combo.subject,
      question: q.question,
      options: q.options,
      correct_answer: q.options.indexOf(q.correct_answer),
      difficulty: q.difficulty.toLowerCase(),
      explanation: q.explanation,
      topic: q.topic.toLowerCase(),
    }));

    const inserted = await upsertQuestions(rows);
    console.log(`  Seeded ${inserted} questions into Supabase\n`);

    totalGenerated += allGenerated.length;
    combosProcessed++;
  }

  console.log(`\nDone! Generated ${totalGenerated} questions across ${combosProcessed} combos.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
