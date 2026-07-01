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
  { question: "What is the chemical symbol for iron?", correct: "Fe", wrong: ["Ir","In","Fr"], category: "Chemistry" },
  { question: "What is the chemical symbol for potassium?", correct: "K", wrong: ["P","Po","Pt"], category: "Chemistry" },
  { question: "How many protons does a carbon atom have?", correct: "6", wrong: ["12","8","14"], category: "Chemistry" },
  { question: "What is the most abundant element in the universe by mass?", correct: "Hydrogen", wrong: ["Helium","Oxygen","Carbon"], category: "Chemistry" },
  { question: "What type of bond involves the sharing of electron pairs between atoms?", correct: "Covalent bond", wrong: ["Ionic bond","Metallic bond","Hydrogen bond"], category: "Chemistry" },
  { question: "What is the chemical formula for table salt?", correct: "NaCl", wrong: ["KCl","NaOH","CaCl"], category: "Chemistry" },
  { question: "Which noble gas is used to fill balloons to make them float?", correct: "Helium", wrong: ["Neon","Argon","Hydrogen"], category: "Chemistry" },
  { question: "What is the lightest metal on the periodic table?", correct: "Lithium", wrong: ["Aluminium","Sodium","Beryllium"], category: "Chemistry" },
  { question: "What is the process of a solid turning directly into a gas called?", correct: "Sublimation", wrong: ["Evaporation","Condensation","Melting"], category: "Chemistry" },
  { question: "Which acid is found in the human stomach and aids digestion?", correct: "Hydrochloric acid", wrong: ["Sulfuric acid","Nitric acid","Citric acid"], category: "Chemistry" },
  { question: "What is Newton's first law of motion commonly known as?", correct: "The law of inertia", wrong: ["The law of gravity","The law of acceleration","The law of momentum"], category: "Physics" },
  { question: "What is the SI unit of force?", correct: "Newton", wrong: ["Joule","Watt","Pascal"], category: "Physics" },
  { question: "What is the SI unit of energy?", correct: "Joule", wrong: ["Newton","Watt","Volt"], category: "Physics" },
  { question: "What is the SI unit of electric current?", correct: "Ampere", wrong: ["Volt","Ohm","Watt"], category: "Physics" },
  { question: "What is the SI unit of frequency?", correct: "Hertz", wrong: ["Decibel","Newton","Joule"], category: "Physics" },
  { question: "Which type of electromagnetic wave has the shortest wavelength?", correct: "Gamma rays", wrong: ["X-rays","Ultraviolet","Radio waves"], category: "Physics" },
  { question: "What is the approximate acceleration due to gravity at Earth's surface?", correct: "9.8 meters per second squared", wrong: ["1.6 meters per second squared","19.6 meters per second squared","3.7 meters per second squared"], category: "Physics" },
  { question: "What state of matter has a definite volume but no definite shape?", correct: "Liquid", wrong: ["Solid","Gas","Plasma"], category: "Physics" },
  { question: "Which color of visible light has the longest wavelength?", correct: "Red", wrong: ["Violet","Green","Blue"], category: "Physics" },
  { question: "What term describes the bending of light as it passes from one medium to another?", correct: "Refraction", wrong: ["Reflection","Diffraction","Absorption"], category: "Physics" },
  { question: "Which blood cells are primarily responsible for fighting infection?", correct: "White blood cells", wrong: ["Red blood cells","Platelets","Plasma cells"], category: "Human Body" },
  { question: "What is the largest bone in the human body?", correct: "Femur", wrong: ["Tibia","Humerus","Pelvis"], category: "Human Body" },
  { question: "How many pairs of ribs does a typical human have?", correct: "12", wrong: ["10","14","11"], category: "Human Body" },
  { question: "Which part of the human brain controls balance and coordination?", correct: "Cerebellum", wrong: ["Cerebrum","Hippocampus","Medulla oblongata"], category: "Human Body" },
  { question: "What is the smallest bone in the human body?", correct: "Stapes", wrong: ["Malleus","Incus","Hyoid"], category: "Human Body" },
  { question: "Which vitamin is produced by the human skin when exposed to sunlight?", correct: "Vitamin D", wrong: ["Vitamin C","Vitamin A","Vitamin K"], category: "Human Body" },
  { question: "What is the main muscle responsible for breathing?", correct: "Diaphragm", wrong: ["Biceps","Intercostals","Trapezius"], category: "Human Body" },
  { question: "Which type of blood vessel carries blood away from the heart?", correct: "Arteries", wrong: ["Veins","Capillaries","Venules"], category: "Human Body" },
  { question: "What is the liquid part of blood called?", correct: "Plasma", wrong: ["Serum","Lymph","Platelets"], category: "Human Body" },
  { question: "How many teeth does a typical adult human have?", correct: "32", wrong: ["28","30","24"], category: "Human Body" },
  { question: "What is the process by which green plants make their own food called?", correct: "Photosynthesis", wrong: ["Respiration","Transpiration","Fermentation"], category: "Biology" },
  { question: "Which molecule carries genetic information in most living organisms?", correct: "DNA", wrong: ["RNA","ATP","Protein"], category: "Biology" },
  { question: "What is the basic structural and functional unit of all living things?", correct: "The cell", wrong: ["The atom","The tissue","The organ"], category: "Biology" },
  { question: "Which kingdom do mushrooms belong to?", correct: "Fungi", wrong: ["Plantae","Animalia","Protista"], category: "Biology" },
  { question: "What is the largest animal ever known to have lived on Earth?", correct: "Blue whale", wrong: ["African elephant","Sperm whale","Argentinosaurus"], category: "Biology" },
  { question: "What is the process by which caterpillars transform into butterflies called?", correct: "Metamorphosis", wrong: ["Mitosis","Photosynthesis","Regeneration"], category: "Biology" },
  { question: "Which planet in our solar system is the hottest?", correct: "Venus", wrong: ["Mercury","Mars","Jupiter"], category: "Astronomy" },
  { question: "What is the name of the force that a black hole exerts to trap even light?", correct: "Gravity", wrong: ["Magnetism","Dark energy","Radiation"], category: "Astronomy" },
  { question: "Which planet in our solar system spins on its side, with an axial tilt near 90 degrees?", correct: "Uranus", wrong: ["Neptune","Saturn","Venus"], category: "Astronomy" },
  { question: "What do we call a celestial body made of ice and dust that develops a glowing tail near the Sun?", correct: "Comet", wrong: ["Asteroid","Meteor","Nebula"], category: "Astronomy" },
  { question: "What is the capital of Canada?", correct: "Ottawa", wrong: ["Toronto","Vancouver","Montreal"], category: "Geography" },
  { question: "What is the capital of Brazil?", correct: "Brasilia", wrong: ["Rio de Janeiro","Sao Paulo","Salvador"], category: "Geography" },
  { question: "What is the capital of Egypt?", correct: "Cairo", wrong: ["Alexandria","Giza","Luxor"], category: "Geography" },
  { question: "What is the capital of Turkey?", correct: "Ankara", wrong: ["Istanbul","Izmir","Bursa"], category: "Geography" },
  { question: "What is the capital of New Zealand?", correct: "Wellington", wrong: ["Auckland","Christchurch","Hamilton"], category: "Geography" },
  { question: "What is the capital of South Africa's legislative branch?", correct: "Cape Town", wrong: ["Johannesburg","Durban","Pretoria"], category: "Geography" },
  { question: "What is the capital of Spain?", correct: "Madrid", wrong: ["Barcelona","Seville","Valencia"], category: "Geography" },
  { question: "What is the capital of Argentina?", correct: "Buenos Aires", wrong: ["Cordoba","Rosario","Mendoza"], category: "Geography" },
  { question: "What is the capital of Russia?", correct: "Moscow", wrong: ["Saint Petersburg","Kazan","Novosibirsk"], category: "Geography" },
  { question: "What is the capital of Norway?", correct: "Oslo", wrong: ["Bergen","Stavanger","Trondheim"], category: "Geography" },
  { question: "Which country's flag features a red maple leaf?", correct: "Canada", wrong: ["Lebanon","Japan","Switzerland"], category: "Geography" },
  { question: "Which country's flag is a plain green field with no other emblem or symbol?", correct: "Libya (1977 to 2011)", wrong: ["Saudi Arabia","Pakistan","Nigeria"], category: "Geography" },
  { question: "Which country's flag features a white cross on a red background in a square shape?", correct: "Switzerland", wrong: ["Denmark","England","Greece"], category: "Geography" },
  { question: "The flag of Japan features a single red circle on a white field. What does the circle represent?", correct: "The sun", wrong: ["The moon","A cherry blossom","A rising tide"], category: "Geography" },
  { question: "Which country's flag features a cedar tree in its center?", correct: "Lebanon", wrong: ["Cyprus","Israel","Jordan"], category: "Geography" },
  { question: "Which country's national flag is the only one that is not rectangular or square?", correct: "Nepal", wrong: ["Bhutan","Switzerland","Vatican City"], category: "Geography" },
  { question: "In which city is the Eiffel Tower located?", correct: "Paris", wrong: ["Lyon","Brussels","Geneva"], category: "Geography" },
  { question: "In which country is the Taj Mahal located?", correct: "India", wrong: ["Pakistan","Bangladesh","Iran"], category: "Geography" },
  { question: "In which country would you find the Colosseum?", correct: "Italy", wrong: ["Greece","Spain","Croatia"], category: "Geography" },
  { question: "On which continent is the Great Pyramid of Giza located?", correct: "Africa", wrong: ["Asia","Europe","South America"], category: "Geography" },
  { question: "In which country is the Christ the Redeemer statue located?", correct: "Brazil", wrong: ["Argentina","Portugal","Mexico"], category: "Geography" },
  { question: "The Great Wall is a famous landmark in which country?", correct: "China", wrong: ["Mongolia","Japan","India"], category: "Geography" },
  { question: "In which US city is the Statue of Liberty located?", correct: "New York City", wrong: ["Washington DC","Boston","Philadelphia"], category: "Geography" },
  { question: "The Sydney Opera House is located in which country?", correct: "Australia", wrong: ["New Zealand","United Kingdom","South Africa"], category: "Geography" },
  { question: "In which country is the ancient temple complex of Angkor Wat located?", correct: "Cambodia", wrong: ["Thailand","Vietnam","Laos"], category: "Geography" },
  { question: "Which river runs through the Egyptian capital of Cairo?", correct: "The Nile", wrong: ["The Tigris","The Euphrates","The Congo"], category: "Geography" },
  { question: "Which is the longest river in South America?", correct: "The Amazon", wrong: ["The Parana","The Orinoco","The Sao Francisco"], category: "Geography" },
  { question: "Which desert is the largest hot desert in the world?", correct: "The Sahara", wrong: ["The Gobi","The Kalahari","The Arabian"], category: "Geography" },
  { question: "Which country was formerly known as Persia?", correct: "Iran", wrong: ["Iraq","Turkey","Afghanistan"], category: "History" },
  { question: "In which year did Christopher Columbus first reach the Americas?", correct: "1492", wrong: ["1500","1480","1512"], category: "History" },
  { question: "Who led the Indian independence movement through nonviolent civil disobedience?", correct: "Mahatma Gandhi", wrong: ["Jawaharlal Nehru","Subhas Chandra Bose","Bhagat Singh"], category: "History" },
  { question: "The French Revolution began in which year?", correct: "1789", wrong: ["1799","1776","1804"], category: "History" },
  { question: "Which ancient wonder stood in the harbor of the city of Rhodes?", correct: "The Colossus of Rhodes", wrong: ["The Lighthouse of Alexandria","The Hanging Gardens","The Temple of Artemis"], category: "History" },
  { question: "Who was the first emperor of a unified Rome?", correct: "Augustus", wrong: ["Julius Caesar","Nero","Constantine"], category: "History" },
  { question: "The Magna Carta was signed in which country?", correct: "England", wrong: ["France","Scotland","Ireland"], category: "History" },
  { question: "Which explorer led the first expedition to circumnavigate the globe?", correct: "Ferdinand Magellan", wrong: ["Vasco da Gama","Christopher Columbus","Amerigo Vespucci"], category: "History" },
  { question: "The ancient city of Troy was located in what is now which modern country?", correct: "Turkey", wrong: ["Greece","Italy","Syria"], category: "History" },
  { question: "Which US President issued the Emancipation Proclamation?", correct: "Abraham Lincoln", wrong: ["Andrew Jackson","Ulysses S. Grant","Thomas Jefferson"], category: "History" },
  { question: "The Renaissance is widely regarded as having begun in which country?", correct: "Italy", wrong: ["France","England","Spain"], category: "History" },
  { question: "Which pharaoh's intact tomb was discovered by Howard Carter in 1922?", correct: "Tutankhamun", wrong: ["Ramesses II","Khufu","Akhenaten"], category: "History" },
  { question: "Who wrote the novel The Great Gatsby?", correct: "F. Scott Fitzgerald", wrong: ["Ernest Hemingway","John Steinbeck","William Faulkner"], category: "Literature" },
  { question: "In which novel does the character Winston Smith work at the Ministry of Truth?", correct: "Nineteen Eighty-Four", wrong: ["Brave New World","Fahrenheit 451","Animal Farm"], category: "Literature" },
  { question: "Who created the fictional detective Sherlock Holmes?", correct: "Arthur Conan Doyle", wrong: ["Agatha Christie","Edgar Allan Poe","Wilkie Collins"], category: "Literature" },
  { question: "Which Russian author wrote the novel War and Peace?", correct: "Leo Tolstoy", wrong: ["Fyodor Dostoevsky","Anton Chekhov","Ivan Turgenev"], category: "Literature" },
  { question: "Who wrote the epic poem The Divine Comedy?", correct: "Dante Alighieri", wrong: ["Homer","Virgil","Petrarch"], category: "Literature" },
  { question: "In the Harry Potter series, who is the headmaster of Hogwarts for most of the books?", correct: "Albus Dumbledore", wrong: ["Severus Snape","Minerva McGonagall","Horace Slughorn"], category: "Literature" },
  { question: "Who wrote the dystopian novel Brave New World?", correct: "Aldous Huxley", wrong: ["George Orwell","Ray Bradbury","H. G. Wells"], category: "Literature" },
  { question: "Which artist painted The Starry Night?", correct: "Vincent van Gogh", wrong: ["Claude Monet","Paul Cezanne","Edvard Munch"], category: "Art" },
  { question: "Who painted the ceiling of the Sistine Chapel?", correct: "Michelangelo", wrong: ["Raphael","Leonardo da Vinci","Titian"], category: "Art" },
  { question: "Which artist is famous for the melting clocks in the painting The Persistence of Memory?", correct: "Salvador Dali", wrong: ["Pablo Picasso","Rene Magritte","Joan Miro"], category: "Art" },
  { question: "The painting The Scream is the work of which artist?", correct: "Edvard Munch", wrong: ["Gustav Klimt","Egon Schiele","Wassily Kandinsky"], category: "Art" },
  { question: "Which Dutch artist painted Girl with a Pearl Earring?", correct: "Johannes Vermeer", wrong: ["Rembrandt","Frans Hals","Jan Steen"], category: "Art" },
  { question: "Which composer wrote the Ninth Symphony that includes the Ode to Joy?", correct: "Ludwig van Beethoven", wrong: ["Wolfgang Amadeus Mozart","Johann Sebastian Bach","Franz Schubert"], category: "Music" },
  { question: "How many keys does a standard full-size piano have?", correct: "88", wrong: ["76","96","108"], category: "Music" },
  { question: "Which instrument is Yo-Yo Ma most famous for playing?", correct: "Cello", wrong: ["Violin","Piano","Flute"], category: "Music" },
  { question: "Which band released the album Abbey Road in 1969?", correct: "The Beatles", wrong: ["The Rolling Stones","The Who","Led Zeppelin"], category: "Music" },
  { question: "How many lines are on a standard musical staff?", correct: "5", wrong: ["4","6","7"], category: "Music" },
  { question: "Which composer wrote the opera The Magic Flute?", correct: "Wolfgang Amadeus Mozart", wrong: ["Giuseppe Verdi","Richard Wagner","Giacomo Puccini"], category: "Music" },
  { question: "Who directed the 1975 film Jaws?", correct: "Steven Spielberg", wrong: ["George Lucas","Martin Scorsese","Francis Ford Coppola"], category: "Film" },
  { question: "In the film The Wizard of Oz, what color are the ruby slippers Dorothy wears?", correct: "Red", wrong: ["Silver","Gold","Blue"], category: "Film" },
  { question: "Which 1994 film features the line Life is like a box of chocolates?", correct: "Forrest Gump", wrong: ["Pulp Fiction","The Shawshank Redemption","Braveheart"], category: "Film" },
  { question: "Who directed the science fiction film Inception, released in 2010?", correct: "Christopher Nolan", wrong: ["Ridley Scott","James Cameron","Denis Villeneuve"], category: "Film" },
  { question: "Which studio produced the animated film Toy Story, released in 1995?", correct: "Pixar", wrong: ["DreamWorks","Studio Ghibli","Blue Sky Studios"], category: "Film" },
  { question: "How many players are on the field for one team in a standard soccer match?", correct: "11", wrong: ["9","10","12"], category: "Sports" },
  { question: "In which sport is the Wimbledon championship played?", correct: "Tennis", wrong: ["Golf","Cricket","Badminton"], category: "Sports" },
  { question: "How often are the modern Summer Olympic Games held?", correct: "Every four years", wrong: ["Every two years","Every three years","Every five years"], category: "Sports" },
  { question: "In golf, what term describes a score of one stroke under par on a hole?", correct: "Birdie", wrong: ["Eagle","Bogey","Albatross"], category: "Sports" },
  { question: "How many points is a touchdown worth in American football, before any extra point?", correct: "6", wrong: ["3","7","5"], category: "Sports" },
  { question: "In which country did the sport of sumo wrestling originate?", correct: "Japan", wrong: ["China","Mongolia","South Korea"], category: "Sports" },
  { question: "In Norse mythology, what is the name of the hammer wielded by Thor?", correct: "Mjolnir", wrong: ["Gungnir","Gram","Draupnir"], category: "Mythology" },
  { question: "In Greek mythology, who is the god of the sea?", correct: "Poseidon", wrong: ["Zeus","Hades","Hermes"], category: "Mythology" },
  { question: "In Egyptian mythology, which god is depicted with the head of a jackal and associated with the dead?", correct: "Anubis", wrong: ["Horus","Ra","Osiris"], category: "Mythology" },
  { question: "In Roman mythology, who is the goddess of love, equivalent to the Greek Aphrodite?", correct: "Venus", wrong: ["Juno","Minerva","Diana"], category: "Mythology" },
  { question: "In Greek mythology, which hero was known for his heel being his only vulnerable point?", correct: "Achilles", wrong: ["Hercules","Perseus","Theseus"], category: "Mythology" },
  { question: "In Norse mythology, what is the name of the bridge that connects Midgard to Asgard?", correct: "Bifrost", wrong: ["Yggdrasil","Valhalla","Ginnungagap"], category: "Mythology" },
  { question: "How many letters are in the modern English alphabet?", correct: "26", wrong: ["24","28","25"], category: "Language" },
  { question: "Which language uses a writing system that includes hiragana, katakana, and kanji?", correct: "Japanese", wrong: ["Korean","Chinese","Vietnamese"], category: "Language" },
  { question: "What is the term for a word that reads the same forwards and backwards, such as level?", correct: "Palindrome", wrong: ["Homonym","Anagram","Onomatopoeia"], category: "Language" },
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
