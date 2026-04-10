// Ninny — shared types, OpenAI prompts, helpers

export type NinnyDifficulty = "easy" | "medium" | "hard";
export type NinnySourceType = "pdf" | "text" | "topic";
export type NinnyMode =
  | "flashcards"
  | "match"
  | "mcq"
  | "fill"
  | "tf"
  | "ordering"
  | "blitz";

export interface Flashcard {
  front: string;
  back: string;
}

export interface MatchPair {
  term: string;
  definition: string;
}

export interface MCQQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

export interface FillBlankQuestion {
  sentence: string;
  answer: string;
}

export interface TrueFalseQuestion {
  statement: string;
  answer: boolean;
  explanation?: string;
}

export interface OrderingQuestion {
  prompt: string;
  items: string[];
  correctOrder: number[];
}

export interface NinnyGeneratedContent {
  title: string;
  subject: string;
  difficulty: NinnyDifficulty;
  flashcards: Flashcard[];
  match: MatchPair[];
  multipleChoice: MCQQuestion[];
  fillBlank: FillBlankQuestion[];
  trueFalse: TrueFalseQuestion[];
  ordering: OrderingQuestion[];
  blitz: MCQQuestion[];
}

export interface NinnyMaterial {
  id: string;
  user_id: string;
  title: string;
  source_type: NinnySourceType;
  raw_content: string | null;
  generated_content: NinnyGeneratedContent;
  subject: string | null;
  difficulty: NinnyDifficulty;
  created_at: string;
}

// Subject taxonomy must match Lionade's existing 8 categories
export const NINNY_SUBJECTS = [
  "Math",
  "Science",
  "Languages",
  "Humanities",
  "Tech & Coding",
  "Cloud & IT",
  "Finance & Business",
  "Test Prep",
] as const;

export const NINNY_REWARDS: Record<NinnyMode, { coins: number; xp: number }> = {
  flashcards: { coins: 15, xp: 25 },
  match: { coins: 15, xp: 25 },
  mcq: { coins: 25, xp: 25 },
  fill: { coins: 20, xp: 25 },
  tf: { coins: 15, xp: 25 },
  ordering: { coins: 20, xp: 25 },
  blitz: { coins: 30, xp: 25 },
};

export function buildNinnyPrompt(
  sourceType: NinnySourceType,
  content: string,
  difficulty: NinnyDifficulty,
): string {
  const subjectList = NINNY_SUBJECTS.join(", ");
  const sourceLabel =
    sourceType === "topic"
      ? `the topic: "${content}"`
      : "the following study material";

  return `You are Ninny, an AI study companion. Generate study content for ${sourceLabel}.

Return ONLY a valid JSON object matching this exact schema (no markdown, no commentary):

{
  "title": "string — short topic title (max 60 chars)",
  "subject": "one of: ${subjectList}",
  "difficulty": "${difficulty}",
  "flashcards": [{"front": "string", "back": "string"}],
  "match": [{"term": "string", "definition": "string"}],
  "multipleChoice": [{"question": "string", "options": ["a", "b", "c", "d"], "correctIndex": 0, "explanation": "string"}],
  "fillBlank": [{"sentence": "The ___ is the powerhouse of the cell.", "answer": "mitochondrion"}],
  "trueFalse": [{"statement": "string", "answer": true, "explanation": "string"}],
  "ordering": [{"prompt": "string", "items": ["a", "b", "c"], "correctOrder": [0, 1, 2]}],
  "blitz": [{"question": "string", "options": ["a", "b", "c", "d"], "correctIndex": 0}]
}

Requirements:
- Generate 8-12 items in each array
- Difficulty is ${difficulty} — match question complexity accordingly
- multipleChoice options must have exactly 4 entries; correctIndex is 0-3
- fillBlank sentences must contain "___" exactly where the answer goes
- ordering correctOrder is the sorted index sequence (e.g. if items are already in order, use [0,1,2,...])
- blitz questions should be short and answerable in under 5 seconds
- subject MUST be one of the listed categories — pick the closest match
- Return ONLY the JSON, no markdown fences, no explanation

${sourceType === "topic" ? "" : `Material:\n${content.slice(0, 12000)}`}`;
}

export function validateGeneratedContent(
  raw: unknown,
): NinnyGeneratedContent | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (
    typeof c.title !== "string" ||
    typeof c.subject !== "string" ||
    typeof c.difficulty !== "string" ||
    !Array.isArray(c.flashcards) ||
    !Array.isArray(c.match) ||
    !Array.isArray(c.multipleChoice) ||
    !Array.isArray(c.fillBlank) ||
    !Array.isArray(c.trueFalse) ||
    !Array.isArray(c.ordering) ||
    !Array.isArray(c.blitz)
  ) {
    return null;
  }
  // Coerce subject to known list, fall back to first
  const subject = (NINNY_SUBJECTS as readonly string[]).includes(c.subject)
    ? (c.subject as string)
    : "Humanities";
  const difficulty = (["easy", "medium", "hard"] as const).includes(
    c.difficulty as NinnyDifficulty,
  )
    ? (c.difficulty as NinnyDifficulty)
    : "medium";

  return {
    title: (c.title as string).slice(0, 60),
    subject,
    difficulty,
    flashcards: c.flashcards as Flashcard[],
    match: c.match as MatchPair[],
    multipleChoice: c.multipleChoice as MCQQuestion[],
    fillBlank: c.fillBlank as FillBlankQuestion[],
    trueFalse: c.trueFalse as TrueFalseQuestion[],
    ordering: c.ordering as OrderingQuestion[],
    blitz: c.blitz as MCQQuestion[],
  };
}
