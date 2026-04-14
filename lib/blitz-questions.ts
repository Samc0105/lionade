// Server-side utility that reads pre-built question JSON files from /questions/
// and returns shuffled MCQQuestion[] for Blitz mode.
//
// Runs in API route context only — uses fs to read from the bundled project directory.

import fs from "fs";
import path from "path";
import type { MCQQuestion } from "./ninny";

interface RawQuestion {
  question: string;
  options: string[];
  correct_answer: string;
  explanation?: string;
  subject: string;
  difficulty: string;
  topic: string;
}

// Maps subject keys to the directories/file prefixes where their questions live
const SUBJECT_FILES: Record<string, string[]> = {
  science: [
    "science/biology", "science/chemistry", "science/physics",
    "science/earth-science", "science/astronomy",
  ],
  math: ["math/math"],
  history: ["history/global-history"],
  social: ["social/social-studies"],
};

const DIFFICULTY_ALIASES: Record<string, string[]> = {
  easy: ["beginner", "beginer"], // some files have typo "beginer"
  medium: ["intermediate"],
  hard: ["advanced"],
};

const QUESTIONS_DIR = path.join(process.cwd(), "questions");

function findMatchingFiles(subject?: string, difficulty?: string): string[] {
  const prefixes = subject && SUBJECT_FILES[subject]
    ? SUBJECT_FILES[subject]
    : Object.values(SUBJECT_FILES).flat();

  const difficultyKeys = difficulty && DIFFICULTY_ALIASES[difficulty]
    ? DIFFICULTY_ALIASES[difficulty]
    : null; // null = all difficulties

  const files: string[] = [];

  for (const prefix of prefixes) {
    const dir = path.dirname(path.join(QUESTIONS_DIR, prefix));
    const filePrefix = path.basename(prefix);

    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      if (!entry.startsWith(filePrefix)) continue;

      // If difficulty filter is set, check the filename contains one of the aliases
      if (difficultyKeys) {
        const lower = entry.toLowerCase();
        if (!difficultyKeys.some(d => lower.includes(d))) continue;
      }

      files.push(path.join(dir, entry));
    }
  }

  return files;
}

function transformQuestion(raw: RawQuestion): MCQQuestion | null {
  const idx = raw.options.findIndex(
    o => o.toLowerCase().trim() === raw.correct_answer.toLowerCase().trim()
  );
  if (idx === -1) return null; // skip if answer doesn't match any option

  return {
    question: raw.question,
    options: raw.options,
    correctIndex: idx,
    explanation: raw.explanation,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Load and return shuffled Blitz questions from the JSON question bank.
 * @param subject - "science" | "math" | "history" | "social" | undefined (all)
 * @param difficulty - "easy" | "medium" | "hard" | undefined (all)
 * @param count - number of questions to return (default 50)
 */
export function loadBlitzQuestions(
  subject?: string,
  difficulty?: string,
  count = 50,
): MCQQuestion[] {
  const files = findMatchingFiles(subject, difficulty);

  const allQuestions: MCQQuestion[] = [];

  for (const filePath of files) {
    try {
      const raw: RawQuestion[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      for (const q of raw) {
        const transformed = transformQuestion(q);
        if (transformed) allQuestions.push(transformed);
      }
    } catch {
      // skip malformed files
    }
  }

  // Shuffle and also randomize option order within each question
  const shuffled = shuffle(allQuestions).slice(0, count);

  return shuffled.map(q => {
    // Create shuffled option indices
    const indices = q.options.map((_, i) => i);
    const shuffledIndices = shuffle(indices);
    return {
      question: q.question,
      options: shuffledIndices.map(i => q.options[i]),
      correctIndex: shuffledIndices.indexOf(q.correctIndex),
      explanation: q.explanation,
    };
  });
}

/** Return the list of available subjects that have question files */
export function getAvailableSubjects(): string[] {
  return Object.keys(SUBJECT_FILES).filter(subject => {
    const files = findMatchingFiles(subject);
    return files.length > 0;
  });
}
