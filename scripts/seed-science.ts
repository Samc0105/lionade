#!/usr/bin/env npx tsx
import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── Read .env.local ──────────────────────────────────────────
const envPath = path.join(__dirname, "..", ".env.local");
const env: Record<string, string> = {};
fs.readFileSync(envPath, "utf8")
  .split("\n")
  .forEach((line) => {
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  });

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE env vars in .env.local");
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────
const SCIENCE_DIR = path.join(__dirname, "..", "questions", "science");
const BATCH_SIZE = 50;

// Skip astronomy entirely
const SKIP_TOPICS = ["astronomy"];

interface RawQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  subject: string;
  difficulty: string;
  topic: string;
}

/** Deterministic UUID from question text so upserts are idempotent */
function makeUUID(q: RawQuestion): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${q.subject}:${q.difficulty}:${q.question}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const files = fs.readdirSync(SCIENCE_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} JSON files in questions/science/\n`);

  let grandTotal = 0;

  for (const file of files) {
    // Skip astronomy files
    if (SKIP_TOPICS.some((t) => file.toLowerCase().includes(t))) {
      console.log(`Skipping ${file} (excluded topic)`);
      continue;
    }

    const raw: RawQuestion[] = JSON.parse(fs.readFileSync(path.join(SCIENCE_DIR, file), "utf8"));
    const questions = Array.isArray(raw) ? raw : [raw];
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;

    for (const q of questions) {
      if (
        !q.question ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        !q.correct_answer ||
        !q.explanation ||
        !q.subject ||
        !q.difficulty ||
        !q.topic
      ) {
        skipped++;
        continue;
      }

      // Skip astronomy questions even if inside a mixed file
      if (SKIP_TOPICS.includes(q.topic.toLowerCase())) {
        skipped++;
        continue;
      }

      const correctIndex = q.options.indexOf(q.correct_answer);
      if (correctIndex === -1) {
        console.warn(`  ⚠ Answer not in options: "${q.correct_answer.slice(0, 40)}…" in ${file}`);
        skipped++;
        continue;
      }

      rows.push({
        id: makeUUID(q),
        subject: "Science",
        question: q.question,
        options: q.options,
        correct_answer: correctIndex,
        difficulty: q.difficulty.toLowerCase(),
        explanation: q.explanation,
        topic: q.topic.toLowerCase(),
      });
    }

    if (skipped > 0) console.warn(`  Skipped ${skipped} questions in ${file}`);

    // Upsert in batches
    let fileInserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/questions`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`  Batch FAILED for ${file}: ${res.status} — ${err}`);
      } else {
        fileInserted += batch.length;
      }
    }

    console.log(`✓ Seeded ${fileInserted} questions from ${file}`);
    grandTotal += fileInserted;
  }

  console.log(`\nDone! Total: ${grandTotal} science questions seeded.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
