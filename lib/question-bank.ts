// Question Bank — Self-growing question database
//
// Silently captures every Ninny-generated MCQ question, tracks performance
// as users answer them, and auto-promotes quality questions into the
// permanent pool for Blitz, quizzes, and arena.
//
// All operations use supabaseAdmin (service role) — invisible to clients.

import { supabaseAdmin } from "./supabase-server";
import type { MCQQuestion } from "./ninny";
import crypto from "crypto";

// Subjects that auto-promote when quality thresholds are met.
// Questions with subjects NOT in this list stay "pending" until
// the subject is added (e.g., when we launch cooking, coding, etc.)
const APPROVED_SUBJECTS = new Set([
  "science", "math", "history", "social",
  "biology", "chemistry", "physics", "astronomy", "earth-science",
  "algebra", "geometry", "calculus", "statistics", "trigonometry",
  "global-history", "social-studies",
  "english", "cs", "coding", "economics",
]);

// Normalize subject string for matching
function normalizeSubject(raw: string): string {
  return raw.toLowerCase().trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Generate a hash for dedup
function questionHash(question: string): string {
  const normalized = question.toLowerCase().trim().replace(/\s+/g, " ");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

// Map difficulty names to our standard
function normalizeDifficulty(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("easy") || lower.includes("beginner")) return "easy";
  if (lower.includes("hard") || lower.includes("advanced")) return "hard";
  return "medium";
}

// ── Save questions from a Ninny generation ──────────────────

export interface SaveQuestionsInput {
  questions: MCQQuestion[];
  subject: string;
  topic?: string;
  difficulty: string;
  materialId?: string;
  userId?: string;
}

/**
 * Silently save generated questions to the question bank.
 * Skips duplicates via question_hash. Non-blocking — errors are swallowed.
 */
export async function saveGeneratedQuestions(input: SaveQuestionsInput): Promise<void> {
  try {
    const normalizedSubject = normalizeSubject(input.subject);
    const normalizedDifficulty = normalizeDifficulty(input.difficulty);

    const rows = input.questions.map(q => ({
      question: q.question,
      options: q.options,
      correct_index: q.correctIndex,
      explanation: q.explanation ?? null,
      subject: normalizedSubject,
      topic: input.topic ? normalizeSubject(input.topic) : null,
      difficulty: normalizedDifficulty,
      original_difficulty: normalizedDifficulty,
      source_material_id: input.materialId ?? null,
      generated_by: input.userId ?? null,
      question_hash: questionHash(q.question),
      status: "pending",
    }));

    // Batch insert, skip duplicates by hash
    for (const row of rows) {
      await supabaseAdmin
        .from("question_bank")
        .upsert(row, { onConflict: "question_hash", ignoreDuplicates: true });
    }
  } catch (e) {
    // Never block the main flow — this is background work
    console.warn("[question-bank] saveGeneratedQuestions error:", e);
  }
}

// ── Track question performance ──────────────────────────────

/**
 * Record that a question was shown and whether the user got it right.
 * Called from ninny/complete. Non-blocking.
 */
export async function recordQuestionPerformance(
  questionText: string,
  wasCorrect: boolean,
): Promise<void> {
  try {
    const hash = questionHash(questionText);

    // Find the question
    const { data } = await supabaseAdmin
      .from("question_bank")
      .select("id, times_shown, times_correct")
      .eq("question_hash", hash)
      .maybeSingle();

    if (!data) return; // Question not in bank (e.g., from static JSON)

    const newShown = (data.times_shown ?? 0) + 1;
    const newCorrect = (data.times_correct ?? 0) + (wasCorrect ? 1 : 0);
    const successRate = newShown > 0 ? newCorrect / newShown : null;

    await supabaseAdmin
      .from("question_bank")
      .update({
        times_shown: newShown,
        times_correct: newCorrect,
        success_rate: successRate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
  } catch (e) {
    console.warn("[question-bank] recordPerformance error:", e);
  }
}

// ── Auto-curation pipeline ──────────────────────────────────

interface CurationResult {
  promoted: number;
  rejected: number;
  difficultyAdjusted: number;
}

/**
 * Run the auto-curation pipeline:
 * 1. Promote pending questions with 10+ attempts and 30-80% success rate
 * 2. Reject questions with <10% success rate (likely wrong answer)
 * 3. Adjust difficulty based on real performance
 */
export async function runCurationPipeline(): Promise<CurationResult> {
  let promoted = 0;
  let rejected = 0;
  let difficultyAdjusted = 0;

  try {
    // 1. Auto-promote: pending + approved subject + 10+ shown + 30-80% success
    const { data: promotable } = await supabaseAdmin
      .from("question_bank")
      .select("id, subject, success_rate, times_shown")
      .eq("status", "pending")
      .gte("times_shown", 10)
      .gte("success_rate", 0.3)
      .lte("success_rate", 0.8);

    for (const q of promotable ?? []) {
      if (APPROVED_SUBJECTS.has(q.subject)) {
        await supabaseAdmin
          .from("question_bank")
          .update({ status: "approved", updated_at: new Date().toISOString() })
          .eq("id", q.id);
        promoted++;
      }
    }

    // 2. Auto-reject: 10+ shown + <10% success (probably wrong answer)
    const { data: rejectible } = await supabaseAdmin
      .from("question_bank")
      .select("id")
      .eq("status", "pending")
      .gte("times_shown", 10)
      .lt("success_rate", 0.1);

    for (const q of rejectible ?? []) {
      await supabaseAdmin
        .from("question_bank")
        .update({
          status: "rejected",
          rejection_reason: "Very low success rate — likely incorrect answer",
          updated_at: new Date().toISOString(),
        })
        .eq("id", q.id);
      rejected++;
    }

    // 3. Difficulty adjustment for approved questions with 20+ attempts
    const { data: adjustable } = await supabaseAdmin
      .from("question_bank")
      .select("id, difficulty, success_rate")
      .in("status", ["approved", "pending"])
      .gte("times_shown", 20);

    for (const q of adjustable ?? []) {
      if (!q.success_rate) continue;
      let newDifficulty = q.difficulty;

      // Too easy: >80% success → bump up
      if (q.success_rate > 0.8) {
        if (q.difficulty === "easy") newDifficulty = "medium";
        else if (q.difficulty === "medium") newDifficulty = "hard";
      }
      // Too hard: <30% success → bump down
      else if (q.success_rate < 0.3) {
        if (q.difficulty === "hard") newDifficulty = "medium";
        else if (q.difficulty === "medium") newDifficulty = "easy";
      }

      if (newDifficulty !== q.difficulty) {
        await supabaseAdmin
          .from("question_bank")
          .update({ difficulty: newDifficulty, updated_at: new Date().toISOString() })
          .eq("id", q.id);
        difficultyAdjusted++;
      }
    }
  } catch (e) {
    console.warn("[question-bank] curation pipeline error:", e);
  }

  return { promoted, rejected, difficultyAdjusted };
}

// ── Fetch approved questions for Blitz/quizzes ──────────────

/**
 * Load approved questions from the bank, optionally filtered by subject/difficulty.
 * Returns MCQQuestion[] ready for use in BlitzMode or quizzes.
 */
export async function getApprovedQuestions(
  limit = 50,
  subject?: string,
  difficulty?: string,
): Promise<MCQQuestion[]> {
  try {
    let query = supabaseAdmin
      .from("question_bank")
      .select("question, options, correct_index, explanation")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (subject) query = query.eq("subject", normalizeSubject(subject));
    if (difficulty) query = query.eq("difficulty", normalizeDifficulty(difficulty));

    const { data } = await query;

    return (data ?? []).map((q: any) => ({
      question: q.question,
      options: typeof q.options === "string" ? JSON.parse(q.options) : q.options,
      correctIndex: q.correct_index,
      explanation: q.explanation,
    }));
  } catch (e) {
    console.warn("[question-bank] getApprovedQuestions error:", e);
    return [];
  }
}

// ── Stats for admin dashboard ───────────────────────────────

export async function getQuestionBankStats(): Promise<{
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  bySubject: Record<string, number>;
}> {
  try {
    const { count: total } = await supabaseAdmin
      .from("question_bank").select("id", { count: "exact", head: true });
    const { count: pending } = await supabaseAdmin
      .from("question_bank").select("id", { count: "exact", head: true }).eq("status", "pending");
    const { count: approved } = await supabaseAdmin
      .from("question_bank").select("id", { count: "exact", head: true }).eq("status", "approved");
    const { count: rejected } = await supabaseAdmin
      .from("question_bank").select("id", { count: "exact", head: true }).eq("status", "rejected");

    return {
      total: total ?? 0,
      pending: pending ?? 0,
      approved: approved ?? 0,
      rejected: rejected ?? 0,
      bySubject: {}, // TODO: aggregate by subject
    };
  } catch {
    return { total: 0, pending: 0, approved: 0, rejected: 0, bySubject: {} };
  }
}
