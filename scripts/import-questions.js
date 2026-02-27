#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

// ── Read .env.local ──────────────────────────────────────────
const envPath = path.join(__dirname, "..", ".env.local");
const env = {};
fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
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
const QUESTIONS_DIR = path.join(__dirname, "..", "questions");
const BATCH_SIZE = 50;

const SUBJECT_MAP = {
  math: "Math", science: "Science", languages: "Languages",
  coding: "Coding", finance: "Finance", certifications: "Certifications",
  "sat/act": "SAT/ACT", testprep: "SAT/ACT",
};

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} JSON files in /questions\n`);

  const allRows = [];
  let totalSkipped = 0;

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, file), "utf8"));
    const questions = Array.isArray(raw) ? raw : [raw];
    let valid = 0;
    let skipped = 0;

    for (const q of questions) {
      // Validate required fields
      if (
        !q.question || !Array.isArray(q.options) || q.options.length !== 4 ||
        !q.correct_answer || !q.explanation || !q.subject || !q.difficulty || !q.topic
      ) {
        skipped++;
        continue;
      }

      // Convert correct_answer text → index
      const correctIndex = q.options.indexOf(q.correct_answer);
      if (correctIndex === -1) {
        console.warn(`  Warning: answer not in options — "${q.correct_answer.slice(0, 40)}…" in ${file}`);
        skipped++;
        continue;
      }

      const difficulty = q.difficulty.toLowerCase();
      const subject = SUBJECT_MAP[q.subject.toLowerCase()] || q.subject;

      allRows.push({
        subject,
        question: q.question,
        options: q.options,
        correct_answer: correctIndex,
        difficulty,
        explanation: q.explanation,
        topic: q.topic,
      });
      valid++;
    }

    console.log(`  ${file}: ${valid} valid, ${skipped} skipped`);
    totalSkipped += skipped;
  }

  console.log(`\nTotal: ${allRows.length} questions to insert, ${totalSkipped} skipped`);
  console.log(`Inserting in batches of ${BATCH_SIZE}...\n`);

  let totalInserted = 0;

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/questions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} FAILED: ${res.status} — ${err}`);
    } else {
      totalInserted += batch.length;
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${batch.length}`);
    }
  }

  console.log(`\nDone! ${totalInserted} inserted, ${totalSkipped} skipped.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
