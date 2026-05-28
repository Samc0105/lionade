// Sabotage Trivia — question source.
//
// Mirrors the Bluff Trivia fetch pattern (lib/party/bluff-questions.ts): primary
// source is Open Trivia DB (opentdb.com, free, no key), with a curated fallback
// bank if the API is unreachable. Unlike Bluff (which only needs the correct
// answer), Sabotage needs the full MCQ — so we keep all four options and shuffle
// them, returning the correct index.

interface SabotageQuestion {
  question: string;
  options: string[];     // 4 options, shuffled
  correctIndex: number;
  category: string;
}

interface OpenTriviaResponse {
  response_code: number;
  results: Array<{
    category: string;
    type: string;
    difficulty: string;
    question: string;
    correct_answer: string;
    incorrect_answers: string[];
  }>;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
let cache: SabotageQuestion[] = [];
let cacheLoadedAt = 0;

function htmlDecode(input: string): string {
  return input
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&hellip;/g, "...")
    .replace(/&eacute;/g, "e")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const FALLBACK_BANK: Array<{ question: string; correct: string; wrong: string[]; category: string }> = [
  { question: "What is the chemical symbol for gold?", correct: "Au", wrong: ["Gd", "Go", "Ag"], category: "Science" },
  { question: "Which planet is known as the Red Planet?", correct: "Mars", wrong: ["Venus", "Jupiter", "Mercury"], category: "Astronomy" },
  { question: "How many continents are there?", correct: "7", wrong: ["5", "6", "8"], category: "Geography" },
  { question: "Who wrote Romeo and Juliet?", correct: "William Shakespeare", wrong: ["Charles Dickens", "Mark Twain", "Jane Austen"], category: "Literature" },
  { question: "What gas do plants absorb during photosynthesis?", correct: "Carbon dioxide", wrong: ["Oxygen", "Nitrogen", "Hydrogen"], category: "Biology" },
  { question: "What is the largest ocean on Earth?", correct: "Pacific", wrong: ["Atlantic", "Indian", "Arctic"], category: "Geography" },
  { question: "In what year did World War II end?", correct: "1945", wrong: ["1939", "1918", "1950"], category: "History" },
  { question: "What is the hardest natural substance?", correct: "Diamond", wrong: ["Gold", "Iron", "Quartz"], category: "Science" },
  { question: "How many sides does a hexagon have?", correct: "6", wrong: ["5", "7", "8"], category: "Math" },
  { question: "Who painted the Mona Lisa?", correct: "Leonardo da Vinci", wrong: ["Michelangelo", "Raphael", "Donatello"], category: "Art" },
  { question: "What is the smallest prime number?", correct: "2", wrong: ["1", "3", "0"], category: "Math" },
  { question: "What is the capital of Japan?", correct: "Tokyo", wrong: ["Kyoto", "Osaka", "Seoul"], category: "Geography" },
];

let fallbackCursor = 0;

function buildFallback(): SabotageQuestion {
  const q = FALLBACK_BANK[fallbackCursor % FALLBACK_BANK.length];
  fallbackCursor++;
  const options = shuffle([q.correct, ...q.wrong]);
  return {
    question: q.question,
    options,
    correctIndex: options.indexOf(q.correct),
    category: q.category,
  };
}

async function refreshCache(): Promise<void> {
  try {
    const url = "https://opentdb.com/api.php?amount=30&type=multiple";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`opentdb ${res.status}`);
    const data = (await res.json()) as OpenTriviaResponse;
    if (data.response_code !== 0 || !Array.isArray(data.results)) {
      throw new Error(`opentdb response_code ${data.response_code}`);
    }
    cache = data.results.map((r) => {
      const correct = htmlDecode(r.correct_answer);
      const options = shuffle([
        correct,
        ...r.incorrect_answers.map(htmlDecode),
      ]);
      return {
        question: htmlDecode(r.question),
        options,
        correctIndex: options.indexOf(correct),
        category: htmlDecode(r.category),
      };
    });
    cacheLoadedAt = Date.now();
  } catch (e) {
    console.warn(
      "[sabotage-questions] fetch failed, using fallback:",
      e instanceof Error ? e.message : e,
    );
  }
}

/** Fetch N sabotage questions (from cache, refreshing if stale; fallback bank on failure). */
export async function getSabotageQuestions(n: number): Promise<SabotageQuestion[]> {
  const stale = Date.now() - cacheLoadedAt > CACHE_TTL_MS;
  if (cache.length < n || stale) {
    await refreshCache();
  }
  const out: SabotageQuestion[] = [];
  for (let i = 0; i < n; i++) {
    if (cache.length > 0) {
      out.push(cache.pop()!);
    } else {
      out.push(buildFallback());
    }
  }
  return out;
}

export type { SabotageQuestion };
