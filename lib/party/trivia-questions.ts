// Trivia (Kahoot-style MCQ race) question source.
//
// Primary: Open Trivia DB (https://opentdb.com) — free, no key, 4000+ questions.
// Same endpoint and caching strategy as bluff-questions.ts: we fetch a batch of
// 20 questions and cache them in-memory for 15 minutes so we don't hammer their
// service. Each `nextTriviaQuestion()` call pops one from the cache; when the
// cache empties we fetch a fresh batch.
//
// Unlike Bluff (which discards the distractors), Trivia is multiple-choice, so
// we PRESERVE `incorrect_answers` (always exactly 3 for &type=multiple) and
// decode their HTML entities too.
//
// Open Trivia DB HTML-encodes its strings (you'll see &quot;, &#039;, etc.).
// We decode those server-side before returning so the client doesn't have to.
//
// Fallback: if the fetch fails (rate limit, offline, etc.) we hand back a
// hardcoded curated bank so the game stays playable.
//
// NOTE: This file is intentionally independent of bluff-questions.ts. Bluff
// depends on its current behavior and must not change, so the decode helper and
// cache plumbing are replicated here rather than shared.

export type TriviaQuestion = {
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
  category: string;
};

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
let cache: TriviaQuestion[] = [];
let cacheLoadedAt = 0;

// HTML entity decoder for the small set Open Trivia DB actually emits.
// (Replicated from bluff-questions.ts so behavior is identical.)
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
    .replace(/&ntilde;/g, "n")
    .replace(/&Ntilde;/g, "N")
    .replace(/&eacute;/g, "e")
    .replace(/&Eacute;/g, "E")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

const FALLBACK_BANK: TriviaQuestion[] = [
  {
    question: "What is the capital of Australia?",
    correct_answer: "Canberra",
    incorrect_answers: ["Sydney", "Melbourne", "Perth"],
    category: "Geography",
  },
  {
    question: "Which planet is known as the Red Planet?",
    correct_answer: "Mars",
    incorrect_answers: ["Venus", "Jupiter", "Mercury"],
    category: "Astronomy",
  },
  {
    question: "What is the chemical symbol for sodium?",
    correct_answer: "Na",
    incorrect_answers: ["So", "Sd", "Sm"],
    category: "Science",
  },
  {
    question: "Who painted the ceiling of the Sistine Chapel?",
    correct_answer: "Michelangelo",
    incorrect_answers: ["Leonardo da Vinci", "Raphael", "Donatello"],
    category: "Art",
  },
  {
    question: "In what year did World War II end?",
    correct_answer: "1945",
    incorrect_answers: ["1939", "1944", "1946"],
    category: "History",
  },
  {
    question: "Which element has the atomic number 1?",
    correct_answer: "Hydrogen",
    incorrect_answers: ["Helium", "Oxygen", "Carbon"],
    category: "Science",
  },
  {
    question: "Who wrote the novel 1984?",
    correct_answer: "George Orwell",
    incorrect_answers: ["Aldous Huxley", "Ray Bradbury", "H.G. Wells"],
    category: "Literature",
  },
  {
    question: "How many players are on a standard soccer team on the field?",
    correct_answer: "11",
    incorrect_answers: ["9", "10", "12"],
    category: "Sports",
  },
  {
    question: "Which country hosted the 2016 Summer Olympics?",
    correct_answer: "Brazil",
    incorrect_answers: ["China", "United Kingdom", "Japan"],
    category: "Sports",
  },
  {
    question: "What is the largest ocean on Earth?",
    correct_answer: "Pacific Ocean",
    incorrect_answers: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean"],
    category: "Geography",
  },
  {
    question: "Which band released the album Abbey Road?",
    correct_answer: "The Beatles",
    incorrect_answers: ["The Rolling Stones", "Pink Floyd", "Led Zeppelin"],
    category: "Music",
  },
  {
    question: "What is the powerhouse of the cell?",
    correct_answer: "Mitochondria",
    incorrect_answers: ["Nucleus", "Ribosome", "Golgi apparatus"],
    category: "Biology",
  },
  {
    question: "Who was the first President of the United States?",
    correct_answer: "George Washington",
    incorrect_answers: ["Thomas Jefferson", "John Adams", "Benjamin Franklin"],
    category: "History",
  },
  {
    question: "Which movie features the character Jack Dawson?",
    correct_answer: "Titanic",
    incorrect_answers: ["The Notebook", "Pearl Harbor", "Romeo + Juliet"],
    category: "Pop Culture",
  },
  {
    question: "What is the tallest mountain in the world above sea level?",
    correct_answer: "Mount Everest",
    incorrect_answers: ["K2", "Kangchenjunga", "Mount Kilimanjaro"],
    category: "Geography",
  },
];

let fallbackCursor = 0;

async function refreshCache(): Promise<void> {
  try {
    const url = "https://opentdb.com/api.php?amount=20&type=multiple";
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`opentdb ${res.status}`);
    const data = (await res.json()) as OpenTriviaResponse;
    if (data.response_code !== 0 || !Array.isArray(data.results)) {
      throw new Error(`opentdb response_code ${data.response_code}`);
    }
    cache = data.results
      // Guard: &type=multiple should always yield exactly 3 distractors, but be
      // defensive against malformed rows so options building never breaks.
      .filter((r) => Array.isArray(r.incorrect_answers) && r.incorrect_answers.length === 3)
      .map((r) => ({
        question: htmlDecode(r.question),
        correct_answer: htmlDecode(r.correct_answer),
        incorrect_answers: r.incorrect_answers.map((a) => htmlDecode(a)),
        category: htmlDecode(r.category),
      }));
    cacheLoadedAt = Date.now();
  } catch (e) {
    console.warn("[trivia-questions] fetch failed, using fallback:", e instanceof Error ? e.message : e);
    // Don't clear cache on failure; let the caller fall back if it's truly empty.
  }
}

/**
 * Return the next trivia question. Refreshes from Open Trivia DB when the
 * in-memory cache is empty or stale, falls back to the hardcoded bank if the
 * API is unreachable. Always includes exactly 3 `incorrect_answers`.
 */
export async function nextTriviaQuestion(): Promise<TriviaQuestion> {
  const stale = Date.now() - cacheLoadedAt > CACHE_TTL_MS;
  if (cache.length === 0 || stale) {
    await refreshCache();
  }
  if (cache.length > 0) {
    return cache.pop()!;
  }
  // Fallback: rotate through the curated bank.
  const q = FALLBACK_BANK[fallbackCursor % FALLBACK_BANK.length];
  fallbackCursor++;
  return q;
}

/**
 * Combine the correct answer with its 3 distractors into a shuffled 4-element
 * option array, and report where the correct answer landed. Uses a local
 * Fisher-Yates shuffle (server-side, per round — no global state involved).
 */
export function buildShuffledOptions(q: TriviaQuestion): { options: string[]; correct_index: number } {
  const options = [q.correct_answer, ...q.incorrect_answers];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { options, correct_index: options.indexOf(q.correct_answer) };
}

/** Internal helper for tests / admin tooling. */
export function _peekCacheSize(): number {
  return cache.length;
}
