// What's New highlights + guided tour for TechHub (Idea 43).
//
// Returning players have a lot of new surfaces to find: the Certification Exam,
// the Classroom Challenge, the Knowledge Base, The Board leaderboard, Weak Spots,
// the Placement test, the Cmd or Ctrl K command palette, the seasonal shifts, and
// the Cloud and Network Ops track. This module is the ordered, authored list of
// those headline features plus a small localStorage seen-state, read and saved
// the same calm way as lib/liondesk/coachmarks.ts.
//
// Data only, no JSX: each entry carries an icon NAME (a string), and the panel in
// components/helpdesk/WhatsNew.tsx maps that name to a Phosphor component, exactly
// like components/helpdesk/icons.tsx does for the track cards. That keeps this file
// free of React so it can be read on the server without a hydration cost.
//
// Purely a discovery aid. It grants nothing, blocks nothing, and never touches
// Fangs (the economy stays server authoritative). No forbidden dashes appear in
// any copy or comment below; guidance uses commas, periods, parentheses, or "to".

// Bump this when a new batch of features ships so the panel shows once more to
// everyone. The stored seen version is compared against it, so a higher number
// here re opens the panel one time for returning players.
export const WHATS_NEW_VERSION = 1;

// The set of icon names a highlight may use. A typed union (not a bare string) so
// the panel's name to component map stays exhaustive and a typo fails the build.
export type WhatsNewIcon =
  | "Scroll"
  | "UsersThree"
  | "BookOpen"
  | "ChartBar"
  | "Target"
  | "Compass"
  | "MagnifyingGlass"
  | "CalendarBlank"
  | "Cloud";

export interface WhatsNewEntry {
  /** Stable key for React lists and the seen log. */
  id: string;
  /** Short heading. */
  title: string;
  /** One calm line describing the feature. */
  blurb: string;
  /** Icon name, resolved to a Phosphor component in the panel. */
  icon: WhatsNewIcon;
  /** Deep link into the surface. For on hub features this points at the hub. */
  href: string;
  /** Accent color from the TechHub palette (gold, electric, purple, crimson, cyan). */
  color: string;
  /**
   * True when the feature lives on the hub itself (The Board, the command palette,
   * the seasonal special card). The panel reveals these by simply closing so the
   * player lands back on the hub, rather than pushing a route they are already on.
   */
  onHub?: boolean;
}

// Palette accents, matching the values the hub cards and the command palette use.
const GOLD = "#FFD700";
const ELECTRIC = "#4A90D9";
const PURPLE = "#C9A2F2";
const CYAN = "#22D3EE";

// The ordered headline list. Order is the reading order of the panel and the step
// order of the guided tour, leading with the biggest standalone destinations and
// finishing with the new career track.
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: "exam",
    title: "Certification Exam",
    blurb: "One timed exam across every track. Pass it to earn a shareable certificate. Same form for everyone today.",
    icon: "Scroll",
    href: "/learn/techhub/exam",
    color: GOLD,
  },
  {
    id: "class",
    title: "Classroom Challenge",
    blurb: "Set one fixed shift for your whole class or crew, share the link, and collect everyone's results. No server, no sign up.",
    icon: "UsersThree",
    href: "/learn/techhub/class",
    color: GOLD,
  },
  {
    id: "kb",
    title: "Knowledge Base",
    blurb: "Search every KB article you meet on the desk, grouped by concept. Study between shifts with no clock and no pressure.",
    icon: "BookOpen",
    href: "/learn/techhub/kb",
    color: ELECTRIC,
  },
  {
    id: "board",
    title: "The Board",
    blurb: "A shared leaderboard for the daily and weekly modes, ranked by grade and score, never by Fangs. It sits right here on the hub.",
    icon: "ChartBar",
    href: "/learn/techhub",
    color: PURPLE,
    onHub: true,
  },
  {
    id: "review",
    title: "Weak Spots",
    blurb: "A personal practice mode. Every review pulls more tickets from the concepts you miss most, so you train where it counts.",
    icon: "Target",
    href: "/learn/techhub/review",
    color: PURPLE,
  },
  {
    id: "placement",
    title: "Placement Test",
    blurb: "New here? Answer a few quick questions and we will point you to the right track and difficulty before you climb the ladder.",
    icon: "Compass",
    href: "/learn/techhub/placement",
    color: CYAN,
  },
  {
    id: "palette",
    title: "Quick Nav (Cmd or Ctrl K)",
    blurb: "Press Cmd K on a Mac, or Ctrl K on Windows, to jump straight to any track, mode, or page from anywhere on the hub.",
    icon: "MagnifyingGlass",
    href: "/learn/techhub",
    color: GOLD,
    onHub: true,
  },
  {
    id: "seasonal",
    title: "Seasonal Shifts",
    blurb: "Limited time themed shifts rotate in by the calendar (Patch Tuesday, Black Friday, Breach Week). Clear one for a collectible cosmetic badge.",
    icon: "CalendarBlank",
    href: "/learn/techhub",
    color: GOLD,
    onHub: true,
  },
  {
    id: "netops",
    title: "Cloud and Network Ops",
    blurb: "A brand new career track. Size subnets, chase down a DNS failure, fail over a load balancer, and triage the 2am page that is only a warning.",
    icon: "Cloud",
    href: "/learn/techhub/netops",
    color: CYAN,
  },
];

/* ───────────────────────── seen state (local only) ───────────────────────── */

// Versioned key, the same naming shape as the coachmarks store. We keep the last
// seen panel version so a future WHATS_NEW_VERSION bump re shows the panel exactly
// once, while the same version never nags twice.
const KEY = "lionade.techhub.whatsnew.v1";

interface SeenStore {
  /** The highest WHATS_NEW_VERSION the player has dismissed. 0 means never seen. */
  seenVersion: number;
}

function read(): SeenStore {
  if (typeof window === "undefined") return { seenVersion: 0 };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { seenVersion: 0 };
    const p = JSON.parse(raw);
    const v = p && typeof p === "object" ? p.seenVersion : 0;
    return { seenVersion: typeof v === "number" && v > 0 ? v : 0 };
  } catch {
    return { seenVersion: 0 };
  }
}

function save(s: SeenStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best effort, never block the hub */
  }
}

/** The highest panel version the player has dismissed (0 if never). Client only. */
export function getSeenWhatsNewVersion(): number {
  return read().seenVersion;
}

/**
 * Whether the player has a new panel version to see. True before mount on the
 * server (seenVersion reads as 0), so callers MUST gate this behind a mounted
 * flag to avoid a flash. Client only once mounted.
 */
export function hasUnseenWhatsNew(version: number = WHATS_NEW_VERSION): boolean {
  return getSeenWhatsNewVersion() < version;
}

/**
 * Record the panel as seen up to a version so it does not show again until the
 * next bump. Client only, idempotent, and it never lowers a stored higher version.
 */
export function markWhatsNewSeen(version: number = WHATS_NEW_VERSION): void {
  if (typeof window === "undefined") return;
  const s = read();
  if (s.seenVersion >= version) return;
  s.seenVersion = version;
  save(s);
}

/** Clear the seen state so the What's New panel shows again on the next hub load. */
export function resetWhatsNew(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
