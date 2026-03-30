#!/usr/bin/env npx tsx
/**
 * Smart priority question generator.
 *
 * Each run:
 *  1. Counts questions for all 27 subject/difficulty combos in Supabase
 *  2. Picks the combo with the fewest questions (alphabetical tiebreak)
 *  3. Generates exactly 100 questions via Gemini 2.0 Flash
 *  4. Seeds them to Supabase + saves JSON to repo
 *
 * Target: 200 questions per combo. Exits when all combos are at 200+.
 *
 * Env vars (GitHub Secrets or .env.local):
 *   GEMINI_API_KEY
 *   SUPABASE_URL           (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── Env ──────────────────────────────────────────────────────

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
        if (eq > 0)
          env[line.slice(0, eq).trim()] = line
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
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

const TARGET_COUNT = 200;
const QUESTIONS_PER_RUN = 100;
const QUESTIONS_PER_REQUEST = 25;
const BATCH_SIZE = 50;

/** All 27 combos: 9 topics x 3 difficulties */
const TOPIC_CONFIG: Record<string, { dbSubject: string; label: string; dir: string }> = {
  algebra:          { dbSubject: "Math",           label: "Algebra",          dir: "math" },
  biology:          { dbSubject: "Science",        label: "Biology",          dir: "science" },
  chemistry:        { dbSubject: "Science",        label: "Chemistry",        dir: "science" },
  physics:          { dbSubject: "Science",        label: "Physics",          dir: "science" },
  "earth-science":  { dbSubject: "Science",        label: "Earth Science",    dir: "science" },
  astronomy:        { dbSubject: "Science",        label: "Astronomy",        dir: "science" },
  "us-history":     { dbSubject: "History",        label: "US History",       dir: "history" },
  "global-history": { dbSubject: "History",        label: "Global History",   dir: "history" },
  "social-studies": { dbSubject: "Social Studies", label: "Social Studies",   dir: "social-studies" },
};

const TOPICS = Object.keys(TOPIC_CONFIG);
const DIFFICULTIES = ["beginner", "intermediate", "advanced"];

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
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
}

async function countExisting(
  dbSubject: string,
  topic: string,
  difficulty: string
): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/questions?subject=eq.${encodeURIComponent(dbSubject)}&topic=eq.${encodeURIComponent(topic)}&difficulty=eq.${encodeURIComponent(difficulty)}&select=id`,
    {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
    }
  );
  const range = res.headers.get("content-range");
  if (range) {
    const total = range.split("/")[1];
    return total === "*" ? 0 : parseInt(total, 10);
  }
  return 0;
}

async function fetchExistingQuestions(
  dbSubject: string,
  topic: string,
  difficulty: string
): Promise<string[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/questions?subject=eq.${encodeURIComponent(dbSubject)}&topic=eq.${encodeURIComponent(topic)}&difficulty=eq.${encodeURIComponent(difficulty)}&select=question&limit=500`,
    {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data ?? []).map((r: { question: string }) => r.question);
}

async function generateQuestions(
  topic: string,
  label: string,
  difficulty: string,
  dbSubject: string,
  count: number,
  existingSamples: string[]
): Promise<RawQuestion[]> {
  const sampleBlock =
    existingSamples.length > 0
      ? `\nHere are some existing questions to AVOID duplicating:\n${existingSamples.slice(0, 10).map((q) => `- ${q}`).join("\n")}\n`
      : "";

  const prompt = `Generate exactly ${count} multiple-choice quiz questions about ${label} at the ${difficulty} level.
${sampleBlock}
Return ONLY a valid JSON array. Each object must have exactly these fields:
- "question": the question text
- "options": array of exactly 4 answer strings
- "correct_answer": one of the 4 options (must match exactly)
- "explanation": 1-2 sentence explanation of the correct answer
- "subject": "${dbSubject.toLowerCase()}"
- "difficulty": "${difficulty}"
- "topic": "${topic}"

Rules:
- Questions must be factually accurate
- All 4 options must be plausible
- No duplicate questions
- Mix question styles: definitions, application, problem-solving, conceptual, compare/contrast
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

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("No JSON array found in Gemini response");

  return JSON.parse(jsonMatch[0]);
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
  console.log("=== Smart Priority Question Generator ===\n");
  console.log("Checking question counts across all 27 combos...\n");

  // 1. Count all 27 combos
  const comboCounts: { topic: string; difficulty: string; count: number }[] = [];

  for (const topic of TOPICS) {
    const cfg = TOPIC_CONFIG[topic];
    for (const difficulty of DIFFICULTIES) {
      const count = await countExisting(cfg.dbSubject, topic, difficulty);
      comboCounts.push({ topic, difficulty, count });
      const bar = "█".repeat(Math.min(Math.round(count / 10), 20)).padEnd(20, "░");
      console.log(`  ${(cfg.label + " " + difficulty).padEnd(30)} ${bar} ${count}/${TARGET_COUNT}`);
    }
  }

  // 2. Filter to combos that need questions, sort by count asc then topic alphabetically
  const needWork = comboCounts
    .filter((c) => c.count < TARGET_COUNT)
    .sort((a, b) => a.count - b.count || a.topic.localeCompare(b.topic) || a.difficulty.localeCompare(b.difficulty));

  if (needWork.length === 0) {
    console.log("\nAll combos complete! Every combo has 200+ questions.");
    return;
  }

  // 3. Pick the top 1 combo
  const target = needWork[0];
  const cfg = TOPIC_CONFIG[target.topic];

  console.log(`\nLowest combo: ${cfg.label} ${target.difficulty} with ${target.count} questions`);
  console.log(`Generating ${QUESTIONS_PER_RUN} questions...\n`);

  // 4. Fetch existing questions for dedup context
  const existingSamples = await fetchExistingQuestions(cfg.dbSubject, target.topic, target.difficulty);

  // 5. Generate questions in batches of 25
  const allGenerated: RawQuestion[] = [];
  const seenQuestions = new Set(existingSamples.map((q) => q.toLowerCase().trim()));
  let attempts = 0;
  const maxAttempts = 8; // Safety valve

  while (allGenerated.length < QUESTIONS_PER_RUN && attempts < maxAttempts) {
    attempts++;
    const remaining = QUESTIONS_PER_RUN - allGenerated.length;
    const batchCount = Math.min(remaining, QUESTIONS_PER_REQUEST);

    try {
      const questions = await generateQuestions(
        target.topic,
        cfg.label,
        target.difficulty,
        cfg.dbSubject,
        batchCount,
        existingSamples
      );

      const valid = questions.filter((q) => {
        if (!validateQuestion(q)) return false;
        const key = q.question.toLowerCase().trim();
        if (seenQuestions.has(key)) return false;
        seenQuestions.add(key);
        return true;
      });

      allGenerated.push(...valid);
      console.log(`  Batch ${attempts}: got ${questions.length} from API, ${valid.length} valid/unique (total: ${allGenerated.length}/${QUESTIONS_PER_RUN})`);
    } catch (err) {
      console.error(`  Batch ${attempts} error: ${(err as Error).message}`);
    }
  }

  if (allGenerated.length === 0) {
    console.log("\nNo valid questions generated. Exiting.");
    process.exit(1);
  }

  // Cap at target
  const final = allGenerated.slice(0, QUESTIONS_PER_RUN);

  // 6. Save JSON file
  const subjectDir = path.join(__dirname, "..", "questions", cfg.dir, target.topic);
  fs.mkdirSync(subjectDir, { recursive: true });
  const filename = `${target.topic}-${target.difficulty}-auto.json`;
  const filepath = path.join(subjectDir, filename);

  let existingFile: RawQuestion[] = [];
  if (fs.existsSync(filepath)) {
    try {
      existingFile = JSON.parse(fs.readFileSync(filepath, "utf8"));
    } catch {
      existingFile = [];
    }
  }
  fs.writeFileSync(filepath, JSON.stringify([...existingFile, ...final], null, 2));
  console.log(`\nSaved ${final.length} questions to questions/${cfg.dir}/${target.topic}/${filename}`);

  // 7. Upsert into Supabase
  const rows = final.map((q) => ({
    id: makeUUID(q),
    subject: cfg.dbSubject,
    question: q.question,
    options: q.options,
    correct_answer: q.options.indexOf(q.correct_answer),
    difficulty: q.difficulty.toLowerCase(),
    explanation: q.explanation,
    topic: q.topic.toLowerCase(),
  }));

  const inserted = await upsertQuestions(rows);
  const newTotal = target.count + inserted;
  console.log(`Successfully seeded ${inserted} questions. New total: ${newTotal}`);
  console.log(`\nDone! ${cfg.label} ${target.difficulty}: ${target.count} → ${newTotal}/${TARGET_COUNT}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
