/**
 * Source of truth for /changelog entries. Hand-authored from
 * docs/CHANGELOG.md and recent git history. User-language only:
 * no commit hashes, no file paths, no internal jargon.
 *
 * Adding an entry:
 *   1. Prepend a new object to ENTRIES (newest first).
 *   2. Pick the closest category. Highlights stay 3-7 bullets.
 *   3. No em-dashes anywhere in user-facing copy.
 */

export type ChangelogCategory = "feature" | "polish" | "fix" | "infra";

export type ChangelogEntry = {
  id: string;
  date: string; // ISO YYYY-MM-DD
  title: string;
  category: ChangelogCategory;
  summary: string;
  highlights: string[];
};

export const ENTRIES: ChangelogEntry[] = [
  {
    id: "daily-bet-state-polish",
    date: "2026-06-06",
    title: "Daily Bet feels like a real ritual now",
    category: "polish",
    summary:
      "The dashboard Daily Bet card was rebuilt across all four of its life states so wagering, winning, losing, and looking back actually feel rewarding.",
    highlights: [
      "Active wager state with a live result-pending pulse",
      "Win state celebrates with confetti, a payout breakdown, and a streak tick",
      "Loss state stays kind and surfaces the next chance to play",
      "Tap the card to reopen today's history without leaving the dashboard",
    ],
  },
  {
    id: "shareable-previews-and-blog",
    date: "2026-06-06",
    title: "Shareable previews, everywhere",
    category: "feature",
    summary:
      "Every Lionade link now renders a route-specific social preview, the blog is live with hand-written study guides, and pinning the site to your iPhone home screen no longer looks generic.",
    highlights: [
      "Per-route Open Graph cards, so /pricing, /about, and the dashboard all preview correctly",
      "Blog launched at /blog with deep guides for AWS Security Specialty, Security+, APUSH, and AP Calc BC",
      "PWA manifest so iOS home-screen pins launch with a clean Lionade icon",
      "SEO metadata, structured data, and sitemap refreshed across the marketing surfaces",
    ],
  },
  {
    id: "surface-polish-sweep",
    date: "2026-06-06",
    title: "Surface polish across the whole app",
    category: "polish",
    summary:
      "Two weeks of design and density work landed across roughly twenty surfaces. Same product, sharper feel, faster reads.",
    highlights: [
      "Dashboard hero, daily-claim, and empty states tightened",
      "Wallet built as a trust surface with a balance hero and a transactions ledger",
      "Leaderboard gained a live podium, an overtake CTA, and your-row pinning",
      "Mastery and Vocab session surfaces redesigned with progress particles and reveal animations",
      "Navbar got limelight tabs, a tiered streak chip, and a calmer bell",
      "Shop, Compete, Academia, Classes, Quiz, Coach, Pardy, and Social all hit the same density bar",
    ],
  },
  {
    id: "multiplayer-party-stability",
    date: "2026-06-06",
    title: "Multiplayer party suite is now stuck-proof",
    category: "fix",
    summary:
      "We hardened the live party games against the failure modes our 2 to 6 player playtests kept hitting. No more frozen rounds, no more lost votes.",
    highlights: [
      "Bluff Trivia vote save is reliable even when the host plays along",
      "Sketchy round-end auto-advances and unsticks if the host disconnects",
      "Sketchy non-host drawers now reliably see their word picker",
      "Vote phase clears stale errors the moment a new round begins",
      "Both games drop to 2-player rooms for quick duo testing",
    ],
  },
  {
    id: "ux-hygiene-sweep",
    date: "2026-06-05",
    title: "UX hygiene sweep: no more raw error strings, no more dead ends",
    category: "fix",
    summary:
      "We swept the app for native browser dialogs, raw validator strings reaching users, and empty states with no way forward. Friendly copy and clear CTAs everywhere they were missing.",
    highlights: [
      "Replaced every browser confirm and alert popup with a calm on-brand modal or toast",
      "Class details, notes, grades, and vocab deletes now use the same Confirm dialog",
      "Profile, Wallet, Badges, and Bounty Board empty states now invite you back into the loop",
      "Vocab add-word flow no longer leaks validator text when a required field is missing",
      "Stale Resume banner on the dashboard finally retires when you stop a session",
    ],
  },
  {
    id: "trust-toggles-are-real",
    date: "2026-06-05",
    title: "Privacy and notification toggles are real now",
    category: "fix",
    summary:
      "Profile and Settings preferences used to live in your browser only. They now persist on the server and actually change what other people can see.",
    highlights: [
      "Notification and privacy toggles save to your account, not localStorage",
      "Setting your profile to private hides you from search and leaderboards",
      "Delete Account moved out of theory into a type-your-email confirmation flow",
      "Subjects on /learn no longer dead-end at a Coming Soon gate",
    ],
  },
  {
    id: "shop-tier-tinting",
    date: "2026-06-05",
    title: "Shop reads its rarity from across the room",
    category: "polish",
    summary:
      "Every Shop card now carries its rarity in the whole card surface, not just a tiny badge. Legendary items get a slow gold light sweep so they catch the eye first.",
    highlights: [
      "Common, rare, epic, and legendary cards tinted top to bottom",
      "Equipped items get a green border and a left accent stripe",
      "Legendary cards run a gold luminance sweep, with reduced-motion respected",
      "Browse grids show a real Equip and Unequip button on every owned item",
    ],
  },
  {
    id: "word-bank-list-redesign",
    date: "2026-06-05",
    title: "Word Bank list now feels like a spreadsheet you actually want to use",
    category: "feature",
    summary:
      "The vocab list at /learn/vocab gained an Excel-vibe dense row layout with inline add, confidence dots you can cycle, and a magnifier lookup per term.",
    highlights: [
      "Inline add row pinned at the top, no modal required",
      "Per-row confidence dot cycles through confident, shaky, struggling, and auto",
      "Magnifier opens a cached translation or definition lookup right next to the row",
      "Filter chips for All, Locked in, Shaky, Struggling, and New across the top",
      "Two-pixel left stripe colored by confidence so the list reads at a glance",
    ],
  },
  {
    id: "faster-lighter-pages",
    date: "2026-06-05",
    title: "Faster, lighter pages",
    category: "polish",
    summary:
      "A bundle audit pass cut weight from the heaviest pages and made our animations more consistent.",
    highlights: [
      "The /learn/vocab bundle dropped roughly thirty percent",
      "Heavy modals and tab views now lazy-load on first open",
      "Duplicate font fetch killed",
      "Confetti is lazy at every site that uses it",
      "Motion is now consistently GPU-only and respects reduced-motion",
    ],
  },
  {
    id: "resume-coach-pro",
    date: "2026-06-04",
    title: "Resume Coach for Pro members",
    category: "feature",
    summary:
      "Upload a resume PDF and Ninny critiques it bullet by bullet, asks Socratic questions, then helps you rewrite it line by line. Markdown export when you are done.",
    highlights: [
      "Pro-tier exclusive, runs on our most efficient model",
      "Reads your strengths and weaknesses out of the PDF",
      "Walks you through a guided rewrite, one bullet at a time",
      "Markdown export of the improved resume bullets",
    ],
  },
  {
    id: "lionade-pardy",
    date: "2026-06-04",
    title: "Lionade-Pardy, our Jeopardy-style game",
    category: "feature",
    summary:
      "Five by five board, three starter decks, server-side answer validation, Fang rewards on every right answer. Multiplayer and Final Pardy coming next.",
    highlights: [
      "Three hand-authored decks: Geography, General Knowledge, AWS Basics",
      "Skip a tile and it counts as attempted, no more soft-locking Final Tally",
      "Server checks the answer so the score you see is the score you got",
      "Multiplayer, Final Pardy, and Word Bank tie-ins on the roadmap",
    ],
  },
  {
    id: "resumable-sessions",
    date: "2026-06-04",
    title: "Refresh the page and pick up where you left off",
    category: "feature",
    summary:
      "Long solo sessions now survive refreshes and tab swaps. Mastery, Daily Drill, Quiz, Blitz, Roardle, and Timeline all save state to the server with a debounced autosave.",
    highlights: [
      "Sticky Resume banner shows what to come back to",
      "Cross-game redirect lands you back in the right surface",
      "Reconnect-on-mount guard catches dropped sessions cleanly",
      "Tab-backgrounded grace period before we mark you AFK",
    ],
  },
];

export function getAllEntries(): ChangelogEntry[] {
  return [...ENTRIES].sort((a, b) => b.date.localeCompare(a.date));
}
