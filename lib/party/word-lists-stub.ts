// Inline stub of subject-locked drawing prompts for Sketchy Subjects.
//
// The parallel word-curator agent owns the full `lib/party/word-lists.ts`
// with ~50 prompts per subject. This stub exists so the codebase compiles
// and lobbies are playable when the curator output is missing or partial.
//
// Delete this file once `scripts/seed-party-words.ts` has populated
// `party_word_lists` and the API endpoints have switched to DB reads only.
//
// No em-dashes in factoid copy per house style.

export interface WordEntry {
  word: string;
  difficulty: "easy" | "medium" | "hard";
  factoid: string;
}

export const SUBJECTS = [
  "biology",
  "chemistry",
  "physics",
  "math",
  "history",
  "geography",
  "astronomy",
  "pop-culture",
] as const;

export type Subject = (typeof SUBJECTS)[number];

export const SUBJECT_LABELS: Record<Subject, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
  math: "Math",
  history: "History",
  geography: "Geography",
  astronomy: "Astronomy",
  "pop-culture": "Pop Culture",
};

export const WORD_LISTS_STUB: Record<Subject, WordEntry[]> = {
  biology: [
    { word: "cell", difficulty: "easy", factoid: "The basic unit of life. Every living thing is built from at least one." },
    { word: "neuron", difficulty: "medium", factoid: "A nerve cell that sends electrical signals. Your brain has about 86 billion of them." },
    { word: "mitochondria", difficulty: "medium", factoid: "The powerhouse of the cell. They make ATP, the energy currency of life." },
    { word: "DNA", difficulty: "easy", factoid: "The molecule that stores genetic instructions. Stretched out, one cell's worth would reach 2 meters." },
    { word: "heart", difficulty: "easy", factoid: "A muscular pump. It beats about 100,000 times a day without you thinking about it." },
    { word: "lung", difficulty: "easy", factoid: "Where blood swaps carbon dioxide for oxygen. Adults have roughly 300 million tiny alveoli." },
    { word: "virus", difficulty: "medium", factoid: "Not technically alive on its own. It needs a host cell to reproduce." },
    { word: "skeleton", difficulty: "easy", factoid: "Adult humans have 206 bones. Babies are born with around 270." },
    { word: "photosynthesis", difficulty: "hard", factoid: "How plants turn sunlight into sugar. It also releases the oxygen you breathe." },
    { word: "chromosome", difficulty: "hard", factoid: "Coiled-up DNA. Humans carry 23 pairs in almost every cell." },
  ],
  chemistry: [
    { word: "atom", difficulty: "easy", factoid: "The smallest unit of an element. A single grain of sand contains quintillions." },
    { word: "molecule", difficulty: "easy", factoid: "Two or more atoms bonded together. Water is two hydrogens stuck to one oxygen." },
    { word: "beaker", difficulty: "easy", factoid: "A flat-bottomed lab cup. The lip is for pouring without dripping." },
    { word: "test tube", difficulty: "easy", factoid: "A narrow glass tube used for small reactions. The rounded bottom resists thermal shock." },
    { word: "periodic table", difficulty: "medium", factoid: "Elements arranged by proton count. Mendeleev predicted gaps for elements not yet discovered." },
    { word: "salt crystal", difficulty: "medium", factoid: "Sodium and chloride locked in a cube lattice. That's why table salt grains look square under a magnifier." },
    { word: "bunsen burner", difficulty: "medium", factoid: "Named after Robert Bunsen. The blue flame is hotter and cleaner than the yellow one." },
    { word: "diamond", difficulty: "medium", factoid: "Pure carbon arranged in a tight 3D lattice. It's the hardest natural material on Earth." },
    { word: "balloon", difficulty: "easy", factoid: "Helium balloons float because helium atoms are lighter than the surrounding air molecules." },
    { word: "explosion", difficulty: "medium", factoid: "A very fast exothermic reaction. The boom comes from gas expanding faster than sound travels." },
  ],
  physics: [
    { word: "magnet", difficulty: "easy", factoid: "Magnets have north and south poles. Opposites attract, likes repel." },
    { word: "rainbow", difficulty: "easy", factoid: "Sunlight bending through water droplets at about 42 degrees. Always opposite the sun in the sky." },
    { word: "spring", difficulty: "easy", factoid: "Hooke's law says the force is proportional to how far you stretch it." },
    { word: "gear", difficulty: "medium", factoid: "Two meshing gears trade speed for torque. Big gear drives small means more speed, less force." },
    { word: "pendulum", difficulty: "medium", factoid: "Galileo timed a swinging chandelier with his pulse and discovered the period stays constant." },
    { word: "lever", difficulty: "easy", factoid: "Archimedes said give him a long enough one and he'd move the world." },
    { word: "prism", difficulty: "medium", factoid: "Splits white light into colors because each color bends a different amount through glass." },
    { word: "rocket", difficulty: "easy", factoid: "Newton's third law in action. Mass shot out the back pushes the rocket forward." },
    { word: "wave", difficulty: "easy", factoid: "Sound, light, and ripples in a pond all share the same math: amplitude, frequency, wavelength." },
    { word: "black hole", difficulty: "hard", factoid: "A region where gravity is so strong even light can't escape. The boundary is called the event horizon." },
  ],
  math: [
    { word: "triangle", difficulty: "easy", factoid: "The strongest 2D shape. Bridges use triangles because they don't deform under load." },
    { word: "circle", difficulty: "easy", factoid: "The only shape with infinite lines of symmetry." },
    { word: "infinity", difficulty: "medium", factoid: "Not a number. It's the idea that something has no end. The symbol was first used in 1655." },
    { word: "pi", difficulty: "medium", factoid: "The ratio of a circle's circumference to its diameter. Never terminates, never repeats." },
    { word: "graph", difficulty: "easy", factoid: "A visual way to show how two things relate. The x-axis goes across, y-axis goes up." },
    { word: "cube", difficulty: "easy", factoid: "Six identical square faces. A standard die is a cube with numbered faces summing to 7 on opposite sides." },
    { word: "fraction", difficulty: "easy", factoid: "A part of a whole. The bottom number is how many slices, the top is how many you have." },
    { word: "abacus", difficulty: "medium", factoid: "One of the oldest calculators. Skilled users can outpace pocket calculators on basic arithmetic." },
    { word: "equation", difficulty: "easy", factoid: "A math sentence with an equals sign. Both sides must balance." },
    { word: "spiral", difficulty: "medium", factoid: "The Fibonacci spiral shows up in sunflowers, pinecones, and galaxies." },
  ],
  history: [
    { word: "pyramid", difficulty: "easy", factoid: "The Great Pyramid of Giza is about 4,500 years old. It was the tallest human-made structure for 3,800 years." },
    { word: "knight", difficulty: "easy", factoid: "Armored cavalry. A full suit of plate armor weighed about 50 pounds, lighter than a modern soldier's gear." },
    { word: "castle", difficulty: "easy", factoid: "Built mostly between 1000 and 1500 AD. Moats were for slowing attackers, not for monsters." },
    { word: "Viking ship", difficulty: "medium", factoid: "Shallow draft so they could land on beaches. Norse explorers reached North America 500 years before Columbus." },
    { word: "Roman colosseum", difficulty: "medium", factoid: "Held about 50,000 spectators. They could flood the floor to stage mock naval battles." },
    { word: "Berlin Wall", difficulty: "medium", factoid: "Stood from 1961 to 1989. It split a city for almost three decades before being torn down." },
    { word: "samurai", difficulty: "medium", factoid: "Japanese warrior class. The sword was important, but most samurai actually fought with bow and spear." },
    { word: "Statue of Liberty", difficulty: "easy", factoid: "A gift from France in 1886. The torch is held in her right hand because the artist's right-handed sketch became the final design." },
    { word: "Wright Flyer", difficulty: "medium", factoid: "First powered flight, 1903. The whole first flight covered less distance than the wingspan of a modern 747." },
    { word: "covered wagon", difficulty: "easy", factoid: "Pioneers traveled about 15 miles a day on the Oregon Trail. Most walked alongside; the wagon carried supplies." },
  ],
  geography: [
    { word: "volcano", difficulty: "easy", factoid: "A vent in the Earth's crust. There are about 1,500 potentially active volcanoes worldwide." },
    { word: "river", difficulty: "easy", factoid: "The Nile and the Amazon trade the title of longest river depending on how you measure." },
    { word: "mountain", difficulty: "easy", factoid: "Everest grows about 4 mm per year as the Indian plate keeps slamming into Asia." },
    { word: "island", difficulty: "easy", factoid: "Land surrounded by water. Greenland is the world's largest island; Australia is classified as a continent." },
    { word: "desert", difficulty: "easy", factoid: "Defined by low precipitation, not heat. Antarctica technically counts as the world's largest desert." },
    { word: "compass", difficulty: "easy", factoid: "The needle points to magnetic north, which drifts a few kilometers per year." },
    { word: "Eiffel Tower", difficulty: "easy", factoid: "Built for the 1889 World's Fair. Was supposed to come down after 20 years; the radio antenna saved it." },
    { word: "Great Wall", difficulty: "medium", factoid: "Not actually visible from space with the naked eye. It's narrow and follows the landscape's color." },
    { word: "iceberg", difficulty: "easy", factoid: "About 90 percent of an iceberg's volume is hidden underwater. The Titanic learned this the hard way." },
    { word: "rainforest", difficulty: "medium", factoid: "Covers 6 percent of Earth's surface but holds more than half of all species." },
  ],
  astronomy: [
    { word: "moon", difficulty: "easy", factoid: "Roughly a quarter Earth's diameter. It's drifting away from us about 3.8 cm per year." },
    { word: "sun", difficulty: "easy", factoid: "A medium-sized star. About 1.3 million Earths could fit inside it." },
    { word: "saturn", difficulty: "easy", factoid: "Famous for its rings, which are mostly water ice chunks ranging from dust grains to house-sized boulders." },
    { word: "comet", difficulty: "medium", factoid: "Dirty snowball orbiting the sun. The tail always points away from the sun, never trailing behind motion." },
    { word: "telescope", difficulty: "easy", factoid: "Galileo aimed one at Jupiter in 1610 and spotted four moons, proving not everything orbits Earth." },
    { word: "constellation", difficulty: "medium", factoid: "A pattern humans see in stars. Most stars in a constellation aren't actually near each other in space." },
    { word: "galaxy", difficulty: "medium", factoid: "The Milky Way holds about 100 billion stars. The observable universe holds at least 200 billion galaxies." },
    { word: "rocket launch", difficulty: "medium", factoid: "Reaching low Earth orbit requires about 7.8 km/s of speed, not just altitude." },
    { word: "satellite", difficulty: "easy", factoid: "There are over 8,000 active artificial satellites orbiting Earth right now." },
    { word: "supernova", difficulty: "hard", factoid: "A dying massive star exploding. It can briefly outshine an entire galaxy." },
  ],
  "pop-culture": [
    { word: "pizza slice", difficulty: "easy", factoid: "Pizza Margherita was named for Queen Margherita of Italy in 1889. The colors match the Italian flag." },
    { word: "headphones", difficulty: "easy", factoid: "The first stereo headphones were sold in 1958 by John Koss. Before that, they were mono only." },
    { word: "selfie", difficulty: "easy", factoid: "The word entered the Oxford Dictionary in 2013. The earliest known photographic self-portrait dates to 1839." },
    { word: "guitar", difficulty: "easy", factoid: "The first electric guitar was nicknamed the Frying Pan because of its round body and long neck, sold in 1932." },
    { word: "popcorn", difficulty: "easy", factoid: "Pops because trapped moisture turns to steam and ruptures the kernel. Only one variety of corn pops cleanly." },
    { word: "skateboard", difficulty: "easy", factoid: "Born in 1950s California when surfers wanted something to ride when the waves were flat." },
    { word: "video game controller", difficulty: "medium", factoid: "The first home console controller, for the Magnavox Odyssey in 1972, had just two dials." },
    { word: "emoji", difficulty: "easy", factoid: "The original emoji set was 176 icons designed in Japan in 1999. Unicode now defines thousands." },
    { word: "TV remote", difficulty: "easy", factoid: "Early remotes in the 1950s used flashlight bulbs aimed at photocells. Infrared became standard in the 80s." },
    { word: "rubber duck", difficulty: "easy", factoid: "Programmers use a rubber duck to debug code by explaining it out loud. The duck is non-judgmental." },
  ],
};

/** Pick 3 random candidate words from a subject for the drawer to choose from. */
export function pickCandidateWords(subject: Subject, count = 3): WordEntry[] {
  const pool = WORD_LISTS_STUB[subject] ?? [];
  if (pool.length === 0) return [];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
