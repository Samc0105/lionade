#!/usr/bin/env npx tsx
/**
 * Dual-API smart priority question generator.
 *
 * Each run:
 *  1. Counts questions for all 27 subject/difficulty combos in Supabase
 *  2. Picks the combo with the fewest questions (alphabetical tiebreak)
 *  3. Tries Gemini first (100 questions), falls back to Groq (150 questions)
 *  4. Seeds to Supabase + saves JSON to repo
 *
 * Target: 1000 questions per combo (27,000 total).
 *
 * Env vars (GitHub Secrets or .env.local):
 *   GEMINI_API_KEY
 *   GROQ_API_KEY
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
let GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY || !GROQ_API_KEY) {
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
    GROQ_API_KEY = GROQ_API_KEY || env.GROQ_API_KEY;
  }
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!GEMINI_API_KEY && !GROQ_API_KEY) {
  console.error("Missing both GEMINI_API_KEY and GROQ_API_KEY — need at least one");
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────

const TARGET_COUNT = 1000;
const GEMINI_QUESTIONS_PER_RUN = 100;
const GROQ_QUESTIONS_PER_RUN = 150;
const GEMINI_BATCH = 25;
const GROQ_BATCH = 30;
const BATCH_SIZE = 50; // Supabase upsert batch

const TOPIC_CONFIG: Record<string, { dbSubject: string; jsonSubject: string; label: string; dir: string }> = {
  algebra:          { dbSubject: "Math",           jsonSubject: "math",    label: "Algebra",        dir: "math" },
  biology:          { dbSubject: "Science",        jsonSubject: "science", label: "Biology",        dir: "science" },
  chemistry:        { dbSubject: "Science",        jsonSubject: "science", label: "Chemistry",      dir: "science" },
  physics:          { dbSubject: "Science",        jsonSubject: "science", label: "Physics",        dir: "science" },
  "earth-science":  { dbSubject: "Science",        jsonSubject: "science", label: "Earth Science",  dir: "science" },
  astronomy:        { dbSubject: "Science",        jsonSubject: "science", label: "Astronomy",      dir: "science" },
  "us-history":     { dbSubject: "History",        jsonSubject: "history", label: "US History",     dir: "history" },
  "global-history": { dbSubject: "History",        jsonSubject: "history", label: "Global History", dir: "history" },
  "social-studies": { dbSubject: "Social Studies", jsonSubject: "social",  label: "Social Studies", dir: "social" },
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

function buildPrompt(
  topic: string,
  label: string,
  difficulty: string,
  jsonSubject: string,
  count: number,
  existingSamples: string[]
): string {
  const dedupBlock =
    existingSamples.length > 0
      ? `\nHere are some existing questions — do NOT repeat these:\n${existingSamples.slice(0, 15).map((q) => `- ${q}`).join("\n")}\n`
      : "";

  return `Generate exactly ${count} multiple choice questions about ${label} at ${difficulty} level for high school students.${dedupBlock}
Return ONLY a valid JSON array with no markdown, no backticks, no explanation.
Each question must have: question, options (array of 4), correct_answer (must match one option exactly), explanation, subject, difficulty, topic.
Make questions varied: definitions, applications, problem-solving, conceptual understanding.
Do not repeat questions.
Example format:
[{"question": "...", "options": ["A", "B", "C", "D"], "correct_answer": "A", "explanation": "...", "subject": "${jsonSubject}", "difficulty": "${difficulty}", "topic": "${topic}"}]`;
}

function parseJsonArray(text: string): unknown[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error("No JSON array found in response");
  return JSON.parse(match[0]);
}

function validateQuestion(q: unknown): q is RawQuestion {
  if (!q || typeof q !== "object") return false;
  const r = q as Record<string, unknown>;
  return (
    typeof r.question === "string" &&
    r.question.length > 0 &&
    Array.isArray(r.options) &&
    r.options.length === 4 &&
    r.options.every((o: unknown) => typeof o === "string" && o.length > 0) &&
    typeof r.correct_answer === "string" &&
    r.correct_answer.length > 0 &&
    (r.options as string[]).includes(r.correct_answer) &&
    typeof r.explanation === "string" &&
    r.explanation.length > 0 &&
    typeof r.subject === "string" &&
    typeof r.difficulty === "string" &&
    typeof r.topic === "string"
  );
}

// ── Supabase ─────────────────────────────────────────────────

async function countExisting(dbSubject: string, topic: string, difficulty: string): Promise<number> {
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

async function fetchExistingQuestions(dbSubject: string, topic: string, difficulty: string): Promise<string[]> {
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

// ── API Calls ────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Generation with fallback ─────────────────────────────────

async function generateBatch(
  prompt: string
): Promise<{ questions: RawQuestion[]; api: string }> {
  // Try Gemini first
  if (GEMINI_API_KEY) {
    try {
      const text = await callGemini(prompt);
      const parsed = parseJsonArray(text);
      return { questions: parsed as RawQuestion[], api: "Gemini" };
    } catch (err) {
      console.log(`  Gemini failed: ${(err as Error).message.slice(0, 100)}`);
      console.log("  Falling back to Groq...");
    }
  }

  // Fallback to Groq
  if (GROQ_API_KEY) {
    const text = await callGroq(prompt);
    const parsed = parseJsonArray(text);
    return { questions: parsed as RawQuestion[], api: "Groq" };
  }

  throw new Error("Both APIs unavailable");
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("=== Question Generation Run ===\n");
  console.log("Checking 27 subject/difficulty combos...\n");

  // 1. Count all 27 combos
  const comboCounts: { topic: string; difficulty: string; count: number }[] = [];

  for (const topic of TOPICS) {
    const cfg = TOPIC_CONFIG[topic];
    for (const difficulty of DIFFICULTIES) {
      const count = await countExisting(cfg.dbSubject, topic, difficulty);
      comboCounts.push({ topic, difficulty, count });
      const pct = Math.min(count / TARGET_COUNT, 1);
      const filled = Math.round(pct * 20);
      const bar = "\u2588".repeat(filled).padEnd(20, "\u2591");
      console.log(`  ${(cfg.label + " " + difficulty).padEnd(30)} ${bar} ${count}/${TARGET_COUNT}`);
    }
  }

  // 2. Find lowest combo under target
  const needWork = comboCounts
    .filter((c) => c.count < TARGET_COUNT)
    .sort((a, b) => a.count - b.count || a.topic.localeCompare(b.topic) || a.difficulty.localeCompare(b.difficulty));

  if (needWork.length === 0) {
    console.log("\nAll combos complete! Every combo has 1000+ questions.");
    return;
  }

  const target = needWork[0];
  const cfg = TOPIC_CONFIG[target.topic];

  console.log(`\nTarget combo: ${cfg.label} ${target.difficulty} — currently ${target.count} questions`);

  // 3. Fetch existing questions for dedup
  const existingSamples = await fetchExistingQuestions(cfg.dbSubject, target.topic, target.difficulty);
  const seenQuestions = new Set(existingSamples.map((q) => q.toLowerCase().trim()));

  // 4. Generate questions — try Gemini first, Groq on fallback
  let activeApi = "unknown";
  let questionsTarget = GEMINI_QUESTIONS_PER_RUN;
  let batchSize = GEMINI_BATCH;

  // Do a test call to determine which API works
  const testPrompt = buildPrompt(target.topic, cfg.label, target.difficulty, cfg.jsonSubject, batchSize, existingSamples);
  try {
    const testResult = await generateBatch(testPrompt);
    activeApi = testResult.api;
    if (activeApi === "Groq") {
      questionsTarget = GROQ_QUESTIONS_PER_RUN;
      batchSize = GROQ_BATCH;
    }

    // Process the test batch results
    const validFirst = testResult.questions.filter((q) => {
      if (!validateQuestion(q)) return false;
      const key = q.question.toLowerCase().trim();
      if (seenQuestions.has(key)) return false;
      seenQuestions.add(key);
      return true;
    });

    console.log(`Using API: ${activeApi}`);
    console.log(`Generating ${questionsTarget} questions...\n`);

    const allGenerated: RawQuestion[] = [...validFirst];
    console.log(`  Batch 1: got ${testResult.questions.length} from ${activeApi}, ${validFirst.length} valid/unique (total: ${allGenerated.length}/${questionsTarget})`);

    // Continue generating remaining batches
    let attempts = 1;
    const maxAttempts = 12;

    while (allGenerated.length < questionsTarget && attempts < maxAttempts) {
      attempts++;
      const remaining = questionsTarget - allGenerated.length;
      const count = Math.min(remaining, batchSize);
      const prompt = buildPrompt(target.topic, cfg.label, target.difficulty, cfg.jsonSubject, count, existingSamples);

      try {
        const result = await generateBatch(prompt);
        const valid = result.questions.filter((q) => {
          if (!validateQuestion(q)) return false;
          const key = q.question.toLowerCase().trim();
          if (seenQuestions.has(key)) return false;
          seenQuestions.add(key);
          return true;
        });
        allGenerated.push(...valid);
        console.log(`  Batch ${attempts}: got ${result.questions.length} from ${result.api}, ${valid.length} valid/unique (total: ${allGenerated.length}/${questionsTarget})`);
      } catch (err) {
        console.error(`  Batch ${attempts} error: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    if (allGenerated.length === 0) {
      console.log("\nNo valid questions generated. Exiting.");
      process.exit(1);
    }

    const final = allGenerated.slice(0, questionsTarget);
    console.log(`\nGenerated ${final.length} valid questions`);

    // 5. Save JSON file
    const fileDir = path.join(__dirname, "..", "questions", cfg.dir);
    fs.mkdirSync(fileDir, { recursive: true });
    const filename = `${target.topic}-${target.difficulty}1.json`;
    const filepath = path.join(fileDir, filename);

    let existingFile: RawQuestion[] = [];
    if (fs.existsSync(filepath)) {
      try {
        existingFile = JSON.parse(fs.readFileSync(filepath, "utf8"));
      } catch {
        existingFile = [];
      }
    }
    fs.writeFileSync(filepath, JSON.stringify([...existingFile, ...final], null, 2));
    console.log(`Saved to: questions/${cfg.dir}/${filename}`);

    // 6. Upsert into Supabase
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
    console.log(`Seeded to Supabase: success`);
    console.log(`New total for ${cfg.label} ${target.difficulty}: ${newTotal} questions`);

  } catch (err) {
    console.error(`\nBoth Gemini and Groq failed. Cannot generate questions.`);
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
