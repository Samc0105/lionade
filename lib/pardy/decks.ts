/**
 * Lionade-Pardy — Templated Jeopardy-style game engine.
 *
 * Each deck is a curated 5×5 board: 5 categories of 5 tiles each, with
 * ascending Fang values (10 / 20 / 50 / 100 / 200).
 *
 * IMPORTANT: All content is hand-authored at launch. We do NOT generate
 * questions at runtime — that's V2 with Word-Bank integration.
 *
 * To add a deck:
 *   1. Define a new PardyDeck object below.
 *   2. Push it into PARDY_DECKS.
 *   3. Make sure it has exactly 5 categories, each with exactly 5 tiles
 *      in ascending Fang-value order (10, 20, 50, 100, 200).
 *
 * Answer matching lives in `lib/pardy/match.ts` and is shared between the
 * client (for instant feedback hints) and the server (the authority).
 */

export const PARDY_TILE_VALUES = [10, 20, 50, 100, 200] as const;
export type PardyTileValue = (typeof PARDY_TILE_VALUES)[number];

export interface PardyTile {
  /** Fangs awarded on correct answer. One of 10 / 20 / 50 / 100 / 200. */
  value: PardyTileValue;
  /** The Jeopardy-style clue presented to the player. */
  question: string;
  /** Canonical correct answer (Jeopardy-style "What is X?" form acceptable but not required). */
  correctAnswer: string;
  /** Accepted variants — synonyms, abbreviations, alt spellings. */
  alternateAnswers?: string[];
  /** V2 only — daily-double mechanic. Ignored in V1. */
  daily_double?: boolean;
}

export interface PardyCategory {
  /** Short category label rendered above the column. Keep under 24 chars. */
  name: string;
  /** Exactly 5 tiles, ascending value (10, 20, 50, 100, 200). */
  tiles: [PardyTile, PardyTile, PardyTile, PardyTile, PardyTile];
}

export interface PardyDeck {
  /** Stable url-safe id, e.g. "geo-101". */
  id: string;
  /** Display name, e.g. "World Geography". */
  name: string;
  /** Short one-liner shown on the deck picker. */
  description: string;
  /** Emoji icon. Pick one that reads at small sizes. */
  icon: string;
  /** Exactly 5 categories. */
  categories: [PardyCategory, PardyCategory, PardyCategory, PardyCategory, PardyCategory];
}

// ─── Deck 1: World Geography ─────────────────────────────────────────────────

const DECK_GEOGRAPHY: PardyDeck = {
  id: "geo-101",
  name: "World Geography",
  description: "Capitals, oceans, mountains, countries, and flags.",
  icon: "🌍",
  categories: [
    {
      name: "World Capitals",
      tiles: [
        { value: 10, question: "The capital of France.", correctAnswer: "Paris" },
        { value: 20, question: "The capital of Japan.", correctAnswer: "Tokyo" },
        { value: 50, question: "The capital of Australia (it is not Sydney).", correctAnswer: "Canberra" },
        { value: 100, question: "The capital of Kazakhstan, renamed in 2019.", correctAnswer: "Astana", alternateAnswers: ["Nur-Sultan", "Nursultan"] },
        { value: 200, question: "The administrative capital of South Africa.", correctAnswer: "Pretoria" },
      ],
    },
    {
      name: "Oceans & Seas",
      tiles: [
        { value: 10, question: "The largest ocean on Earth.", correctAnswer: "Pacific Ocean", alternateAnswers: ["Pacific"] },
        { value: 20, question: "The ocean between Africa and Australia.", correctAnswer: "Indian Ocean", alternateAnswers: ["Indian"] },
        { value: 50, question: "The sea between Italy and the Balkans.", correctAnswer: "Adriatic Sea", alternateAnswers: ["Adriatic"] },
        { value: 100, question: "The world's saltiest large body of water, bordering Jordan and Israel.", correctAnswer: "Dead Sea", alternateAnswers: ["The Dead Sea"] },
        { value: 200, question: "The shallow sea separating Russia and Alaska.", correctAnswer: "Bering Sea", alternateAnswers: ["Bering"] },
      ],
    },
    {
      name: "Mountains",
      tiles: [
        { value: 10, question: "Tallest mountain on Earth above sea level.", correctAnswer: "Mount Everest", alternateAnswers: ["Everest"] },
        { value: 20, question: "Mountain range running down the western edge of South America.", correctAnswer: "Andes", alternateAnswers: ["The Andes", "Andes Mountains"] },
        { value: 50, question: "Africa's tallest peak.", correctAnswer: "Mount Kilimanjaro", alternateAnswers: ["Kilimanjaro"] },
        { value: 100, question: "The second-highest peak in the world, on the China-Pakistan border.", correctAnswer: "K2" },
        { value: 200, question: "The tallest mountain in North America, in Alaska.", correctAnswer: "Denali", alternateAnswers: ["Mount McKinley", "McKinley"] },
      ],
    },
    {
      name: "Countries by Continent",
      tiles: [
        { value: 10, question: "The largest country in South America.", correctAnswer: "Brazil" },
        { value: 20, question: "The only country that is also a continent.", correctAnswer: "Australia" },
        { value: 50, question: "The largest country in Africa by area.", correctAnswer: "Algeria" },
        { value: 100, question: "The smallest country in the world.", correctAnswer: "Vatican City", alternateAnswers: ["The Vatican", "Vatican"] },
        { value: 200, question: "The only country located on all four hemispheres.", correctAnswer: "Kiribati" },
      ],
    },
    {
      name: "Flags",
      tiles: [
        { value: 10, question: "Country whose flag is a red circle on a white field.", correctAnswer: "Japan" },
        { value: 20, question: "Country whose flag has a single red maple leaf on white between two red bars.", correctAnswer: "Canada" },
        { value: 50, question: "The only national flag that is not rectangular.", correctAnswer: "Nepal" },
        { value: 100, question: "Country whose flag is a green field with an Arabic inscription, used until 2023.", correctAnswer: "Saudi Arabia" },
        { value: 200, question: "The only country whose flag features a firearm.", correctAnswer: "Mozambique" },
      ],
    },
  ],
};

// ─── Deck 2: General Knowledge ───────────────────────────────────────────────

const DECK_GEN_KNOWLEDGE: PardyDeck = {
  id: "gen-knowledge",
  name: "General Knowledge",
  description: "History, science, pop culture, sports, literature.",
  icon: "🧠",
  categories: [
    {
      name: "History",
      tiles: [
        { value: 10, question: "The year World War II ended.", correctAnswer: "1945" },
        { value: 20, question: "First President of the United States.", correctAnswer: "George Washington", alternateAnswers: ["Washington"] },
        { value: 50, question: "Ancient wonder of the world located in Egypt that still stands today.", correctAnswer: "Great Pyramid of Giza", alternateAnswers: ["Pyramid of Giza", "Great Pyramid"] },
        { value: 100, question: "The year the Berlin Wall fell.", correctAnswer: "1989" },
        { value: 200, question: "Roman emperor who declared Christianity legal in 313 AD.", correctAnswer: "Constantine", alternateAnswers: ["Constantine the Great", "Constantine I"] },
      ],
    },
    {
      name: "Science",
      tiles: [
        { value: 10, question: "Chemical symbol for gold.", correctAnswer: "Au" },
        { value: 20, question: "The closest planet to the Sun.", correctAnswer: "Mercury" },
        { value: 50, question: "The scientist who proposed the theory of general relativity.", correctAnswer: "Albert Einstein", alternateAnswers: ["Einstein"] },
        { value: 100, question: "The powerhouse of the cell.", correctAnswer: "Mitochondria", alternateAnswers: ["Mitochondrion", "The mitochondria"] },
        { value: 200, question: "The SI unit of electric resistance.", correctAnswer: "Ohm", alternateAnswers: ["Ohms"] },
      ],
    },
    {
      name: "Pop Culture",
      tiles: [
        { value: 10, question: "The wizard with a lightning-bolt scar.", correctAnswer: "Harry Potter" },
        { value: 20, question: "The fictional African nation of Black Panther.", correctAnswer: "Wakanda" },
        { value: 50, question: "The streaming series featuring Eleven and the Upside Down.", correctAnswer: "Stranger Things" },
        { value: 100, question: "The artist behind the 2015 album '25' featuring 'Hello'.", correctAnswer: "Adele" },
        { value: 200, question: "The 1994 film whose protagonist sits on a bench and runs across America.", correctAnswer: "Forrest Gump" },
      ],
    },
    {
      name: "Sports",
      tiles: [
        { value: 10, question: "Number of players on a basketball team on the court per side.", correctAnswer: "5", alternateAnswers: ["five"] },
        { value: 20, question: "The sport played at Wimbledon.", correctAnswer: "Tennis" },
        { value: 50, question: "Country that has won the most FIFA World Cups.", correctAnswer: "Brazil" },
        { value: 100, question: "The Olympic motto, in three Latin words.", correctAnswer: "Citius, Altius, Fortius", alternateAnswers: ["Faster Higher Stronger", "Citius Altius Fortius"] },
        { value: 200, question: "The only NFL team to complete an undefeated season including playoffs.", correctAnswer: "Miami Dolphins", alternateAnswers: ["Dolphins", "1972 Dolphins"] },
      ],
    },
    {
      name: "Literature",
      tiles: [
        { value: 10, question: "The author of 'Romeo and Juliet'.", correctAnswer: "William Shakespeare", alternateAnswers: ["Shakespeare"] },
        { value: 20, question: "The young wizard's school in J.K. Rowling's novels.", correctAnswer: "Hogwarts", alternateAnswers: ["Hogwarts School of Witchcraft and Wizardry"] },
        { value: 50, question: "The dystopian novel by George Orwell published in 1949.", correctAnswer: "1984", alternateAnswers: ["Nineteen Eighty-Four"] },
        { value: 100, question: "The author of 'One Hundred Years of Solitude'.", correctAnswer: "Gabriel Garcia Marquez", alternateAnswers: ["Garcia Marquez", "Gabriel García Márquez", "García Márquez"] },
        { value: 200, question: "The poet who wrote 'The Waste Land' in 1922.", correctAnswer: "T.S. Eliot", alternateAnswers: ["T S Eliot", "TS Eliot", "Eliot", "Thomas Stearns Eliot"] },
      ],
    },
  ],
};

// ─── Deck 3: AWS Fundamentals ────────────────────────────────────────────────

const DECK_AWS_BASICS: PardyDeck = {
  id: "aws-basics",
  name: "AWS Fundamentals",
  description: "Compute, storage, networking, identity, billing.",
  icon: "☁️",
  categories: [
    {
      name: "Compute",
      tiles: [
        { value: 10, question: "AWS's virtual server service.", correctAnswer: "EC2", alternateAnswers: ["Amazon EC2", "Elastic Compute Cloud"] },
        { value: 20, question: "AWS's serverless function-as-a-service.", correctAnswer: "Lambda", alternateAnswers: ["AWS Lambda"] },
        { value: 50, question: "AWS's managed container orchestration service compatible with Kubernetes.", correctAnswer: "EKS", alternateAnswers: ["Amazon EKS", "Elastic Kubernetes Service"] },
        { value: 100, question: "The EC2 purchase option that offers the biggest discount in exchange for the ability to be reclaimed with two minutes notice.", correctAnswer: "Spot Instances", alternateAnswers: ["Spot", "Spot Instance"] },
        { value: 200, question: "AWS's bare-metal hypervisor introduced in 2017 that underpins newer EC2 instance types.", correctAnswer: "Nitro", alternateAnswers: ["AWS Nitro", "Nitro System"] },
      ],
    },
    {
      name: "Storage",
      tiles: [
        { value: 10, question: "AWS's object storage service.", correctAnswer: "S3", alternateAnswers: ["Amazon S3", "Simple Storage Service"] },
        { value: 20, question: "Block storage volumes you attach to EC2.", correctAnswer: "EBS", alternateAnswers: ["Amazon EBS", "Elastic Block Store"] },
        { value: 50, question: "AWS's managed NFS-compatible shared file system for Linux workloads.", correctAnswer: "EFS", alternateAnswers: ["Amazon EFS", "Elastic File System"] },
        { value: 100, question: "The S3 storage class designed for long-term archival with retrieval in hours.", correctAnswer: "Glacier", alternateAnswers: ["S3 Glacier", "Amazon S3 Glacier", "Glacier Flexible Retrieval"] },
        { value: 200, question: "The S3 feature that automatically transitions or expires objects based on age.", correctAnswer: "Lifecycle Policy", alternateAnswers: ["Lifecycle Policies", "Lifecycle Rules", "S3 Lifecycle"] },
      ],
    },
    {
      name: "Networking",
      tiles: [
        { value: 10, question: "The AWS service that lets you provision an isolated virtual network.", correctAnswer: "VPC", alternateAnswers: ["Amazon VPC", "Virtual Private Cloud"] },
        { value: 20, question: "AWS's DNS service.", correctAnswer: "Route 53", alternateAnswers: ["Route53", "Amazon Route 53"] },
        { value: 50, question: "The AWS content delivery network.", correctAnswer: "CloudFront", alternateAnswers: ["Amazon CloudFront"] },
        { value: 100, question: "The VPC component that lets private subnets reach the internet outbound without being reachable inbound.", correctAnswer: "NAT Gateway", alternateAnswers: ["NAT", "Network Address Translation Gateway"] },
        { value: 200, question: "The service that lets you peer VPCs together at scale through a central hub.", correctAnswer: "Transit Gateway", alternateAnswers: ["AWS Transit Gateway", "TGW"] },
      ],
    },
    {
      name: "Identity & Security",
      tiles: [
        { value: 10, question: "The AWS service that manages users, groups, and permissions.", correctAnswer: "IAM", alternateAnswers: ["AWS IAM", "Identity and Access Management"] },
        { value: 20, question: "An IAM permission attached to a user, group, or role.", correctAnswer: "Policy", alternateAnswers: ["IAM Policy", "Policies"] },
        { value: 50, question: "The IAM identity intended to be assumed temporarily, often by services or federated users.", correctAnswer: "Role", alternateAnswers: ["IAM Role", "Roles"] },
        { value: 100, question: "AWS's managed service for storing and rotating database credentials and API keys.", correctAnswer: "Secrets Manager", alternateAnswers: ["AWS Secrets Manager"] },
        { value: 200, question: "AWS's managed service for centrally managing encryption keys.", correctAnswer: "KMS", alternateAnswers: ["AWS KMS", "Key Management Service"] },
      ],
    },
    {
      name: "Billing & Support",
      tiles: [
        { value: 10, question: "The AWS pricing model where you pay only for what you use, with no upfront commitment.", correctAnswer: "On-Demand", alternateAnswers: ["On Demand", "Pay-as-you-go", "Pay as you go"] },
        { value: 20, question: "AWS's free-tier service that provides 12 months of limited free usage to new accounts.", correctAnswer: "AWS Free Tier", alternateAnswers: ["Free Tier"] },
        { value: 50, question: "The AWS service that lets you set custom alerts when your spending crosses a threshold.", correctAnswer: "AWS Budgets", alternateAnswers: ["Budgets"] },
        { value: 100, question: "The AWS support plan tier that includes a Technical Account Manager.", correctAnswer: "Enterprise", alternateAnswers: ["Enterprise Support", "AWS Enterprise Support"] },
        { value: 200, question: "The AWS pricing commitment that offers up to a 72% discount in exchange for a one or three year compute-hours commitment.", correctAnswer: "Savings Plans", alternateAnswers: ["Savings Plan", "Compute Savings Plans"] },
      ],
    },
  ],
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const PARDY_DECKS: PardyDeck[] = [
  DECK_GEOGRAPHY,
  DECK_GEN_KNOWLEDGE,
  DECK_AWS_BASICS,
];

/** Look a deck up by id. Returns null if unknown. */
export function getDeck(id: string): PardyDeck | null {
  return PARDY_DECKS.find((d) => d.id === id) ?? null;
}

/**
 * Stable id for a tile within a deck — used by the client to identify which
 * tile is being submitted. Format: `<deckId>:<categoryIndex>:<tileIndex>`.
 * Category and tile indexes are 0-based.
 */
export function tileId(deckId: string, categoryIndex: number, tileIndex: number): string {
  return `${deckId}:${categoryIndex}:${tileIndex}`;
}

/** Parse a tileId back into its components. Returns null if malformed. */
export function parseTileId(
  id: string,
): { deckId: string; categoryIndex: number; tileIndex: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3) return null;
  const c = Number(parts[1]);
  const t = Number(parts[2]);
  if (!Number.isInteger(c) || !Number.isInteger(t)) return null;
  if (c < 0 || c > 4 || t < 0 || t > 4) return null;
  return { deckId: parts[0], categoryIndex: c, tileIndex: t };
}

/** Look up a specific tile by full tileId. */
export function getTile(id: string): { deck: PardyDeck; tile: PardyTile; category: PardyCategory } | null {
  const parsed = parseTileId(id);
  if (!parsed) return null;
  const deck = getDeck(parsed.deckId);
  if (!deck) return null;
  const category = deck.categories[parsed.categoryIndex];
  if (!category) return null;
  const tile = category.tiles[parsed.tileIndex];
  if (!tile) return null;
  return { deck, tile, category };
}
