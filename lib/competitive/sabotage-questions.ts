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
  { question: "What is the capital of Australia?", correct: "Canberra", wrong: ["Sydney","Melbourne","Perth"], category: "Geography" },
  { question: "Which country has the most population in the world?", correct: "India", wrong: ["China","United States","Indonesia"], category: "Geography" },
  { question: "What is the tallest mountain above sea level on Earth?", correct: "Mount Everest", wrong: ["K2","Kilimanjaro","Denali"], category: "Geography" },
  { question: "In which country would you find the ancient city of Petra?", correct: "Jordan", wrong: ["Egypt","Greece","Turkey"], category: "Geography" },
  { question: "Which ancient civilization built the Machu Picchu complex?", correct: "Inca", wrong: ["Aztec","Maya","Olmec"], category: "History" },
  { question: "Who was the first President of the United States?", correct: "George Washington", wrong: ["Thomas Jefferson","John Adams","Benjamin Franklin"], category: "History" },
  { question: "In what year did the Berlin Wall fall?", correct: "1989", wrong: ["1991","1987","1985"], category: "History" },
  { question: "Which empire was ruled by Genghis Khan?", correct: "Mongol Empire", wrong: ["Ottoman Empire","Roman Empire","Persian Empire"], category: "History" },
  { question: "The Rosetta Stone was key to deciphering which writing system?", correct: "Egyptian hieroglyphs", wrong: ["Cuneiform","Sanskrit","Mayan glyphs"], category: "History" },
  { question: "What is the chemical symbol for sodium?", correct: "Na", wrong: ["So","Sd","Sm"], category: "Chemistry" },
  { question: "What is the most abundant gas in Earth's atmosphere?", correct: "Nitrogen", wrong: ["Oxygen","Carbon dioxide","Argon"], category: "Chemistry" },
  { question: "What is the pH of pure water at room temperature?", correct: "7", wrong: ["0","14","5"], category: "Chemistry" },
  { question: "Which element has the atomic number 1?", correct: "Hydrogen", wrong: ["Helium","Oxygen","Carbon"], category: "Chemistry" },
  { question: "What is the speed of light in a vacuum, approximately?", correct: "300,000 kilometers per second", wrong: ["150,000 kilometers per second","1,000 kilometers per second","30,000 kilometers per second"], category: "Science" },
  { question: "What force keeps planets in orbit around the Sun?", correct: "Gravity", wrong: ["Magnetism","Friction","Inertia"], category: "Science" },
  { question: "What unit measures electrical resistance?", correct: "Ohm", wrong: ["Watt","Volt","Ampere"], category: "Science" },
  { question: "How many bones are in the adult human body?", correct: "206", wrong: ["201","212","196"], category: "Anatomy" },
  { question: "Which organ in the human body produces insulin?", correct: "Pancreas", wrong: ["Liver","Kidney","Spleen"], category: "Anatomy" },
  { question: "What is the largest organ of the human body?", correct: "Skin", wrong: ["Liver","Brain","Lungs"], category: "Anatomy" },
  { question: "How many chambers does the human heart have?", correct: "4", wrong: ["2","3","6"], category: "Anatomy" },
  { question: "What is the powerhouse of the cell?", correct: "Mitochondria", wrong: ["Nucleus","Ribosome","Golgi apparatus"], category: "Biology" },
  { question: "What is the largest land animal alive today?", correct: "African elephant", wrong: ["Hippopotamus","White rhinoceros","Giraffe"], category: "Biology" },
  { question: "How many legs does a spider have?", correct: "8", wrong: ["6","10","4"], category: "Biology" },
  { question: "What is the fastest land animal?", correct: "Cheetah", wrong: ["Lion","Pronghorn antelope","Greyhound"], category: "Biology" },
  { question: "Which planet is the largest in our solar system?", correct: "Jupiter", wrong: ["Saturn","Neptune","Earth"], category: "Astronomy" },
  { question: "What is the name of the galaxy that contains our solar system?", correct: "The Milky Way", wrong: ["Andromeda","Whirlpool","Sombrero"], category: "Astronomy" },
  { question: "Which planet has the most prominent ring system?", correct: "Saturn", wrong: ["Jupiter","Uranus","Neptune"], category: "Astronomy" },
  { question: "What is the closest star to Earth?", correct: "The Sun", wrong: ["Proxima Centauri","Sirius","Alpha Centauri A"], category: "Astronomy" },
  { question: "Who wrote the novel Pride and Prejudice?", correct: "Jane Austen", wrong: ["Charlotte Bronte","Emily Bronte","George Eliot"], category: "Literature" },
  { question: "In which novel does the character Captain Ahab hunt a white whale?", correct: "Moby-Dick", wrong: ["Treasure Island","The Old Man and the Sea","Twenty Thousand Leagues Under the Sea"], category: "Literature" },
  { question: "Who wrote the play Hamlet?", correct: "William Shakespeare", wrong: ["Christopher Marlowe","Ben Jonson","John Webster"], category: "Literature" },
  { question: "What is the value of pi rounded to two decimal places?", correct: "3.14", wrong: ["3.16","3.41","3.12"], category: "Math" },
  { question: "What is the square root of 144?", correct: "12", wrong: ["14","11","13"], category: "Math" },
  { question: "How many degrees are in the interior angles of a triangle added together?", correct: "180", wrong: ["360","90","270"], category: "Math" },
  { question: "How many strings does a standard violin have?", correct: "4", wrong: ["6","5","3"], category: "Music" },
  { question: "In which sport would you perform a slam dunk?", correct: "Basketball", wrong: ["Volleyball","Tennis","Hockey"], category: "Sports" },
  { question: "What language has the most native speakers worldwide?", correct: "Mandarin Chinese", wrong: ["English","Spanish","Hindi"], category: "Language" },
  { question: "In Greek mythology, who is the king of the gods?", correct: "Zeus", wrong: ["Poseidon","Hades","Apollo"], category: "Mythology" },
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
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
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
