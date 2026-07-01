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
  { question: "What is the chemical symbol for gold?", correct_answer: "Au", incorrect_answers: ["Go","Gd","Ag"], category: "Chemistry" },
  { question: "Which planet in our solar system has the most moons?", correct_answer: "Saturn", incorrect_answers: ["Jupiter","Neptune","Uranus"], category: "Space" },
  { question: "What is the most abundant gas in Earth's atmosphere?", correct_answer: "Nitrogen", incorrect_answers: ["Oxygen","Carbon dioxide","Argon"], category: "Science" },
  { question: "How many chambers does a human heart have?", correct_answer: "4", incorrect_answers: ["2","3","5"], category: "Biology" },
  { question: "What is the speed of light in a vacuum, approximately?", correct_answer: "300,000 kilometers per second", incorrect_answers: ["150,000 kilometers per second","30,000 kilometers per second","3,000 kilometers per second"], category: "Physics" },
  { question: "Which part of a plant is primarily responsible for absorbing water and nutrients from the soil?", correct_answer: "Roots", incorrect_answers: ["Leaves","Flowers","Stem"], category: "Biology" },
  { question: "What is the chemical formula for water?", correct_answer: "H2O", incorrect_answers: ["CO2","O2","H2O2"], category: "Chemistry" },
  { question: "Which scientist proposed the theory of general relativity?", correct_answer: "Albert Einstein", incorrect_answers: ["Isaac Newton","Niels Bohr","Max Planck"], category: "Physics" },
  { question: "What is the largest planet in our solar system?", correct_answer: "Jupiter", incorrect_answers: ["Saturn","Neptune","Earth"], category: "Space" },
  { question: "Which blood cells are primarily responsible for fighting infection?", correct_answer: "White blood cells", incorrect_answers: ["Red blood cells","Platelets","Plasma cells"], category: "Biology" },
  { question: "What is the pH value of a neutral solution at 25 degrees Celsius?", correct_answer: "7", incorrect_answers: ["0","10","14"], category: "Chemistry" },
  { question: "What force pulls objects toward the center of the Earth?", correct_answer: "Gravity", incorrect_answers: ["Magnetism","Friction","Inertia"], category: "Physics" },
  { question: "Which gas do plants absorb from the atmosphere during photosynthesis?", correct_answer: "Carbon dioxide", incorrect_answers: ["Oxygen","Nitrogen","Hydrogen"], category: "Biology" },
  { question: "What is the study of fungi called?", correct_answer: "Mycology", incorrect_answers: ["Botany","Zoology","Entomology"], category: "Biology" },
  { question: "What is the closest star to Earth?", correct_answer: "The Sun", incorrect_answers: ["Proxima Centauri","Sirius","Alpha Centauri A"], category: "Space" },
  { question: "How many bones are in the adult human body?", correct_answer: "206", incorrect_answers: ["201","212","196"], category: "Biology" },
  { question: "Which element has the chemical symbol Fe?", correct_answer: "Iron", incorrect_answers: ["Fluorine","Francium","Fermium"], category: "Chemistry" },
  { question: "What is the name of the galaxy that contains our solar system?", correct_answer: "The Milky Way", incorrect_answers: ["Andromeda","Triangulum","Whirlpool"], category: "Space" },
  { question: "What type of animal is a Komodo dragon?", correct_answer: "Lizard", incorrect_answers: ["Snake","Crocodile","Amphibian"], category: "Nature" },
  { question: "What is the SI unit of electric current?", correct_answer: "Ampere", incorrect_answers: ["Volt","Ohm","Watt"], category: "Physics" },
  { question: "Which organ in the human body produces insulin?", correct_answer: "Pancreas", incorrect_answers: ["Liver","Kidney","Spleen"], category: "Biology" },
  { question: "What is the most common element in the universe by mass?", correct_answer: "Hydrogen", incorrect_answers: ["Oxygen","Carbon","Iron"], category: "Chemistry" },
  { question: "What phenomenon causes the change of seasons on Earth?", correct_answer: "The tilt of Earth's axis", incorrect_answers: ["Earth's distance from the Sun","The phases of the Moon","Solar flares"], category: "Space" },
  { question: "Which of these animals is a marsupial?", correct_answer: "Koala", incorrect_answers: ["Sloth","Lemur","Meerkat"], category: "Nature" },
  { question: "What is the chemical symbol for oxygen?", correct_answer: "O", incorrect_answers: ["Ox","Og","On"], category: "Chemistry" },
  { question: "What is the powerhouse enzyme process that breaks down glucose to release energy in cells?", correct_answer: "Cellular respiration", incorrect_answers: ["Photosynthesis","Transpiration","Osmosis"], category: "Biology" },
  { question: "Which layer of the Earth is liquid?", correct_answer: "The outer core", incorrect_answers: ["The crust","The inner core","The mantle"], category: "Science" },
  { question: "What subatomic particle carries a negative electric charge?", correct_answer: "Electron", incorrect_answers: ["Proton","Neutron","Photon"], category: "Physics" },
  { question: "What is the largest organ of the human body?", correct_answer: "Skin", incorrect_answers: ["Liver","Lungs","Brain"], category: "Biology" },
  { question: "Which planet is known for its prominent ring system?", correct_answer: "Saturn", incorrect_answers: ["Mars","Venus","Mercury"], category: "Space" },
  { question: "What gas is produced when an acid reacts with a metal such as zinc?", correct_answer: "Hydrogen", incorrect_answers: ["Oxygen","Carbon dioxide","Chlorine"], category: "Chemistry" },
  { question: "What is the process by which liquid water turns into water vapor?", correct_answer: "Evaporation", incorrect_answers: ["Condensation","Sublimation","Precipitation"], category: "Science" },
  { question: "Which vitamin is primarily produced by the human body when the skin is exposed to sunlight?", correct_answer: "Vitamin D", incorrect_answers: ["Vitamin C","Vitamin A","Vitamin B12"], category: "Biology" },
  { question: "What is the hottest planet in our solar system?", correct_answer: "Venus", incorrect_answers: ["Mercury","Mars","Jupiter"], category: "Space" },
  { question: "What is the term for animals that eat only plants?", correct_answer: "Herbivores", incorrect_answers: ["Carnivores","Omnivores","Insectivores"], category: "Nature" },
  { question: "What is the atomic number of carbon?", correct_answer: "6", incorrect_answers: ["12","8","4"], category: "Chemistry" },
  { question: "Newton's third law states that for every action there is an equal and opposite what?", correct_answer: "Reaction", incorrect_answers: ["Acceleration","Velocity","Momentum"], category: "Physics" },
  { question: "Which molecule carries genetic information in most living organisms?", correct_answer: "DNA", incorrect_answers: ["ATP","RNA polymerase","Glucose"], category: "Biology" },
  { question: "What is a group of stars forming a recognizable pattern in the night sky called?", correct_answer: "Constellation", incorrect_answers: ["Nebula","Galaxy","Solar system"], category: "Space" },
  { question: "What is the primary metal found in hemoglobin that helps transport oxygen in the blood?", correct_answer: "Iron", incorrect_answers: ["Copper","Calcium","Zinc"], category: "Biology" },
  { question: "What is the capital of Canada?", correct_answer: "Ottawa", incorrect_answers: ["Toronto","Vancouver","Montreal"], category: "Geography" },
  { question: "What is the capital of Japan?", correct_answer: "Tokyo", incorrect_answers: ["Osaka","Kyoto","Yokohama"], category: "Geography" },
  { question: "What is the capital of Brazil?", correct_answer: "Brasilia", incorrect_answers: ["Rio de Janeiro","Sao Paulo","Salvador"], category: "Geography" },
  { question: "What is the capital of Spain?", correct_answer: "Madrid", incorrect_answers: ["Barcelona","Seville","Valencia"], category: "Geography" },
  { question: "What is the capital of Turkey?", correct_answer: "Ankara", incorrect_answers: ["Istanbul","Izmir","Bursa"], category: "Geography" },
  { question: "What is the capital of South Korea?", correct_answer: "Seoul", incorrect_answers: ["Busan","Incheon","Daegu"], category: "Geography" },
  { question: "What is the capital of Argentina?", correct_answer: "Buenos Aires", incorrect_answers: ["Cordoba","Rosario","Mendoza"], category: "Geography" },
  { question: "What is the capital of Greece?", correct_answer: "Athens", incorrect_answers: ["Thessaloniki","Sparta","Patras"], category: "Geography" },
  { question: "What is the capital of Norway?", correct_answer: "Oslo", incorrect_answers: ["Bergen","Stavanger","Trondheim"], category: "Geography" },
  { question: "What is the capital of Portugal?", correct_answer: "Lisbon", incorrect_answers: ["Porto","Braga","Coimbra"], category: "Geography" },
  { question: "What is the capital of New Zealand?", correct_answer: "Wellington", incorrect_answers: ["Auckland","Christchurch","Hamilton"], category: "Geography" },
  { question: "What is the capital of Switzerland?", correct_answer: "Bern", incorrect_answers: ["Zurich","Geneva","Basel"], category: "Geography" },
  { question: "Which African country has the largest population?", correct_answer: "Nigeria", incorrect_answers: ["Ethiopia","Egypt","South Africa"], category: "Geography" },
  { question: "On which continent is the Sahara Desert located?", correct_answer: "Africa", incorrect_answers: ["Asia","Australia","South America"], category: "Geography" },
  { question: "Which country is both in Europe and Asia and spans the Bosphorus strait?", correct_answer: "Turkey", incorrect_answers: ["Greece","Russia","Iran"], category: "Geography" },
  { question: "Which strait separates the United Kingdom from France?", correct_answer: "Strait of Dover", incorrect_answers: ["Strait of Gibraltar","Bering Strait","Strait of Hormuz"], category: "Geography" },
  { question: "Which is the smallest country in the world by area?", correct_answer: "Vatican City", incorrect_answers: ["Monaco","San Marino","Liechtenstein"], category: "Geography" },
  { question: "Which country is home to the fjords along its western coast and shares a long border with Sweden?", correct_answer: "Norway", incorrect_answers: ["Finland","Denmark","Iceland"], category: "Geography" },
  { question: "Which mountain range separates Europe from Asia?", correct_answer: "Ural Mountains", incorrect_answers: ["Alps","Caucasus Mountains","Carpathian Mountains"], category: "Geography" },
  { question: "In which year did the American Declaration of Independence get adopted?", correct_answer: "1776", incorrect_answers: ["1774","1781","1789"], category: "History" },
  { question: "Which empire was ruled by Julius Caesar's successor Augustus?", correct_answer: "Roman Empire", incorrect_answers: ["Greek Empire","Persian Empire","Ottoman Empire"], category: "History" },
  { question: "In which year did the French Revolution begin with the storming of the Bastille?", correct_answer: "1789", incorrect_answers: ["1776","1799","1804"], category: "History" },
  { question: "Who was the British Prime Minister during most of World War II?", correct_answer: "Winston Churchill", incorrect_answers: ["Neville Chamberlain","Clement Attlee","Anthony Eden"], category: "History" },
  { question: "Which ancient civilization built the pyramids at Giza?", correct_answer: "Ancient Egyptians", incorrect_answers: ["Ancient Romans","Ancient Greeks","Mayans"], category: "History" },
  { question: "In which year did the RMS Titanic sink on its maiden voyage?", correct_answer: "1912", incorrect_answers: ["1905","1918","1923"], category: "History" },
  { question: "Which war was fought between the North and South regions of the United States from 1861 to 1865?", correct_answer: "American Civil War", incorrect_answers: ["Revolutionary War","War of 1812","Spanish-American War"], category: "History" },
  { question: "Who led the nonviolent independence movement in India against British rule?", correct_answer: "Mahatma Gandhi", incorrect_answers: ["Jawaharlal Nehru","Subhas Chandra Bose","Bhagat Singh"], category: "History" },
  { question: "The Great Wall was built primarily to defend which country?", correct_answer: "China", incorrect_answers: ["Japan","Mongolia","India"], category: "History" },
  { question: "Which explorer led the first expedition to circumnavigate the globe, though he died before completing it?", correct_answer: "Ferdinand Magellan", incorrect_answers: ["Christopher Columbus","Vasco da Gama","James Cook"], category: "History" },
  { question: "In which year did the Soviet Union officially dissolve?", correct_answer: "1991", incorrect_answers: ["1989","1985","1993"], category: "History" },
  { question: "Who was the Queen of England for 63 years during much of the 19th century?", correct_answer: "Queen Victoria", incorrect_answers: ["Queen Elizabeth I","Queen Anne","Queen Mary I"], category: "History" },
  { question: "Which document, signed in 1215, limited the power of the English monarchy?", correct_answer: "Magna Carta", incorrect_answers: ["Bill of Rights","Declaration of Independence","Petition of Right"], category: "History" },
  { question: "In which year did the United States enter World War I?", correct_answer: "1917", incorrect_answers: ["1914","1915","1919"], category: "History" },
  { question: "How many stars are on the current flag of the United States?", correct_answer: "50", incorrect_answers: ["48","52","13"], category: "Politics" },
  { question: "Which city serves as the headquarters of the United Nations?", correct_answer: "New York City", incorrect_answers: ["Geneva","Brussels","Vienna"], category: "Politics" },
  { question: "In which city is the European Union's main headquarters located?", correct_answer: "Brussels", incorrect_answers: ["Paris","Berlin","Strasbourg"], category: "Politics" },
  { question: "What is the maximum number of years a US President can serve in a single elected term?", correct_answer: "4", incorrect_answers: ["5","6","8"], category: "Politics" },
  { question: "Which body of the US Congress has exactly 100 members?", correct_answer: "The Senate", incorrect_answers: ["The House of Representatives","The Supreme Court","The Cabinet"], category: "Politics" },
  { question: "Which international military alliance was formed in 1949 with founding members including the United States and United Kingdom?", correct_answer: "NATO", incorrect_answers: ["The Warsaw Pact","The United Nations","The European Union"], category: "Politics" },
  { question: "Which sculptor created the marble statue of David displayed in Florence?", correct_answer: "Michelangelo", incorrect_answers: ["Bernini","Donatello","Rodin"], category: "Art" },
  { question: "The painting Girl with a Pearl Earring was created by which Dutch artist?", correct_answer: "Johannes Vermeer", incorrect_answers: ["Rembrandt","Frans Hals","Jan Steen"], category: "Art" },
  { question: "Which art movement is Salvador Dali most closely associated with?", correct_answer: "Surrealism", incorrect_answers: ["Cubism","Impressionism","Baroque"], category: "Art" },
  { question: "In which museum is the Mona Lisa displayed?", correct_answer: "The Louvre", incorrect_answers: ["The Uffizi","The Prado","The Rijksmuseum"], category: "Art" },
  { question: "Which artist co-founded the Cubist movement alongside Pablo Picasso?", correct_answer: "Georges Braque", incorrect_answers: ["Henri Matisse","Paul Cezanne","Marc Chagall"], category: "Art" },
  { question: "Which actor plays Iron Man in the Marvel Cinematic Universe?", correct_answer: "Robert Downey Jr.", incorrect_answers: ["Chris Evans","Mark Ruffalo","Chris Hemsworth"], category: "Pop Culture" },
  { question: "In the Harry Potter series, what position does Harry play in Quidditch?", correct_answer: "Seeker", incorrect_answers: ["Keeper","Chaser","Beater"], category: "Pop Culture" },
  { question: "Which streaming series features the fictional town of Hawkins, Indiana?", correct_answer: "Stranger Things", incorrect_answers: ["The Umbrella Academy","Dark","Wayward Pines"], category: "Pop Culture" },
  { question: "Who is the lead singer of the rock band Queen?", correct_answer: "Freddie Mercury", incorrect_answers: ["Brian May","Roger Taylor","John Deacon"], category: "Pop Culture" },
  { question: "In the film The Wizard of Oz, what color are Dorothy's slippers?", correct_answer: "Ruby red", incorrect_answers: ["Emerald green","Silver","Gold"], category: "Pop Culture" },
  { question: "Which animated film features a clownfish named Marlin searching for his son?", correct_answer: "Finding Nemo", incorrect_answers: ["Shark Tale","The Little Mermaid","Moana"], category: "Pop Culture" },
  { question: "What is the name of the coffee shop where the friends hang out in the sitcom Friends?", correct_answer: "Central Perk", incorrect_answers: ["The Grind","Cafe Nervosa","Luke's Diner"], category: "Pop Culture" },
  { question: "Which pop star is known by the nickname the Material Girl?", correct_answer: "Madonna", incorrect_answers: ["Cher","Cyndi Lauper","Whitney Houston"], category: "Pop Culture" },
  { question: "In which sport would you perform a slam dunk?", correct_answer: "Basketball", incorrect_answers: ["Volleyball","Tennis","Handball"], category: "Sports" },
  { question: "How many rings are on the Olympic flag?", correct_answer: "5", incorrect_answers: ["4","6","7"], category: "Sports" },
  { question: "In tennis, what term describes a score of zero?", correct_answer: "Love", incorrect_answers: ["Nil","Duck","Blank"], category: "Sports" },
  { question: "Which country has won the most FIFA World Cup titles in men's soccer?", correct_answer: "Brazil", incorrect_answers: ["Germany","Italy","Argentina"], category: "Sports" },
  { question: "In golf, what is the term for one stroke under par on a hole?", correct_answer: "Birdie", incorrect_answers: ["Eagle","Bogey","Par"], category: "Sports" },
  { question: "How many points is a touchdown worth in American football, before the extra point?", correct_answer: "6", incorrect_answers: ["3","7","5"], category: "Sports" },
  { question: "Which Grand Slam tennis tournament is played on grass courts?", correct_answer: "Wimbledon", incorrect_answers: ["The French Open","The US Open","The Australian Open"], category: "Sports" },
  { question: "In which sport is the Stanley Cup awarded?", correct_answer: "Ice hockey", incorrect_answers: ["Basketball","Baseball","American football"], category: "Sports" },
  { question: "Which spice, derived from a crocus flower, is famously the most expensive by weight?", correct_answer: "Saffron", incorrect_answers: ["Cardamom","Vanilla","Cinnamon"], category: "Food" },
  { question: "What is the main ingredient in traditional guacamole?", correct_answer: "Avocado", incorrect_answers: ["Tomato","Cucumber","Zucchini"], category: "Food" },
  { question: "Which country is credited as the origin of the pizza margherita?", correct_answer: "Italy", incorrect_answers: ["Greece","France","Spain"], category: "Food" },
  { question: "Sushi is a dish that originated in which country?", correct_answer: "Japan", incorrect_answers: ["China","Thailand","Korea"], category: "Food" },
  { question: "What type of pastry is used to make traditional profiteroles?", correct_answer: "Choux pastry", incorrect_answers: ["Puff pastry","Shortcrust pastry","Filo pastry"], category: "Food" },
  { question: "Which fruit is traditionally used to make the spread known as marmalade?", correct_answer: "Orange", incorrect_answers: ["Strawberry","Grape","Apple"], category: "Food" },
  { question: "What is the primary grain used to brew most traditional beer?", correct_answer: "Barley", incorrect_answers: ["Corn","Rice","Oats"], category: "Food" },
  { question: "Which cheese is a required ingredient in a classic Greek salad?", correct_answer: "Feta", incorrect_answers: ["Mozzarella","Cheddar","Parmesan"], category: "Food" },
  { question: "The cocktail known as a mojito traditionally contains which spirit?", correct_answer: "Rum", incorrect_answers: ["Vodka","Gin","Tequila"], category: "Food" },
  { question: "What is the currency used in Japan?", correct_answer: "Yen", incorrect_answers: ["Won","Yuan","Ringgit"], category: "General Knowledge" },
  { question: "How many colors appear in a standard rainbow?", correct_answer: "7", incorrect_answers: ["5","6","8"], category: "General Knowledge" },
  { question: "Which is the largest planet in our solar system?", correct_answer: "Jupiter", incorrect_answers: ["Saturn","Neptune","Uranus"], category: "General Knowledge" },
  { question: "What is the standard number of squares on a chessboard?", correct_answer: "64", incorrect_answers: ["36","81","100"], category: "General Knowledge" },
  { question: "Which blood type is known as the universal donor for red blood cells?", correct_answer: "O negative", incorrect_answers: ["AB positive","A positive","B negative"], category: "General Knowledge" },
  { question: "How many strings does a standard violin have?", correct_answer: "4", incorrect_answers: ["5","6","3"], category: "General Knowledge" },
  { question: "What is the freezing point of water in degrees Fahrenheit?", correct_answer: "32", incorrect_answers: ["0","100","212"], category: "General Knowledge" },
  { question: "Which is the only US state that borders just one other state?", correct_answer: "Maine", incorrect_answers: ["Florida","Rhode Island","Alaska"], category: "General Knowledge" },
  { question: "In the standard Latin alphabet, how many letters are there?", correct_answer: "26", incorrect_answers: ["24","28","25"], category: "General Knowledge" },
  { question: "Which musical instrument has 88 keys in its standard form?", correct_answer: "Piano", incorrect_answers: ["Organ","Harpsichord","Accordion"], category: "General Knowledge" },
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
