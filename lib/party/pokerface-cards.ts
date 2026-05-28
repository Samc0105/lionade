// Poker Face (Lionade Party) — curated fact cards.
//
// Moved out of the competitive arena 2026-05-28 (see project_lionade_party.md +
// project_competitive_modes.md). Poker Face is now an N-player party game: one
// presenter per round draws a card in secret, then chooses to either present the
// TRUE fact as written, or invent a LIE (an edited claim) and present that. The
// rest of the room calls BELIEVE or DOUBT. The LIE is always player-authored —
// we never generate it. NO Fang wager, NO ELO: pure points / bragging rights.
//
// Because the game is "best in person," the presenter's FACE is the tell — there
// is no confidence-wager mechanic (that was a remote crutch in the old duel).
//
// These 51 cards were harvested verbatim from the retired
// lib/competitive/pokerface-cards.ts. Content is well-established, verifiable
// trivia, kept family-safe.

export interface PokerFaceCard {
  /** The subject word shown on the card (NOT secret — the room sees it). */
  word: string;
  /** A verifiably TRUE fact about the word. SECRET until reveal: the presenter
   *  may show this verbatim (truth) or invent a false claim instead (lie). */
  fact: string;
}

export const POKERFACE_CARDS: PokerFaceCard[] = [
  { word: "Octopus", fact: "An octopus has three hearts." },
  { word: "Honey", fact: "Honey never spoils and can last thousands of years." },
  { word: "Bananas", fact: "Bananas are botanically classified as berries." },
  { word: "Eiffel Tower", fact: "The Eiffel Tower can grow more than 15 centimeters taller in summer heat." },
  { word: "Sharks", fact: "Sharks existed before trees did." },
  { word: "Venus", fact: "A day on Venus is longer than its year." },
  { word: "Wombat", fact: "Wombats produce cube-shaped droppings." },
  { word: "Hawaii", fact: "Hawaii is the only U.S. state that grows coffee commercially." },
  { word: "Saturn", fact: "Saturn is the least dense planet and would float in a large enough body of water." },
  { word: "Mosquitoes", fact: "Mosquitoes are considered the deadliest animal to humans by transmitted disease." },
  { word: "Eyes", fact: "The human eye can distinguish roughly ten million different colors." },
  { word: "Cleopatra", fact: "Cleopatra lived closer in time to the Moon landing than to the building of the Great Pyramid." },
  { word: "Sloths", fact: "Sloths can hold their breath longer than dolphins can." },
  { word: "Lightning", fact: "A single lightning bolt can be hotter than the surface of the Sun." },
  { word: "Penguins", fact: "Emperor penguins can dive deeper than 500 meters." },
  { word: "Stomach", fact: "The lining of the human stomach replaces itself every few days." },
  { word: "Mount Everest", fact: "Mount Everest is not the tallest mountain measured from base to peak; that is Mauna Kea." },
  { word: "Koalas", fact: "Koalas have fingerprints almost indistinguishable from human ones." },
  { word: "Greenland", fact: "Greenland is mostly covered by ice despite its name." },
  { word: "Spiders", fact: "Spider silk is, by weight, stronger than steel." },
  { word: "Pluto", fact: "Pluto has never completed a full orbit since its discovery in 1930." },
  { word: "Bees", fact: "Honeybees can recognize individual human faces." },
  { word: "Tongue", fact: "The idea that the tongue has separate taste zones is a long-debunked myth." },
  { word: "Antarctica", fact: "Antarctica is technically the world's largest desert." },
  { word: "Giraffes", fact: "A giraffe has the same number of neck vertebrae as a human: seven." },
  { word: "Diamonds", fact: "Diamonds are not the rarest gemstone; many others are far scarcer." },
  { word: "Jupiter", fact: "Jupiter has the shortest day of any planet in the solar system." },
  { word: "Hummingbirds", fact: "Hummingbirds are the only birds that can fly backwards." },
  { word: "Salt", fact: "There was a time when salt was so valuable it was used to pay Roman soldiers." },
  { word: "Brain", fact: "The human brain uses roughly 20 percent of the body's total energy." },
  { word: "Kangaroos", fact: "Kangaroos cannot move backwards easily because of their tail and leg structure." },
  { word: "The Moon", fact: "The Moon is slowly drifting away from Earth, a few centimeters each year." },
  { word: "Cashews", fact: "Cashews grow attached to the bottom of a fruit called the cashew apple." },
  { word: "Flamingos", fact: "Flamingos are born grey and turn pink from the food they eat." },
  { word: "Iceland", fact: "Iceland has no mosquitoes living naturally on the island." },
  { word: "Snails", fact: "Some snails can sleep for up to three years at a time." },
  { word: "The Pacific", fact: "The Pacific Ocean is wider than the Moon's diameter." },
  { word: "Carrots", fact: "Carrots were originally purple before orange varieties were cultivated." },
  { word: "Cows", fact: "Cows have best friends and can become stressed when separated from them." },
  { word: "Lobsters", fact: "Lobsters were once considered a poor person's food in colonial America." },
  { word: "Niagara Falls", fact: "Niagara Falls has been deliberately shut off by engineers in the past." },
  { word: "Ostriches", fact: "An ostrich's eye is larger than its brain." },
  { word: "Vatican City", fact: "Vatican City is the smallest country in the world by both area and population." },
  { word: "Tomatoes", fact: "Tomatoes are botanically a fruit but were legally ruled a vegetable in the U.S." },
  { word: "Elephants", fact: "Elephants are one of the few animals that appear to recognize themselves in a mirror." },
  { word: "Mercury", fact: "Mercury is the closest planet to the Sun but not the hottest; Venus is hotter." },
  { word: "Bamboo", fact: "Some species of bamboo can grow nearly a meter in a single day." },
  { word: "Polar Bears", fact: "Polar bears have black skin underneath their translucent fur." },
  { word: "The Sahara", fact: "The Sahara desert occasionally gets snowfall in some regions." },
  { word: "Owls", fact: "Owls cannot move their eyeballs, so they rotate their heads instead." },
  { word: "Coconuts", fact: "Coconuts are not nuts; they are classified as a type of fruit called a drupe." },
  { word: "The Great Wall", fact: "The Great Wall of China is not visible to the naked eye from space." },
];

/** Draw a random card, optionally excluding words already used this game so the
 *  same fact doesn't recur within a single room session. Falls back to the full
 *  deck once every card has been seen. */
export function drawRandomCard(usedWords: string[] = []): PokerFaceCard {
  const used = new Set(usedWords);
  const fresh = POKERFACE_CARDS.filter((c) => !used.has(c.word));
  const pool = fresh.length > 0 ? fresh : POKERFACE_CARDS;
  return pool[Math.floor(Math.random() * pool.length)];
}
