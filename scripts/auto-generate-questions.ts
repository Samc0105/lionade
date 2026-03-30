#!/usr/bin/env npx tsx
/**
 * Dual-API smart priority question generator with retry logic.
 *
 * Each run (up to 55 minutes):
 *  1. Scans all 27 combos, picks lowest
 *  2. Generates 25 questions per batch with 5s delays between
 *  3. Retries on 429 (wait 60s), Groq primary → Gemini key 1 → Gemini key 2
 *  4. Seeds to Supabase + saves JSON
 *  5. Moves to next combo if time remains
 *
 * Target: 1000 questions per combo (27,000 total).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── Env ──────────────────────────────────────────────────────

let SUPABASE_URL = process.env.SUPABASE_URL;
let SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let GROQ_API_KEY = process.env.GROQ_API_KEY;
let GEMINI_KEY_1 = process.env.GEMINI_API_KEY;
let GEMINI_KEY_2 = process.env.GEMINI_API_KEY_2;

if (!SUPABASE_URL || !SUPABASE_KEY || !GROQ_API_KEY || !GEMINI_KEY_1) {
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
    GROQ_API_KEY = GROQ_API_KEY || env.GROQ_API_KEY;
    GEMINI_KEY_1 = GEMINI_KEY_1 || env.GEMINI_API_KEY;
    GEMINI_KEY_2 = GEMINI_KEY_2 || env.GEMINI_API_KEY_2;
  }
}

// Collect available Gemini keys (filter out undefined)
const GEMINI_KEYS: string[] = [GEMINI_KEY_1, GEMINI_KEY_2].filter(
  (k): k is string => typeof k === "string" && k.length > 0
);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!GROQ_API_KEY && GEMINI_KEYS.length === 0) {
  console.error("Missing both GROQ_API_KEY and all GEMINI_API_KEYs — need at least one");
  process.exit(1);
}

console.log(`APIs available: Groq ${GROQ_API_KEY ? "yes" : "no"}, Gemini keys: ${GEMINI_KEYS.length}`);

// ── Config ───────────────────────────────────────────────────

const TARGET_COUNT = 1000;
const BATCH_QUESTIONS = 25;
const GEMINI_BATCHES = 4;  // 4 x 25 = 100
const GROQ_BATCHES = 6;    // 6 x 25 = 150
const DELAY_BETWEEN_BATCHES_MS = 5000;
const RATE_LIMIT_WAIT_MS = 60000;
const RETRY_WAIT_MS = 30000;
const MAX_RUN_MINUTES = 55;
const SUPABASE_BATCH = 50;

const RUN_START = Date.now();

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

// ── Utilities ────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function minutesElapsed(): number {
  return (Date.now() - RUN_START) / 60000;
}

function minutesRemaining(): number {
  return Math.max(0, MAX_RUN_MINUTES - minutesElapsed());
}

function makeUUID(q: RawQuestion): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${q.subject}:${q.difficulty}:${q.question}`)
    .digest("hex");
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join("-");
}

function buildPrompt(
  topic: string, label: string, difficulty: string, jsonSubject: string,
  count: number, existingSamples: string[]
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
    typeof r.question === "string" && r.question.length > 0 &&
    Array.isArray(r.options) && r.options.length === 4 &&
    r.options.every((o: unknown) => typeof o === "string" && o.length > 0) &&
    typeof r.correct_answer === "string" && r.correct_answer.length > 0 &&
    (r.options as string[]).includes(r.correct_answer) &&
    typeof r.explanation === "string" && r.explanation.length > 0 &&
    typeof r.subject === "string" &&
    typeof r.difficulty === "string" &&
    typeof r.topic === "string"
  );
}

// ── Supabase ─────────────────────────────────────────────────

async function countExisting(dbSubject: string, topic: string, difficulty: string): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/questions?subject=eq.${encodeURIComponent(dbSubject)}&topic=eq.${encodeURIComponent(topic)}&difficulty=eq.${encodeURIComponent(difficulty)}&select=id`,
    { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: "count=exact", Range: "0-0" } }
  );
  const range = res.headers.get("content-range");
  if (range) { const t = range.split("/")[1]; return t === "*" ? 0 : parseInt(t, 10); }
  return 0;
}

async function fetchExistingQuestions(dbSubject: string, topic: string, difficulty: string): Promise<string[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/questions?subject=eq.${encodeURIComponent(dbSubject)}&topic=eq.${encodeURIComponent(topic)}&difficulty=eq.${encodeURIComponent(difficulty)}&select=question&limit=1000`,
    { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data ?? []).map((r: { question: string }) => r.question);
}

async function upsertQuestions(rows: Record<string, unknown>[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += SUPABASE_BATCH) {
    const batch = rows.slice(i, i + SUPABASE_BATCH);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/questions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) { console.error(`  Upsert batch failed: ${res.status} — ${(await res.text()).slice(0, 100)}`); }
    else { inserted += batch.length; }
  }
  return inserted;
}

// ── API Calls with Retry ─────────────────────────────────────

function is429(err: Error): boolean {
  return err.message.includes("429");
}

function makeCallGemini(apiKey: string) {
  return async function callGemini(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`Gemini ${res.status}: ${err.slice(0, 150)}`); }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  };
}

async function callGroq(prompt: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`Groq ${res.status}: ${err.slice(0, 150)}`); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function generateWithRetry(
  apiCall: (prompt: string) => Promise<string>,
  apiName: string,
  prompt: string,
  retries: number = 3
): Promise<{ text: string; api: string }> {
  for (let i = 0; i < retries; i++) {
    try {
      const text = await apiCall(prompt);
      return { text, api: apiName };
    } catch (err) {
      if (is429(err as Error) && i < retries - 1) {
        console.log(`  ${apiName} rate limited, waiting 60 seconds... (retry ${i + 1}/${retries - 1})`);
        await sleep(RATE_LIMIT_WAIT_MS);
      } else {
        throw err;
      }
    }
  }
  throw new Error(`${apiName} failed after ${retries} retries`);
}

/** Try Groq first (primary), then rotate through Gemini keys as fallback */
async function callWithFallback(prompt: string): Promise<{ text: string; api: string }> {
  // Primary: Groq
  if (GROQ_API_KEY) {
    try {
      return await generateWithRetry(callGroq, "Groq", prompt, 3);
    } catch (err) {
      console.log(`  Groq exhausted: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  // Fallback: rotate through available Gemini keys with 90s cooldown between each
  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const label = `Gemini key ${i + 1}`;
    console.log(`  Waiting 90 seconds before ${label} (rate limit cooldown)...`);
    await sleep(90000);
    console.log(`  Falling back to ${label}...`);
    try {
      return await generateWithRetry(makeCallGemini(GEMINI_KEYS[i]), label, prompt, 3);
    } catch (err) {
      console.log(`  ${label} exhausted: ${(err as Error).message.slice(0, 80)}`);
    }
  }

  throw new Error("All APIs failed after retries");
}

// ── Process one combo ────────────────────────────────────────

async function processCombo(
  topic: string, difficulty: string, currentCount: number
): Promise<{ added: number; bothFailed: boolean }> {
  const cfg = TOPIC_CONFIG[topic];
  const totalBatches = GROQ_API_KEY ? GROQ_BATCHES : GEMINI_BATCHES;
  const questionsTarget = totalBatches * BATCH_QUESTIONS;

  console.log(`\nTarget combo: ${cfg.label} ${difficulty} — currently ${currentCount} questions`);

  // Fetch existing for dedup
  const existingSamples = await fetchExistingQuestions(cfg.dbSubject, topic, difficulty);
  const seenQuestions = new Set(existingSamples.map((q) => q.toLowerCase().trim()));

  const allGenerated: RawQuestion[] = [];
  let activeApi = "unknown";
  let bothFailed = false;

  for (let batch = 1; batch <= totalBatches; batch++) {
    if (minutesRemaining() < 2) {
      console.log(`  Time limit approaching — stopping after ${batch - 1} batches`);
      break;
    }

    const remaining = questionsTarget - allGenerated.length;
    const count = Math.min(remaining, BATCH_QUESTIONS);
    if (count <= 0) break;

    console.log(`  Batch ${batch}/${totalBatches}: generating ${count} questions...`);

    const prompt = buildPrompt(topic, cfg.label, difficulty, cfg.jsonSubject, count, existingSamples);

    // Try with retry, then retry once more after 30s on failure
    let result: { text: string; api: string } | null = null;
    try {
      result = await callWithFallback(prompt);
    } catch {
      console.log(`  Batch ${batch} failed, retrying in 30 seconds...`);
      await sleep(RETRY_WAIT_MS);
      try {
        result = await callWithFallback(prompt);
      } catch {
        console.log(`  Batch ${batch} failed after retry — both APIs exhausted`);
        bothFailed = true;
        break;
      }
    }

    if (result) {
      activeApi = result.api;
      try {
        const parsed = parseJsonArray(result.text);
        const valid = (parsed as RawQuestion[]).filter((q) => {
          if (!validateQuestion(q)) return false;
          const key = q.question.toLowerCase().trim();
          if (seenQuestions.has(key)) return false;
          seenQuestions.add(key);
          return true;
        });
        allGenerated.push(...valid);
        console.log(`  Batch ${batch}/${totalBatches}: ${valid.length} valid questions (run total: ${allGenerated.length})`);
      } catch (err) {
        console.log(`  Batch ${batch} parse error: ${(err as Error).message.slice(0, 80)}`);
      }
    }

    // Delay between batches
    if (batch < totalBatches && allGenerated.length < questionsTarget) {
      console.log(`  Waiting ${DELAY_BETWEEN_BATCHES_MS / 1000} seconds before next batch...`);
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  if (allGenerated.length === 0) {
    console.log(`  No valid questions generated for ${cfg.label} ${difficulty}`);
    return { added: 0, bothFailed };
  }

  console.log(`\n  Generated ${allGenerated.length} valid questions via ${activeApi}`);

  // Save JSON
  const fileDir = path.join(__dirname, "..", "questions", cfg.dir);
  fs.mkdirSync(fileDir, { recursive: true });
  const filename = `${topic}-${difficulty}1.json`;
  const filepath = path.join(fileDir, filename);

  let existingFile: RawQuestion[] = [];
  if (fs.existsSync(filepath)) {
    try { existingFile = JSON.parse(fs.readFileSync(filepath, "utf8")); } catch { existingFile = []; }
  }
  fs.writeFileSync(filepath, JSON.stringify([...existingFile, ...allGenerated], null, 2));
  console.log(`  Saved to: questions/${cfg.dir}/${filename}`);

  // Upsert to Supabase
  const rows = allGenerated.map((q) => ({
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
  const newTotal = currentCount + inserted;
  console.log(`  Seeded to Supabase: success`);
  console.log(`  Combo complete: ${cfg.label} ${difficulty} — added ${inserted} questions, new total: ${newTotal}`);

  return { added: inserted, bothFailed };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("=== Question Generation Run ===\n");
  console.log("Checking 27 subject/difficulty combos...\n");

  // 1. Count all combos
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

  // 2. Sort by lowest count
  const needWork = comboCounts
    .filter((c) => c.count < TARGET_COUNT)
    .sort((a, b) => a.count - b.count || a.topic.localeCompare(b.topic) || a.difficulty.localeCompare(b.difficulty));

  if (needWork.length === 0) {
    console.log("\nAll combos complete! Every combo has 1000+ questions.");
    return;
  }

  console.log(`\n${needWork.length} combos need questions. Time budget: ${MAX_RUN_MINUTES} minutes.`);

  // 3. Process combos until time runs out
  let totalAdded = 0;
  let combosProcessed = 0;

  for (const combo of needWork) {
    if (minutesRemaining() < 3) {
      console.log(`\nTime remaining: ${Math.round(minutesRemaining())} minutes — stopping`);
      break;
    }

    console.log(`\nTime remaining: ${Math.round(minutesRemaining())} minutes — starting next combo...`);

    const { added, bothFailed } = await processCombo(combo.topic, combo.difficulty, combo.count);
    totalAdded += added;
    combosProcessed++;

    if (bothFailed) {
      console.log("\nBoth APIs exhausted — saving what we have and exiting.");
      break;
    }
  }

  console.log(`\n=== Run Complete ===`);
  console.log(`Combos processed: ${combosProcessed}`);
  console.log(`Total questions added: ${totalAdded}`);
  console.log(`Time elapsed: ${Math.round(minutesElapsed())} minutes`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
