// Spectrum Slider — curated estimation prompts.
//
// Each entry has a prompt, the TRUE value, and a [min, max] range that defines
// the slider domain. The player drags a slider (0-100%) mapped linearly onto
// [min, max]; the closer their value is to the true value, the more points they
// score (distance-based partial credit, computed in lib/competitive/scoring of
// the shared platform). Both players answer the same prompt each round.
//
// Values are well-established and verifiable. Where a value is approximate
// (e.g. surface temperatures, populations), we use a commonly-cited figure and
// the scoring tolerance is generous enough that small disagreements do not
// punish a good guess.

export interface SpectrumEntry {
  id: string;
  prompt: string;
  trueValue: number;
  min: number;
  max: number;
  unit: string;
}

export const SPECTRUM_DATA: SpectrumEntry[] = [
  { id: "moon-landing", prompt: "What year did humans first land on the Moon?", trueValue: 1969, min: 1940, max: 2000, unit: "" },
  { id: "everest", prompt: "How tall is Mount Everest?", trueValue: 8849, min: 4000, max: 12000, unit: "m" },
  { id: "venus-temp", prompt: "What is the average surface temperature of Venus?", trueValue: 465, min: 0, max: 900, unit: "C" },
  { id: "human-bones", prompt: "How many bones are in the adult human body?", trueValue: 206, min: 100, max: 400, unit: "" },
  { id: "great-wall", prompt: "How long is the Great Wall of China (total, all branches)?", trueValue: 21196, min: 5000, max: 40000, unit: "km" },
  { id: "speed-light", prompt: "What is the speed of light, in thousands of km per second?", trueValue: 300, min: 100, max: 500, unit: "k km/s" },
  { id: "blue-whale", prompt: "How long can a blue whale grow?", trueValue: 30, min: 10, max: 60, unit: "m" },
  { id: "ww2-end", prompt: "What year did World War II end?", trueValue: 1945, min: 1900, max: 1980, unit: "" },
  { id: "earth-age", prompt: "How old is Earth, in billions of years?", trueValue: 4.5, min: 1, max: 10, unit: "B yrs" },
  { id: "human-heart", prompt: "How many times does the average human heart beat per minute at rest?", trueValue: 72, min: 30, max: 150, unit: "bpm" },
  { id: "marathon", prompt: "How long is a marathon?", trueValue: 42.2, min: 20, max: 60, unit: "km" },
  { id: "boiling", prompt: "At what temperature does water boil at sea level?", trueValue: 100, min: 50, max: 150, unit: "C" },
  { id: "us-states", prompt: "How many states are in the United States?", trueValue: 50, min: 20, max: 80, unit: "" },
  { id: "amazon", prompt: "How long is the Amazon River?", trueValue: 6400, min: 2000, max: 9000, unit: "km" },
  { id: "sun-distance", prompt: "How far is the Sun from Earth, in millions of km?", trueValue: 150, min: 50, max: 300, unit: "M km" },
  { id: "elements", prompt: "How many elements are on the periodic table?", trueValue: 118, min: 50, max: 200, unit: "" },
  { id: "human-teeth", prompt: "How many teeth does a typical adult human have?", trueValue: 32, min: 16, max: 60, unit: "" },
  { id: "olympics-start", prompt: "What year were the first modern Olympic Games held?", trueValue: 1896, min: 1800, max: 1950, unit: "" },
  { id: "pacific-deep", prompt: "How deep is the Mariana Trench (deepest point)?", trueValue: 10935, min: 5000, max: 15000, unit: "m" },
  { id: "cheetah", prompt: "How fast can a cheetah run at top speed?", trueValue: 112, min: 50, max: 150, unit: "km/h" },
  { id: "human-genes", prompt: "Roughly how many protein-coding genes are in the human genome (thousands)?", trueValue: 20, min: 5, max: 100, unit: "k" },
  { id: "saturn-moons", prompt: "How many confirmed moons does Saturn have (approx)?", trueValue: 146, min: 10, max: 300, unit: "" },
  { id: "declaration", prompt: "What year was the U.S. Declaration of Independence signed?", trueValue: 1776, min: 1600, max: 1900, unit: "" },
  { id: "eiffel-height", prompt: "How tall is the Eiffel Tower?", trueValue: 330, min: 100, max: 600, unit: "m" },
  { id: "sahara-area", prompt: "How large is the Sahara Desert, in millions of square km?", trueValue: 9.2, min: 1, max: 20, unit: "M sq km" },
  { id: "human-body-water", prompt: "What percentage of the adult human body is water?", trueValue: 60, min: 20, max: 95, unit: "%" },
  { id: "everest-first", prompt: "What year was Mount Everest first summited?", trueValue: 1953, min: 1900, max: 1990, unit: "" },
  { id: "earth-circumference", prompt: "What is Earth's circumference at the equator?", trueValue: 40075, min: 20000, max: 60000, unit: "km" },
  { id: "sound-speed", prompt: "What is the speed of sound in air, in m per second?", trueValue: 343, min: 100, max: 600, unit: "m/s" },
  { id: "human-lifespan", prompt: "What is the current global average human life expectancy?", trueValue: 73, min: 40, max: 100, unit: "yrs" },
  { id: "berlin-wall", prompt: "What year did the Berlin Wall fall?", trueValue: 1989, min: 1940, max: 2010, unit: "" },
  { id: "moon-distance", prompt: "How far is the Moon from Earth, in thousands of km?", trueValue: 384, min: 100, max: 700, unit: "k km" },
  { id: "blue-whale-weight", prompt: "How much can a blue whale weigh?", trueValue: 150, min: 50, max: 300, unit: "tonnes" },
  { id: "internet-year", prompt: "What year did the World Wide Web become publicly available?", trueValue: 1991, min: 1960, max: 2010, unit: "" },
  { id: "human-cells", prompt: "Roughly how many cells are in the human body (trillions)?", trueValue: 37, min: 1, max: 100, unit: "T" },
  { id: "nile-length", prompt: "How long is the Nile River?", trueValue: 6650, min: 2000, max: 9000, unit: "km" },
  { id: "sun-temp", prompt: "What is the surface temperature of the Sun?", trueValue: 5500, min: 1000, max: 10000, unit: "C" },
  { id: "great-pyramid", prompt: "How tall was the Great Pyramid of Giza originally?", trueValue: 146, min: 50, max: 300, unit: "m" },
  { id: "languages", prompt: "Roughly how many living languages are spoken worldwide?", trueValue: 7000, min: 1000, max: 15000, unit: "" },
  { id: "titanic", prompt: "What year did the Titanic sink?", trueValue: 1912, min: 1850, max: 1970, unit: "" },
  { id: "human-brain-weight", prompt: "How much does the adult human brain weigh?", trueValue: 1400, min: 500, max: 3000, unit: "g" },
  { id: "world-pop", prompt: "What is the world population, in billions?", trueValue: 8, min: 1, max: 15, unit: "B" },
  { id: "antarctica-ice", prompt: "What percent of Antarctica is covered by ice?", trueValue: 98, min: 50, max: 100, unit: "%" },
  { id: "lightning-temp", prompt: "How hot can a lightning bolt get, in thousands of C?", trueValue: 30, min: 5, max: 60, unit: "k C" },
  { id: "first-flight", prompt: "What year did the Wright brothers make their first powered flight?", trueValue: 1903, min: 1850, max: 1950, unit: "" },
  { id: "blood-vessels", prompt: "Total length of blood vessels in the human body, in thousands of km?", trueValue: 100, min: 10, max: 200, unit: "k km" },
  { id: "jupiter-moons", prompt: "How many confirmed moons does Jupiter have (approx)?", trueValue: 95, min: 10, max: 200, unit: "" },
  { id: "redwood", prompt: "How tall can the tallest redwood trees grow?", trueValue: 115, min: 30, max: 200, unit: "m" },
  { id: "honey-jar", prompt: "How many flowers must bees visit to make one jar of honey (millions)?", trueValue: 2, min: 0.5, max: 10, unit: "M" },
  { id: "human-skin", prompt: "What is the total surface area of adult human skin?", trueValue: 2, min: 0.5, max: 5, unit: "sq m" },
  { id: "light-minutes-sun", prompt: "How many minutes does sunlight take to reach Earth?", trueValue: 8.3, min: 1, max: 30, unit: "min" },
  { id: "mercury-year", prompt: "How many Earth days does Mercury take to orbit the Sun?", trueValue: 88, min: 20, max: 300, unit: "days" },
  { id: "human-chromosomes", prompt: "How many chromosomes are in a typical human cell?", trueValue: 46, min: 10, max: 100, unit: "" },
  { id: "gutenberg-bible", prompt: "What year did Gutenberg print his famous Bible?", trueValue: 1455, min: 1300, max: 1600, unit: "" },
  { id: "colosseum-capacity", prompt: "Roughly how many spectators could the Roman Colosseum hold?", trueValue: 50000, min: 10000, max: 100000, unit: "" },
  { id: "octopus-hearts", prompt: "How many hearts does an octopus have?", trueValue: 3, min: 1, max: 10, unit: "" },
  { id: "burj-khalifa", prompt: "How tall is the Burj Khalifa, the world's tallest building?", trueValue: 828, min: 300, max: 1500, unit: "m" },
  { id: "roman-empire-fall", prompt: "What year did the Western Roman Empire fall?", trueValue: 476, min: 100, max: 900, unit: "" },
  { id: "dna-bases", prompt: "How many base pairs are in the human genome, in billions?", trueValue: 3.2, min: 0.5, max: 10, unit: "B" },
  { id: "atlantic-ocean-area", prompt: "How large is the Atlantic Ocean, in millions of square km?", trueValue: 106, min: 30, max: 200, unit: "M sq km" },
  { id: "printing-press-china", prompt: "How many years old is the Great Sphinx of Giza, approximately?", trueValue: 4500, min: 1000, max: 8000, unit: "yrs" },
  { id: "hummingbird-wingbeats", prompt: "How many times per second can a hummingbird beat its wings?", trueValue: 50, min: 10, max: 120, unit: "/s" },
  { id: "pi-digits-known", prompt: "How many digits are there before the decimal point of the value of pi times 100?", trueValue: 3, min: 1, max: 6, unit: "" },
  { id: "french-revolution", prompt: "What year did the French Revolution begin?", trueValue: 1789, min: 1600, max: 1900, unit: "" },
  { id: "atom-diameter", prompt: "What is the diameter of a typical atom, in tenths of a nanometer?", trueValue: 1, min: 0.1, max: 10, unit: "0.1 nm" },
  { id: "sequoia-age", prompt: "How old can the oldest giant sequoia trees grow to be?", trueValue: 3200, min: 500, max: 6000, unit: "yrs" },
  { id: "great-barrier-reef", prompt: "How long is the Great Barrier Reef?", trueValue: 2300, min: 500, max: 5000, unit: "km" },
  { id: "moon-diameter", prompt: "What is the diameter of the Moon?", trueValue: 3475, min: 1000, max: 8000, unit: "km" },
  { id: "black-death-year", prompt: "What year did the Black Death first reach Europe?", trueValue: 1347, min: 1100, max: 1500, unit: "" },
  { id: "human-blood-liters", prompt: "How many liters of blood are in the average adult human body?", trueValue: 5, min: 1, max: 12, unit: "L" },
  { id: "jupiter-diameter", prompt: "What is the diameter of Jupiter, in thousands of km?", trueValue: 140, min: 50, max: 300, unit: "k km" },
  { id: "printing-hiroshima", prompt: "What year was the printing press invented by Gutenberg (movable type in Europe)?", trueValue: 1440, min: 1200, max: 1600, unit: "" },
  { id: "dead-sea-depth", prompt: "How far below sea level is the shore of the Dead Sea?", trueValue: 430, min: 100, max: 900, unit: "m below" },
  { id: "snail-speed", prompt: "How many meters can a garden snail travel in one hour?", trueValue: 45, min: 5, max: 150, unit: "m/h" },
  { id: "sputnik-year", prompt: "What year was Sputnik, the first artificial satellite, launched?", trueValue: 1957, min: 1920, max: 1990, unit: "" },
  { id: "human-dna-length", prompt: "If unwound, how long is the DNA in a single human cell, in meters?", trueValue: 2, min: 0.5, max: 10, unit: "m" },
  { id: "vatican-area", prompt: "How large is Vatican City, the world's smallest country, in hectares?", trueValue: 44, min: 10, max: 200, unit: "ha" },
  { id: "penguin-dive", prompt: "How deep can an emperor penguin dive?", trueValue: 500, min: 100, max: 1000, unit: "m" },
  { id: "magna-carta", prompt: "What year was the Magna Carta sealed?", trueValue: 1215, min: 900, max: 1500, unit: "" },
];

export function pickSpectrumEntries(n: number): SpectrumEntry[] {
  const shuffled = [...SPECTRUM_DATA].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}
