// Bluff Trivia question source.
//
// Primary: Open Trivia DB (https://opentdb.com) — free, no key, 4000+ questions.
// We fetch a batch of 20 questions and cache them in-memory for 15 minutes so
// we don't hammer their service. Each `nextQuestion()` call pops one from the
// cache; when the cache empties we fetch a fresh batch.
//
// Open Trivia DB HTML-encodes its strings (you'll see &quot;, &#039;, etc.).
// We decode those server-side before returning so the client doesn't have to.
//
// Fallback: if the fetch fails (rate limit, offline, etc.) we hand back a
// hardcoded curated bank so the game stays playable. The fallback bank is
// short on purpose to keep this file small — production usage is expected to
// hit the API.

interface BluffQuestion {
  question: string;
  correct_answer: string;
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
let cache: BluffQuestion[] = [];
let cacheLoadedAt = 0;

// HTML entity decoder for the small set Open Trivia DB actually emits.
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

const FALLBACK_BANK: BluffQuestion[] = [
  { question: "What is the smallest country in the world by area?", correct_answer: "Vatican City", category: "Geography" },
  { question: "Who painted the Mona Lisa?", correct_answer: "Leonardo da Vinci", category: "Art" },
  { question: "What is the chemical symbol for gold?", correct_answer: "Au", category: "Science" },
  { question: "How many bones are in the adult human body?", correct_answer: "206", category: "Biology" },
  { question: "What year did the Titanic sink?", correct_answer: "1912", category: "History" },
  { question: "Which planet has the most moons?", correct_answer: "Saturn", category: "Astronomy" },
  { question: "What is the longest river in the world?", correct_answer: "Nile", category: "Geography" },
  { question: "Who wrote Romeo and Juliet?", correct_answer: "William Shakespeare", category: "Literature" },
  { question: "What gas do plants absorb during photosynthesis?", correct_answer: "Carbon dioxide", category: "Biology" },
  { question: "How many continents are there?", correct_answer: "7", category: "Geography" },
  { question: "What is the hardest natural substance on Earth?", correct_answer: "Diamond", category: "Science" },
  { question: "Who was the first person to walk on the Moon?", correct_answer: "Neil Armstrong", category: "History" },
];

let fallbackCursor = 0;

async function refreshCache(): Promise<void> {
  try {
    const url = "https://opentdb.com/api.php?amount=20&type=multiple";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`opentdb ${res.status}`);
    const data = (await res.json()) as OpenTriviaResponse;
    if (data.response_code !== 0 || !Array.isArray(data.results)) {
      throw new Error(`opentdb response_code ${data.response_code}`);
    }
    cache = data.results.map((r) => ({
      question: htmlDecode(r.question),
      correct_answer: htmlDecode(r.correct_answer),
      category: htmlDecode(r.category),
    }));
    cacheLoadedAt = Date.now();
  } catch (e) {
    console.warn("[bluff-questions] fetch failed, using fallback:", e instanceof Error ? e.message : e);
    // Don't clear cache on failure; let the caller fall back if it's truly empty.
  }
}

/**
 * Return the next bluff trivia question. Refreshes from Open Trivia DB when
 * the in-memory cache is empty or stale, falls back to the hardcoded bank if
 * the API is unreachable.
 */
export async function nextBluffQuestion(): Promise<BluffQuestion> {
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

/** Internal helper for tests / admin tooling. */
export function _peekCacheSize(): number {
  return cache.length;
}
