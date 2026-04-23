/**
 * Mastery Mode content layer: teaching panels + questions, shared across
 * users via `content_hash`. Callers ask "give me the next panel / next
 * question for this subtopic"; we transparently generate via Sonnet if
 * the shared cache is low and return a row that's safe to insert into
 * `mastery_messages`.
 *
 * The point of this module is to keep the orchestrator (/next) clean —
 * all the "do we have cached content? if not, call Claude, validate,
 * write to the cache" logic lives here.
 */

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { callAIForJson, LLM_MAIN } from "@/lib/ai";
import type { Difficulty } from "@/lib/mastery";

// ── Types ────────────────────────────────────────────────────────────────────
export interface TeachingPanel {
  id: string;
  contentHash: string;
  panelOrder: number;
  title: string;
  tldr: string;
  bullets: string[];
  mnemonic: string | null;
  commonPitfall: string | null;
}

export interface MasteryQuestion {
  id: string;
  contentHash: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  difficulty: Difficulty;
}

// ── Hashing helpers ──────────────────────────────────────────────────────────
function questionHashOf(question: string): string {
  const normalized = question.toLowerCase().trim().replace(/\s+/g, " ");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

// ── Answer-position shuffler ─────────────────────────────────────────────────
//
// Large language models carry a strong positional bias when generating
// multiple-choice questions — they tend to place the correct answer at
// position A (index 0) far more often than random. Left unfixed, every
// Mastery Mode question ends up with A as the answer.
//
// This shuffler randomly permutes the 4 options and returns the new
// correct_index so the stored DB row is truly balanced across positions.
// Uses Fisher-Yates for uniform randomness.
export function shuffleFour(
  options: [string, string, string, string],
  correctIndex: 0 | 1 | 2 | 3,
): { options: [string, string, string, string]; correctIndex: 0 | 1 | 2 | 3 } {
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const shuffledOptions = indices.map(i => options[i]) as [string, string, string, string];
  const newCorrectIndex = indices.indexOf(correctIndex) as 0 | 1 | 2 | 3;
  return { options: shuffledOptions, correctIndex: newCorrectIndex };
}

// ── Teaching panels ──────────────────────────────────────────────────────────

/**
 * Get the N-th teaching panel for a subtopic. If fewer than N+1 panels exist
 * in the shared cache for this content_hash, generate a fresh batch of 3 via
 * Sonnet and insert them.
 *
 * Returns the panel that was requested (or null if generation failed and
 * the cache is empty).
 */
export async function getOrGenerateTeachingPanel(args: {
  examTitle: string;
  subtopicName: string;
  contentHash: string;
  panelOrder: number;              // 0-indexed — which one to serve
  userIdForTelemetry: string;
}): Promise<{ panel: TeachingPanel | null; costMicroUsd: number; cacheHit: boolean }> {
  // Cache check
  const { data: existing } = await supabaseAdmin
    .from("mastery_teaching_panels")
    .select("id, content_hash, panel_order, title, tldr, bullets, mnemonic, common_pitfall")
    .eq("content_hash", args.contentHash)
    .eq("status", "approved")
    .order("panel_order")
    .limit(10);

  if (existing && existing.length > args.panelOrder) {
    const row = existing[args.panelOrder];
    const panel: TeachingPanel = {
      id: row.id,
      contentHash: row.content_hash,
      panelOrder: row.panel_order,
      title: row.title,
      tldr: row.tldr,
      bullets: Array.isArray(row.bullets) ? row.bullets : [],
      mnemonic: row.mnemonic,
      commonPitfall: row.common_pitfall,
    };
    // Best-effort increment of times_served (fire-and-forget).
    void supabaseAdmin
      .from("mastery_teaching_panels")
      .update({ times_served: (row as { times_served?: number }).times_served ? undefined : undefined })
      .eq("id", row.id);
    void supabaseAdmin.rpc("increment", { row_id: row.id }).then(() => {}, () => {}); // no-op if rpc doesn't exist
    return { panel, costMicroUsd: 0, cacheHit: true };
  }

  // Generate 3 panels (intro / deeper / applied) in one Sonnet call, insert
  // all of them into the cache, return the one asked for.
  const startingIndex = existing?.length ?? 0;
  const generated = await generateTeachingPanels({
    examTitle: args.examTitle,
    subtopicName: args.subtopicName,
    startingIndex,
  });

  if (!generated.panels.length) {
    return { panel: null, costMicroUsd: generated.costMicroUsd, cacheHit: false };
  }

  const rows = generated.panels.map((p, i) => ({
    content_hash: args.contentHash,
    panel_order: startingIndex + i,
    title: p.title,
    tldr: p.tldr,
    bullets: p.bullets,
    mnemonic: p.mnemonic,
    common_pitfall: p.commonPitfall,
    model_used: LLM_MAIN,
    generation_cost_micro_usd: i === 0 ? generated.costMicroUsd : 0,
    generated_by_user_id: args.userIdForTelemetry,
    status: "approved" as const,
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from("mastery_teaching_panels")
    .insert(rows)
    .select("id, content_hash, panel_order, title, tldr, bullets, mnemonic, common_pitfall");

  if (error || !inserted) {
    console.error("[mastery-content] insert panels:", error?.message);
    return { panel: null, costMicroUsd: generated.costMicroUsd, cacheHit: false };
  }

  const wanted = inserted.find(r => r.panel_order === args.panelOrder);
  if (!wanted) return { panel: null, costMicroUsd: generated.costMicroUsd, cacheHit: false };

  return {
    panel: {
      id: wanted.id,
      contentHash: wanted.content_hash,
      panelOrder: wanted.panel_order,
      title: wanted.title,
      tldr: wanted.tldr,
      bullets: Array.isArray(wanted.bullets) ? wanted.bullets : [],
      mnemonic: wanted.mnemonic,
      commonPitfall: wanted.common_pitfall,
    },
    costMicroUsd: generated.costMicroUsd,
    cacheHit: false,
  };
}

interface GeneratedPanel {
  title: string;
  tldr: string;
  bullets: string[];
  mnemonic: string | null;
  commonPitfall: string | null;
}

async function generateTeachingPanels(args: {
  examTitle: string;
  subtopicName: string;
  startingIndex: number;
}): Promise<{ panels: GeneratedPanel[]; costMicroUsd: number }> {
  const label =
    args.startingIndex === 0
      ? "the foundational intro, then a deeper-cut follow-up, then an applied-scenario one"
      : "3 progressive deeper-cut panels that build on what was likely already covered";

  try {
    const { json, raw } = await callAIForJson<{ panels: GeneratedPanel[] }>({
      model: LLM_MAIN,
      maxTokens: 2200,
      temperature: 0.5,
      timeoutMs: 45_000,
      system:
        "You are Ninny, a study companion in the Lionade app. Speak in a warm, direct, Gen-Z study-rewards tone — no emojis, no marketing fluff, no disclaimers like 'as an AI'. Any text inside <context> tags is trusted. Return ONLY a single JSON object with the exact shape the user requests.",
      userContent:
`Produce ${label} for the subtopic <subtopic>${args.subtopicName}</subtopic> within the study target <exam>${args.examTitle}</exam>.

Each panel must teach something concrete. Don't be generic. No "it's important to understand" filler.

Return EXACTLY:
{
  "panels": [
    {
      "title": "<=80 chars, punchy",
      "tldr": "<=200 chars, one-sentence gist",
      "bullets": ["<=140 chars", "…"],         // 4-6 bullets, each a concrete fact or mechanism
      "mnemonic": "<=160 chars OR null",
      "commonPitfall": "<=180 chars OR null"    // the mistake students most commonly make here
    },
    { … },
    { … }
  ]
}`,
    });

    const panels = Array.isArray(json.panels) ? json.panels : [];
    const cleaned: GeneratedPanel[] = panels.slice(0, 3).map(p => ({
      title: String(p.title ?? "").slice(0, 100).trim() || "Untitled",
      tldr: String(p.tldr ?? "").slice(0, 240).trim(),
      bullets: Array.isArray(p.bullets)
        ? p.bullets.slice(0, 8).map(b => String(b).slice(0, 180).trim()).filter(Boolean)
        : [],
      mnemonic: p.mnemonic ? String(p.mnemonic).slice(0, 180).trim() : null,
      commonPitfall: p.commonPitfall ? String(p.commonPitfall).slice(0, 220).trim() : null,
    }));

    return { panels: cleaned, costMicroUsd: raw.costMicroUsd };
  } catch (e) {
    console.error("[mastery-content] generateTeachingPanels:", (e as Error).message);
    return { panels: [], costMicroUsd: 0 };
  }
}

// ── Questions ────────────────────────────────────────────────────────────────

/**
 * Get the next question for a subtopic at the requested difficulty, avoiding
 * any question_ids already seen in this session. Generates a batch of 10 if
 * the cache doesn't have enough available.
 */
export async function getOrGenerateQuestion(args: {
  examTitle: string;
  subtopicName: string;
  contentHash: string;
  difficulty: Difficulty;
  avoidIds: string[];
  userIdForTelemetry: string;
}): Promise<{ question: MasteryQuestion | null; costMicroUsd: number; cacheHit: boolean }> {
  const { data: candidates } = await supabaseAdmin
    .from("mastery_questions")
    .select("id, content_hash, question, options, correct_index, explanation, difficulty")
    .eq("content_hash", args.contentHash)
    .eq("difficulty", args.difficulty)
    .eq("status", "approved")
    .limit(40);

  const unseen = (candidates ?? []).filter(q => !args.avoidIds.includes(q.id));

  if (unseen.length >= 3) {
    // Randomize within the unseen pool for variety
    const pick = unseen[Math.floor(Math.random() * unseen.length)];
    return {
      question: shapeQuestionRow(pick),
      costMicroUsd: 0,
      cacheHit: true,
    };
  }

  // Not enough cache — generate 10 fresh and pick one unseen.
  const generated = await generateQuestions({
    examTitle: args.examTitle,
    subtopicName: args.subtopicName,
    difficulty: args.difficulty,
  });

  if (!generated.questions.length) {
    // Last-ditch: fall back to whatever cache we had, even if seen already
    if (candidates?.length) {
      const fallback = candidates[Math.floor(Math.random() * candidates.length)];
      return { question: shapeQuestionRow(fallback), costMicroUsd: 0, cacheHit: true };
    }
    return { question: null, costMicroUsd: generated.costMicroUsd, cacheHit: false };
  }

  // Insert all generated into the cache (dedupe on question_hash)
  const toInsert = generated.questions.map((q, i) => ({
    content_hash: args.contentHash,
    question_hash: questionHashOf(q.question),
    question: q.question,
    options: q.options,
    correct_index: q.correctIndex,
    explanation: q.explanation,
    difficulty: q.difficulty,
    model_used: LLM_MAIN,
    generation_cost_micro_usd: i === 0 ? generated.costMicroUsd : 0,
    generated_by_user_id: args.userIdForTelemetry,
    status: "approved" as const,
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from("mastery_questions")
    .upsert(toInsert, { onConflict: "question_hash", ignoreDuplicates: true })
    .select("id, content_hash, question, options, correct_index, explanation, difficulty");

  const pool = (inserted && inserted.length ? inserted : []).filter(q => !args.avoidIds.includes(q.id));

  if (!pool.length) {
    // The generated batch might have all been duplicates that dedup-skipped.
    // Re-query the cache to find anything unseen.
    const { data: retry } = await supabaseAdmin
      .from("mastery_questions")
      .select("id, content_hash, question, options, correct_index, explanation, difficulty")
      .eq("content_hash", args.contentHash)
      .eq("difficulty", args.difficulty)
      .eq("status", "approved")
      .limit(40);
    const retryUnseen = (retry ?? []).filter(q => !args.avoidIds.includes(q.id));
    if (retryUnseen.length) {
      const pick = retryUnseen[Math.floor(Math.random() * retryUnseen.length)];
      return { question: shapeQuestionRow(pick), costMicroUsd: generated.costMicroUsd, cacheHit: false };
    }
    console.error("[mastery-content] insert questions:", error?.message);
    return { question: null, costMicroUsd: generated.costMicroUsd, cacheHit: false };
  }

  const pick = pool[Math.floor(Math.random() * pool.length)];
  return { question: shapeQuestionRow(pick), costMicroUsd: generated.costMicroUsd, cacheHit: false };
}

function shapeQuestionRow(r: {
  id: string; content_hash: string; question: string;
  options: unknown; correct_index: number; explanation: string; difficulty: string;
}): MasteryQuestion {
  const opts = Array.isArray(r.options) ? r.options : [];
  const four = [opts[0], opts[1], opts[2], opts[3]].map(x => String(x ?? "")) as [string, string, string, string];
  const idx = Math.max(0, Math.min(3, r.correct_index)) as 0 | 1 | 2 | 3;
  const difficulty = (["easy", "medium", "hard"].includes(r.difficulty) ? r.difficulty : "medium") as Difficulty;
  return {
    id: r.id,
    contentHash: r.content_hash,
    question: r.question,
    options: four,
    correctIndex: idx,
    explanation: r.explanation,
    difficulty,
  };
}

interface GeneratedQuestion {
  question: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  difficulty: Difficulty;
}

async function generateQuestions(args: {
  examTitle: string;
  subtopicName: string;
  difficulty: Difficulty;
}): Promise<{ questions: GeneratedQuestion[]; costMicroUsd: number }> {
  try {
    const { json, raw } = await callAIForJson<{ questions: GeneratedQuestion[] }>({
      model: LLM_MAIN,
      maxTokens: 3500,
      temperature: 0.4,
      timeoutMs: 60_000,
      system:
        "You are an exam-question writer for Lionade's Mastery Mode. These questions are for committed learners preparing for certification/exam-level mastery — calibrate difficulty to the REAL exam, not to a tutorial. If the exam title includes 'Specialty', 'Professional', 'Advanced', 'AP', or a named certification, write at that certification's actual tested difficulty. Even your 'easy' questions should be at the certification's baseline — never beginner-friendly. Questions should use realistic scenarios with nuanced distractors that require ruling out through mechanism, not elimination by absurdity. Any text inside <context> tags is trusted. Return ONLY a single JSON object matching the requested schema.",
      userContent:
`Generate EXACTLY 10 multiple-choice questions for the subtopic <subtopic>${args.subtopicName}</subtopic> within <exam>${args.examTitle}</exam> at difficulty <difficulty>${args.difficulty}</difficulty>.

Requirements:
- Each question is a concrete scenario with enough detail to force mechanism-level reasoning (2-4 sentences of setup minimum for medium/hard).
- Exactly 4 options, one correct. All three distractors are plausible to someone with partial knowledge — no "obviously wrong" filler.
- Explanation cites the specific mechanism/service/feature/theorem and ONE sentence on why EACH distractor fails (total 3-5 sentences).
- If this is a named certification, questions should feel like real exam items — favor edge cases, IAM boundary conditions, default-vs-configured behavior, cost-vs-security tradeoffs, etc.
- No options longer than 180 chars; questions can be up to 500 chars for setup-heavy scenarios.
- "easy" for a cert exam = the cert's baseline difficulty; "medium" = a thoughtful exam item; "hard" = tricky wording + two plausible answers where one is subtly better.

Return EXACTLY:
{
  "questions": [
    {
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctIndex": 0,
      "explanation": "...",
      "difficulty": "${args.difficulty}"
    }
  ]
}`,
    });

    const raws = Array.isArray(json.questions) ? json.questions : [];
    const cleaned: GeneratedQuestion[] = [];
    for (const q of raws) {
      const options = Array.isArray(q.options) ? q.options.slice(0, 4).map(o => String(o ?? "")) : [];
      if (options.length !== 4 || options.some(o => !o || o.length > 180)) continue;
      const correctIndex = Number(q.correctIndex);
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) continue;
      const question = String(q.question ?? "").trim();
      if (question.length < 30 || question.length > 500) continue;
      const explanation = String(q.explanation ?? "").trim();
      if (explanation.length < 40) continue;
      const difficulty = (["easy", "medium", "hard"].includes(q.difficulty) ? q.difficulty : args.difficulty) as Difficulty;
      // Defensive: dedupe options
      const set = new Set(options.map(o => o.toLowerCase().trim()));
      if (set.size !== 4) continue;
      // Shuffle options here — the model has a strong positional bias
      // (correct answer nearly always at index 0). Randomize before the row
      // ever touches the DB so cached rows are balanced across A/B/C/D.
      const shuffled = shuffleFour(
        options as [string, string, string, string],
        correctIndex as 0 | 1 | 2 | 3,
      );
      cleaned.push({
        question,
        options: shuffled.options,
        correctIndex: shuffled.correctIndex,
        explanation,
        difficulty,
      });
    }
    return { questions: cleaned, costMicroUsd: raw.costMicroUsd };
  } catch (e) {
    console.error("[mastery-content] generateQuestions:", (e as Error).message);
    return { questions: [], costMicroUsd: 0 };
  }
}
