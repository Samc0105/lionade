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
  { question: "What is the largest planet in our solar system?", correct_answer: "Jupiter", category: "Astronomy" },
  { question: "What is the chemical symbol for iron?", correct_answer: "Fe", category: "Science" },
  { question: "How many strings does a standard violin have?", correct_answer: "4", category: "Music" },
  { question: "What is the capital of Japan?", correct_answer: "Tokyo", category: "Geography" },
  { question: "Who wrote the play Hamlet?", correct_answer: "William Shakespeare", category: "Literature" },
  { question: "What is the largest mammal on Earth?", correct_answer: "Blue whale", category: "Biology" },
  { question: "How many sides does a hexagon have?", correct_answer: "6", category: "Mathematics" },
  { question: "What is the currency used in Japan?", correct_answer: "Yen", category: "Geography" },
  { question: "What gas makes up most of Earth's atmosphere?", correct_answer: "Nitrogen", category: "Science" },
  { question: "Who developed the theory of general relativity?", correct_answer: "Albert Einstein", category: "Science" },
  { question: "What is the tallest land animal in the world?", correct_answer: "Giraffe", category: "Biology" },
  { question: "In which country would you find the Eiffel Tower?", correct_answer: "France", category: "Geography" },
  { question: "What is the freezing point of water in degrees Celsius?", correct_answer: "0", category: "Science" },
  { question: "What is the largest desert in the world?", correct_answer: "Antarctic Desert", category: "Geography" },
  { question: "Who is credited with inventing the light bulb's practical form?", correct_answer: "Thomas Edison", category: "History" },
  { question: "How many colors are in a rainbow?", correct_answer: "7", category: "Science" },
  { question: "Which ancient wonder still stands in Giza, Egypt?", correct_answer: "Great Pyramid", category: "History" },
  { question: "What is the chemical symbol for oxygen?", correct_answer: "O", category: "Science" },
  { question: "How many legs does a spider have?", correct_answer: "8", category: "Biology" },
  { question: "What is the national language of Brazil?", correct_answer: "Portuguese", category: "Geography" },
  { question: "Who composed the Ninth Symphony that includes Ode to Joy?", correct_answer: "Ludwig van Beethoven", category: "Music" },
  { question: "What is the largest internal organ in the human body?", correct_answer: "Liver", category: "Biology" },
  { question: "How many minutes are in a full day?", correct_answer: "1440", category: "Mathematics" },
  { question: "What is the primary gas that plants release during photosynthesis?", correct_answer: "Oxygen", category: "Biology" },
  { question: "In what country did the Olympic Games originate?", correct_answer: "Greece", category: "History" },
  { question: "What is the fastest land animal in the world?", correct_answer: "Cheetah", category: "Biology" },
  { question: "What is the smallest prime number?", correct_answer: "2", category: "Mathematics" },
  { question: "Which metal is liquid at room temperature?", correct_answer: "Mercury", category: "Science" },
  { question: "What is the capital of Canada?", correct_answer: "Ottawa", category: "Geography" },
  { question: "What is the chemical symbol for sodium?", correct_answer: "Na", category: "Science" },
  { question: "What is the chemical symbol for potassium?", correct_answer: "K", category: "Science" },
  { question: "What is the most abundant element in the universe?", correct_answer: "Hydrogen", category: "Science" },
  { question: "What is the powerhouse of the cell?", correct_answer: "Mitochondria", category: "Biology" },
  { question: "What is the largest bone in the human body?", correct_answer: "Femur", category: "Biology" },
  { question: "What is the smallest bone in the human body?", correct_answer: "Stapes", category: "Biology" },
  { question: "How many chambers does the human heart have?", correct_answer: "4", category: "Biology" },
  { question: "What is the boiling point of water in degrees Celsius at sea level?", correct_answer: "100", category: "Science" },
  { question: "What force keeps planets in orbit around the Sun?", correct_answer: "Gravity", category: "Science" },
  { question: "What is the speed of light rounded to the nearest thousand kilometers per second?", correct_answer: "300000", category: "Science" },
  { question: "What is the closest planet to the Sun?", correct_answer: "Mercury", category: "Astronomy" },
  { question: "What is the largest moon of Saturn?", correct_answer: "Titan", category: "Astronomy" },
  { question: "What is the red planet also known as?", correct_answer: "Mars", category: "Astronomy" },
  { question: "What is the study of fungi called?", correct_answer: "Mycology", category: "Biology" },
  { question: "What is the largest species of shark?", correct_answer: "Whale shark", category: "Nature" },
  { question: "What is a group of lions called?", correct_answer: "Pride", category: "Nature" },
  { question: "What is a group of crows called?", correct_answer: "Murder", category: "Nature" },
  { question: "What is the only mammal capable of true flight?", correct_answer: "Bat", category: "Nature" },
  { question: "What is the largest living species of lizard?", correct_answer: "Komodo dragon", category: "Nature" },
  { question: "What is the tallest species of tree on Earth?", correct_answer: "Coast redwood", category: "Nature" },
  { question: "What process do caterpillars undergo to become butterflies?", correct_answer: "Metamorphosis", category: "Biology" },
  { question: "What is the hardest substance in the human body?", correct_answer: "Enamel", category: "Biology" },
  { question: "What vitamin does the human body produce when exposed to sunlight?", correct_answer: "Vitamin D", category: "Biology" },
  { question: "What blood cells are responsible for clotting?", correct_answer: "Platelets", category: "Biology" },
  { question: "What gas do humans exhale that plants use for photosynthesis?", correct_answer: "Carbon dioxide", category: "Biology" },
  { question: "What is the chemical formula for table salt?", correct_answer: "NaCl", category: "Science" },
  { question: "What is the pH value of a neutral solution?", correct_answer: "7", category: "Science" },
  { question: "What is the lightest element on the periodic table?", correct_answer: "Hydrogen", category: "Science" },
  { question: "What type of energy is stored in a stretched rubber band?", correct_answer: "Potential energy", category: "Science" },
  { question: "What is the SI unit of electric current?", correct_answer: "Ampere", category: "Science" },
  { question: "What is the SI unit of force?", correct_answer: "Newton", category: "Science" },
  { question: "What is the layer of Earth we live on called?", correct_answer: "Crust", category: "Science" },
  { question: "What is the molten rock beneath Earth's surface called?", correct_answer: "Magma", category: "Science" },
  { question: "What scale is used to measure the magnitude of earthquakes?", correct_answer: "Richter scale", category: "Science" },
  { question: "What is the name for animals that eat only plants?", correct_answer: "Herbivore", category: "Biology" },
  { question: "What is the process by which liquid water turns into vapor called?", correct_answer: "Evaporation", category: "Science" },
  { question: "What is the largest organ of the human body?", correct_answer: "Skin", category: "Biology" },
  { question: "What is the primary metal found in hemoglobin?", correct_answer: "Iron", category: "Biology" },
  { question: "What is the name of the galaxy that contains our solar system?", correct_answer: "Milky Way", category: "Astronomy" },
  { question: "In what year did World War II end?", correct_answer: "1945", category: "History" },
  { question: "Which country gifted the Statue of Liberty to the United States?", correct_answer: "France", category: "History" },
  { question: "Who was the first President of the United States?", correct_answer: "George Washington", category: "History" },
  { question: "In what year did the Berlin Wall fall?", correct_answer: "1989", category: "History" },
  { question: "Which ship carried the Pilgrims to America in 1620?", correct_answer: "Mayflower", category: "History" },
  { question: "Who was the first woman to travel into space?", correct_answer: "Valentina Tereshkova", category: "History" },
  { question: "In what year did the United States declare its independence?", correct_answer: "1776", category: "History" },
  { question: "Which empire built the Colosseum in Rome?", correct_answer: "Roman Empire", category: "History" },
  { question: "Who led the Indian independence movement through nonviolent resistance?", correct_answer: "Mahatma Gandhi", category: "History" },
  { question: "In what year did the French Revolution begin?", correct_answer: "1789", category: "History" },
  { question: "Which explorer led the first expedition to circumnavigate the globe?", correct_answer: "Ferdinand Magellan", category: "History" },
  { question: "Who was the British Prime Minister during most of World War II?", correct_answer: "Winston Churchill", category: "History" },
  { question: "Which country was the first to send a satellite into space?", correct_answer: "Soviet Union", category: "History" },
  { question: "In what year did the American Civil War begin?", correct_answer: "1861", category: "History" },
  { question: "Which queen ruled England during the defeat of the Spanish Armada in 1588?", correct_answer: "Elizabeth I", category: "History" },
  { question: "What is the capital of Australia?", correct_answer: "Canberra", category: "Geography" },
  { question: "Which mountain range separates Europe from Asia?", correct_answer: "Ural Mountains", category: "Geography" },
  { question: "What is the largest country in the world by land area?", correct_answer: "Russia", category: "Geography" },
  { question: "Which sea lies between Europe and Africa?", correct_answer: "Mediterranean Sea", category: "Geography" },
  { question: "What is the capital of Egypt?", correct_answer: "Cairo", category: "Geography" },
  { question: "Which African country has the largest population?", correct_answer: "Nigeria", category: "Geography" },
  { question: "What is the capital of South Korea?", correct_answer: "Seoul", category: "Geography" },
  { question: "Which strait separates Spain from Morocco?", correct_answer: "Strait of Gibraltar", category: "Geography" },
  { question: "What is the largest island in the world?", correct_answer: "Greenland", category: "Geography" },
  { question: "Which US state is the largest by area?", correct_answer: "Alaska", category: "Geography" },
  { question: "What is the capital of Argentina?", correct_answer: "Buenos Aires", category: "Geography" },
  { question: "Which country is home to the ancient city of Machu Picchu?", correct_answer: "Peru", category: "Geography" },
  { question: "What is the largest ocean on Earth?", correct_answer: "Pacific Ocean", category: "Geography" },
  { question: "Which country has the most natural lakes in the world?", correct_answer: "Canada", category: "Geography" },
  { question: "What is the capital of Turkey?", correct_answer: "Ankara", category: "Geography" },
  { question: "What is the tallest mountain above sea level?", correct_answer: "Mount Everest", category: "Records" },
  { question: "What is the deepest point in Earth's oceans?", correct_answer: "Challenger Deep", category: "Records" },
  { question: "What is the tallest building in the world?", correct_answer: "Burj Khalifa", category: "Records" },
  { question: "What is the largest hot desert in the world?", correct_answer: "Sahara", category: "Records" },
  { question: "What is the fastest bird in the world in a dive?", correct_answer: "Peregrine falcon", category: "Records" },
  { question: "What is the largest country in Africa by area?", correct_answer: "Algeria", category: "Records" },
  { question: "What is the highest waterfall in the world?", correct_answer: "Angel Falls", category: "Records" },
  { question: "What is the most populous country in the world?", correct_answer: "India", category: "Records" },
  { question: "What is the largest lake in the world by surface area?", correct_answer: "Caspian Sea", category: "Records" },
  { question: "What is the smallest planet in our solar system?", correct_answer: "Mercury", category: "Records" },
  { question: "What is the main ingredient in traditional guacamole?", correct_answer: "Avocado", category: "Food" },
  { question: "Which fruit is dried to make a raisin?", correct_answer: "Grape", category: "Food" },
  { question: "What spice, by weight, is the most expensive in the world?", correct_answer: "Saffron", category: "Food" },
  { question: "What is the main ingredient in traditional hummus?", correct_answer: "Chickpeas", category: "Food" },
  { question: "Which vegetable is the primary ingredient in sauerkraut?", correct_answer: "Cabbage", category: "Food" },
  { question: "What kind of pastry is used to make a classic profiterole?", correct_answer: "Choux", category: "Food" },
  { question: "What is the primary flavoring in a traditional pesto sauce?", correct_answer: "Basil", category: "Food" },
  { question: "Sushi rice is seasoned with sugar, salt, and what other liquid?", correct_answer: "Vinegar", category: "Food" },
  { question: "What bean is used to make traditional tofu?", correct_answer: "Soybean", category: "Food" },
  { question: "What is the main grain used to brew most beer?", correct_answer: "Barley", category: "Food" },
  { question: "Which nut is used to make traditional marzipan?", correct_answer: "Almond", category: "Food" },
  { question: "What leafy vegetable is the main ingredient in a Caesar salad?", correct_answer: "Romaine", category: "Food" },
  { question: "What is the Italian word for the small dumplings often made from potato?", correct_answer: "Gnocchi", category: "Food" },
  { question: "What fish is traditionally used to make Worcestershire sauce?", correct_answer: "Anchovies", category: "Food" },
  { question: "What is the French word for a small round cake baked in a shell-shaped mold?", correct_answer: "Madeleine", category: "Food" },
  { question: "What language is spoken by the most native speakers worldwide?", correct_answer: "Mandarin", category: "Language" },
  { question: "How many letters are in the modern English alphabet?", correct_answer: "26", category: "Language" },
  { question: "What do you call a word that reads the same forwards and backwards?", correct_answer: "Palindrome", category: "Language" },
  { question: "The word robot comes from a Czech word meaning what kind of labor?", correct_answer: "Forced", category: "Language" },
  { question: "What ancient language are most modern medical terms derived from?", correct_answer: "Latin", category: "Language" },
  { question: "What is the most commonly used letter in written English?", correct_answer: "E", category: "Language" },
  { question: "What do you call a word that has the opposite meaning of another word?", correct_answer: "Antonym", category: "Language" },
  { question: "The abbreviation etc. is short for which Latin phrase?", correct_answer: "Et cetera", category: "Language" },
  { question: "What do you call a name spelled with the first letters of a phrase, like NASA?", correct_answer: "Acronym", category: "Language" },
  { question: "In Morse code, three dots followed by three dashes and three dots spell what distress signal?", correct_answer: "SOS", category: "Language" },
  { question: "The word alphabet comes from the first two letters of which alphabet?", correct_answer: "Greek", category: "Language" },
  { question: "What do you call a group of words that describe an action, such as run or jump?", correct_answer: "Verb", category: "Language" },
  { question: "Which country launched the first artificial satellite, Sputnik 1?", correct_answer: "Soviet Union", category: "Famous Firsts" },
  { question: "Who was the first explorer to reach the South Pole?", correct_answer: "Roald Amundsen", category: "Famous Firsts" },
  { question: "Which brothers are credited with the first powered airplane flight?", correct_answer: "Wright brothers", category: "Famous Firsts" },
  { question: "Who is widely recognized as the first President of the United States?", correct_answer: "George Washington", category: "Famous Firsts" },
  { question: "What was the first feature-length animated film released by Walt Disney?", correct_answer: "Snow White", category: "Famous Firsts" },
  { question: "Who was the first woman to win a Nobel Prize?", correct_answer: "Marie Curie", category: "Famous Firsts" },
  { question: "What was the name of the first successfully cloned mammal, a sheep?", correct_answer: "Dolly", category: "Famous Firsts" },
  { question: "How many teeth does a typical adult human have, including wisdom teeth?", correct_answer: "32", category: "Everyday Knowledge" },
  { question: "What is the standard boiling point of water in degrees Celsius at sea level?", correct_answer: "100", category: "Everyday Knowledge" },
  { question: "How many degrees are there in a right angle?", correct_answer: "90", category: "Everyday Knowledge" },
  { question: "What blood type is known as the universal donor?", correct_answer: "O negative", category: "Everyday Knowledge" },
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
