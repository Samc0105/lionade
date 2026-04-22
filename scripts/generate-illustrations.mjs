#!/usr/bin/env node
/**
 * Lionade illustration generator — gpt-image-1 via OpenAI API.
 *
 * Usage:
 *   node scripts/generate-illustrations.mjs <batch> [quality]
 *
 *   batch:   test | achievements | subjects | ranks | streaks | all
 *   quality: low | medium | high   (default: medium)
 *
 * Reads OPENAI_API_KEY from .env.local. Writes PNGs to public/illustrations/.
 * Does NOT touch git, does NOT log the API key.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "public", "illustrations");

// ── Load OPENAI_API_KEY from .env.local without printing it ────────────────
const envFile = fs.readFileSync(path.join(PROJECT_ROOT, ".env.local"), "utf8");
const keyMatch = envFile.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m);
if (!keyMatch) {
  console.error("OPENAI_API_KEY not found in .env.local");
  process.exit(1);
}
const API_KEY = keyMatch[1].replace(/^["']|["']$/g, "").trim();

// ── Shared style brief — locks one aesthetic across every image ────────────
const STYLE_BRIEF = [
  "Editorial hand-drawn line illustration.",
  "Single warm gold hairline stroke (color #FFD700) on a deep navy background (#04080F).",
  "Flat 2D, no gradients, no 3D rendering, no shading — only hairline stroke with subtle weight variation.",
  "Generous negative space. Centered composition. Subtle warm film grain texture overall.",
  "No text, no letters, no numbers, no logos, no watermarks.",
  "Feels like a 1970s New Yorker spot illustration reinterpreted for a modern premium app.",
  "Clean, confident, distinctive — never resembles stock icon sets like Feather, Lucide, Heroicons, or Phosphor.",
].join(" ");

// ── Batch definitions ──────────────────────────────────────────────────────
const BATCHES = {
  test: [
    { name: "ach-first-steps",      subject: "a minimalist paper rocket in mid-liftoff, three quick flame lines below" },
    { name: "subj-math",            subject: "an open book with a triangle and a small rising line graph floating above its pages" },
    { name: "rank-perfect",         subject: "a faceted diamond with four long crossed light rays extending beyond its edges" },
    { name: "streak-7-day",         subject: "a small flame held inside a compact laurel wreath" },
  ],
  achievements: [
    { name: "ach-first-steps",      subject: "a minimalist paper rocket in mid-liftoff, three quick flame lines below" },
    { name: "ach-perfectionist",    subject: "a simple crown with five points, a small star at its center" },
    { name: "ach-on-fire",          subject: "a single flame with three clean tongues, one small ember rising" },
    { name: "ach-dedicated",        subject: "a bent barbell with small weight plates, suggested motion lines" },
    { name: "ach-coin-collector",   subject: "a single coin on edge, small sparkle lines radiating outward" },
    { name: "ach-big-saver",        subject: "three stacked coins of varying sizes, confidently drawn" },
    { name: "ach-quiz-master",      subject: "a classic two-handled trophy cup with one star above the rim" },
    { name: "ach-scholar",          subject: "a graduation cap with tassel, a small open book beneath it" },
  ],
  subjects: [
    { name: "subj-math",            subject: "a compass and a ruler crossed at center, forming a single tight X, with a small equation-dot and arc in the negative space above the crossing" },
    { name: "subj-science",         subject: "a simple Erlenmeyer flask with three bubbles rising, a small orbit line behind" },
    { name: "subj-languages",       subject: "a globe with three longitude lines, a speech bracket mark to its side" },
    { name: "subj-humanities",      subject: "a closed book with a feather quill resting on its cover" },
    { name: "subj-tech-coding",     subject: "a monitor frame showing a bracket-slash-bracket and two horizontal code lines" },
    { name: "subj-cloud-it",        subject: "a rounded cloud with three dot-lines of data raining beneath it" },
    { name: "subj-finance",         subject: "a rising line chart inside a rectangle frame, a small coin at the chart's peak" },
    { name: "subj-test-prep",       subject: "a stack of three index cards with a pencil laid diagonally across them" },
  ],
  ranks: [
    { name: "rank-perfect",         subject: "a faceted diamond with four long crossed light rays extending beyond its edges" },
    { name: "rank-elite",           subject: "a shield outline with a single star at its heart, two small laurel sprigs at the base" },
    { name: "rank-solid",           subject: "a mountain silhouette with a small flag planted at its summit" },
    { name: "rank-keep-grinding",   subject: "a simple barbell with a rising arrow behind it, suggesting progress" },
  ],
  streaks: [
    { name: "streak-7-day",         subject: "a small flame held inside a compact laurel wreath" },
    { name: "streak-30-day",        subject: "a larger flame with three surrounding stars at different radii" },
    { name: "streak-100-day",       subject: "a crown resting above a flame, three small orbiting sparks" },
  ],
};

const batchName = process.argv[2] || "test";
const quality = process.argv[3] || "medium";

if (batchName === "all") {
  BATCHES.all = [
    ...BATCHES.achievements,
    ...BATCHES.subjects,
    ...BATCHES.ranks,
    ...BATCHES.streaks,
  ];
}

const items = BATCHES[batchName];
if (!items) {
  console.error(`Unknown batch: ${batchName}. Options: ${Object.keys(BATCHES).join(", ")}, all`);
  process.exit(1);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Generate ──────────────────────────────────────────────────────────────
async function generate(subject, filename) {
  const prompt = `${STYLE_BRIEF}\n\nSUBJECT: ${subject}`;

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality,
      n: 1,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`No b64_json in response: ${JSON.stringify(data).slice(0, 200)}`);

  const buf = Buffer.from(b64, "base64");
  const outPath = path.join(OUTPUT_DIR, `${filename}.png`);
  fs.writeFileSync(outPath, buf);
  const sizeKB = (buf.length / 1024).toFixed(1);
  return { outPath, sizeKB };
}

async function main() {
  console.log(`Generating ${items.length} image(s) (quality=${quality}) → public/illustrations/`);
  console.log("");

  let ok = 0;
  let failed = 0;
  const start = Date.now();

  for (const item of items) {
    const t0 = Date.now();
    try {
      const { sizeKB } = await generate(item.subject, item.name);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ✓ ${item.name}.png  (${sizeKB} KB, ${secs}s)`);
      ok++;
    } catch (e) {
      console.log(`  ✗ ${item.name}  — ${e.message}`);
      failed++;
    }
  }

  const totalSecs = ((Date.now() - start) / 1000).toFixed(1);
  console.log("");
  console.log(`Done: ${ok} ok, ${failed} failed, ${totalSecs}s total`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
