#!/usr/bin/env npx tsx
/**
 * One-shot fix for the answer-position bias in `mastery_questions`.
 *
 * LLMs (including gpt-4o) tend to place the correct answer at position A
 * when generating MCQs. Questions generated before 2026-04-23 went into
 * the cache with this bias intact, so every served question reads "A is
 * correct". This script walks the table and re-shuffles every row's
 * options + correct_index so the DB is balanced.
 *
 * Usage:
 *   npx tsx scripts/fix-mastery-answer-bias.ts            # dry-run, prints counts
 *   npx tsx scripts/fix-mastery-answer-bias.ts --apply     # writes shuffles back
 *
 * Safe to re-run — each pass just re-shuffles. Statistically you'll
 * converge on ~25% per position after one run.
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

// ── Env ───────────────────────────────────────────────────────────────────────
let SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
let SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    const env: Record<string, string> = {};
    fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
      const eq = line.indexOf("=");
      if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    });
    SUPABASE_URL = SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
    SUPABASE_KEY = SUPABASE_KEY ?? env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  }
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function shuffleFour<T extends string[]>(options: T, correctIndex: number): { options: T; correctIndex: number } {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffledOptions = indices.map(i => options[i]) as T;
  const newCorrectIndex = indices.indexOf(correctIndex);
  return { options: shuffledOptions, correctIndex: newCorrectIndex };
}

(async () => {
  console.log(`Loading mastery_questions…\n`);
  const { data, error } = await sb
    .from("mastery_questions")
    .select("id, options, correct_index")
    .order("created_at");

  if (error) { console.error("Fetch failed:", error.message); process.exit(1); }
  if (!data?.length) { console.log("No rows to fix."); process.exit(0); }

  const beforeDist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const q of data) beforeDist[q.correct_index] = (beforeDist[q.correct_index] ?? 0) + 1;

  console.log(`Rows:          ${data.length}`);
  console.log(`Before dist:   A=${beforeDist[0]}  B=${beforeDist[1]}  C=${beforeDist[2]}  D=${beforeDist[3]}`);

  const updates: { id: string; options: string[]; correct_index: number }[] = [];
  const afterDist: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  for (const q of data) {
    const opts = Array.isArray(q.options) ? q.options.map(o => String(o)) : [];
    if (opts.length !== 4) continue;
    if (q.correct_index < 0 || q.correct_index > 3) continue;

    const { options: newOpts, correctIndex: newIdx } = shuffleFour(opts, q.correct_index);
    afterDist[newIdx] = (afterDist[newIdx] ?? 0) + 1;
    updates.push({ id: q.id, options: newOpts, correct_index: newIdx });
  }

  console.log(`After dist:    A=${afterDist[0]}  B=${afterDist[1]}  C=${afterDist[2]}  D=${afterDist[3]}`);

  if (!APPLY) {
    console.log(`\nDry run only. Re-run with --apply to write ${updates.length} updates.`);
    process.exit(0);
  }

  console.log(`\nApplying ${updates.length} updates…`);
  let ok = 0, fail = 0;
  for (const u of updates) {
    const { error: err } = await sb
      .from("mastery_questions")
      .update({ options: u.options, correct_index: u.correct_index })
      .eq("id", u.id);
    if (err) { fail++; console.error(` ✗ ${u.id}: ${err.message}`); }
    else ok++;
  }
  console.log(`Done. ${ok} updated, ${fail} failed.`);
})();
