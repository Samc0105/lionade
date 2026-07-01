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
  { question: "What is the largest country in the world by land area?", correct_answer: "Russia", incorrect_answers: ["Canada","China","United States"], category: "Geography" },
  { question: "Which gas do humans need to breathe in to survive?", correct_answer: "Oxygen", incorrect_answers: ["Carbon dioxide","Nitrogen","Helium"], category: "Science" },
  { question: "How many sides does a pentagon have?", correct_answer: "5", incorrect_answers: ["4","6","7"], category: "Mathematics" },
  { question: "Who wrote the play A Midsummer Night's Dream?", correct_answer: "William Shakespeare", incorrect_answers: ["Christopher Marlowe","Ben Jonson","Oscar Wilde"], category: "Literature" },
  { question: "What is the chemical symbol for potassium?", correct_answer: "K", incorrect_answers: ["P","Po","Pt"], category: "Science" },
  { question: "Which country is home to the kangaroo?", correct_answer: "Australia", incorrect_answers: ["South Africa","Brazil","India"], category: "Geography" },
  { question: "In which year did the Berlin Wall fall?", correct_answer: "1989", incorrect_answers: ["1987","1991","1985"], category: "History" },
  { question: "What is the hardest known naturally occurring material?", correct_answer: "Diamond", incorrect_answers: ["Quartz","Titanium","Graphite"], category: "Science" },
  { question: "Which artist is famous for the painting The Starry Night?", correct_answer: "Vincent van Gogh", incorrect_answers: ["Claude Monet","Pablo Picasso","Salvador Dali"], category: "Art" },
  { question: "How many degrees are in a right angle?", correct_answer: "90", incorrect_answers: ["45","180","360"], category: "Mathematics" },
  { question: "What is the primary language spoken in Mexico?", correct_answer: "Spanish", incorrect_answers: ["Portuguese","French","Italian"], category: "Geography" },
  { question: "Which planet is closest to the Sun?", correct_answer: "Mercury", incorrect_answers: ["Venus","Earth","Mars"], category: "Astronomy" },
  { question: "Who is credited with formulating the laws of motion and universal gravitation?", correct_answer: "Isaac Newton", incorrect_answers: ["Galileo Galilei","Albert Einstein","Nikola Tesla"], category: "Science" },
  { question: "What is the longest bone in the human body?", correct_answer: "Femur", incorrect_answers: ["Tibia","Humerus","Spine"], category: "Biology" },
  { question: "Which ocean lies between Africa and Australia?", correct_answer: "Indian Ocean", incorrect_answers: ["Atlantic Ocean","Pacific Ocean","Southern Ocean"], category: "Geography" },
  { question: "Who directed the 1975 film Jaws?", correct_answer: "Steven Spielberg", incorrect_answers: ["George Lucas","Martin Scorsese","Francis Ford Coppola"], category: "Pop Culture" },
  { question: "What is the smallest unit of matter that retains an element's properties?", correct_answer: "Atom", incorrect_answers: ["Molecule","Cell","Proton"], category: "Science" },
  { question: "Which country gifted the Statue of Liberty to the United States?", correct_answer: "France", incorrect_answers: ["United Kingdom","Italy","Spain"], category: "History" },
  { question: "How many players are on a standard basketball team on the court per side?", correct_answer: "5", incorrect_answers: ["6","7","4"], category: "Sports" },
  { question: "What is the capital of Egypt?", correct_answer: "Cairo", incorrect_answers: ["Alexandria","Giza","Luxor"], category: "Geography" },
  { question: "Which composer wrote The Four Seasons?", correct_answer: "Antonio Vivaldi", incorrect_answers: ["Johann Sebastian Bach","Wolfgang Amadeus Mozart","Frederic Chopin"], category: "Music" },
  { question: "What is the process by which plants make their own food?", correct_answer: "Photosynthesis", incorrect_answers: ["Respiration","Digestion","Fermentation"], category: "Biology" },
  { question: "In which country would you find the ancient city of Machu Picchu?", correct_answer: "Peru", incorrect_answers: ["Mexico","Chile","Bolivia"], category: "Geography" },
  { question: "Who wrote the novel Pride and Prejudice?", correct_answer: "Jane Austen", incorrect_answers: ["Charlotte Bronte","Emily Bronte","Mary Shelley"], category: "Literature" },
  { question: "What is the chemical symbol for silver?", correct_answer: "Ag", incorrect_answers: ["Si","Sv","Sl"], category: "Science" },
  { question: "Which is the only mammal capable of true sustained flight?", correct_answer: "Bat", incorrect_answers: ["Flying squirrel","Sugar glider","Colugo"], category: "Biology" },
  { question: "What is the capital of Italy?", correct_answer: "Rome", incorrect_answers: ["Milan","Venice","Naples"], category: "Geography" },
  { question: "Which video game franchise features a plumber named Mario?", correct_answer: "Super Mario", incorrect_answers: ["Sonic the Hedgehog","The Legend of Zelda","Donkey Kong Country"], category: "Pop Culture" },
  { question: "How many teeth does a typical adult human have, including wisdom teeth?", correct_answer: "32", incorrect_answers: ["28","30","36"], category: "Biology" },
  { question: "Which element makes up the majority of the Sun's mass?", correct_answer: "Hydrogen", incorrect_answers: ["Helium","Oxygen","Carbon"], category: "Astronomy" },
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
