// Placement test (Idea 40). A quick, self contained, mixed concept quiz that
// recommends a starting career track and a starting difficulty for newcomers,
// so a first time player is not left guessing where to begin. Each question
// leans toward one track (the kind of work that track does), and the track the
// player answers best on becomes the recommendation. Overall accuracy maps to a
// starting difficulty.
//
// Authored and deterministic (zero API). Client only and display only: the
// result is a guide, not a gate, and nothing here grants Fangs. The economy
// stays server authoritative, so any Fangs are only ever granted server side
// once a real solve is validated. No dashes in any user facing copy below.

import type { Track, Difficulty } from "@/lib/helpdesk/types";
import { TRACKS } from "@/lib/helpdesk/tracks";

export interface PlacementOption {
  id: string;
  label: string;
  /** The genuinely correct choice. Exactly one option per question is correct. */
  correct?: boolean;
}

export interface PlacementQuestion {
  id: string;
  /** The career track this question leans toward (weights the recommendation). */
  track: Track;
  /** A short human concept label for the question (display only, grouping). */
  concept: string;
  /** The question stem. */
  prompt: string;
  /** One scene setting line shown under the prompt. */
  context: string;
  options: PlacementOption[];
  /** The teaching line revealed once the player answers (the why). */
  teach: string;
}

// Schema version, bumped if the question set or result shape ever changes, so a
// stale localStorage payload is ignored rather than mis read.
export const PLACEMENT_VERSION = 1;

const KEY = "lionade.techhub.placement.v1";

// Two questions per track, so every track is weighted equally and the raw
// correct count per track is a fair comparison. The correct option sits in a
// different position from question to question so it is never telegraphed.
export const PLACEMENT_QUESTIONS: PlacementQuestion[] = [
  {
    id: "q-lockout",
    track: "helpdesk",
    concept: "Account access",
    prompt: "A user is locked out after too many password attempts. What is the safest first step?",
    context: "It is the most common call on any help desk.",
    options: [
      { id: "a", label: "Reset the domain admin password." },
      { id: "b", label: "Verify their identity, then unlock the account.", correct: true },
      { id: "c", label: "Tell them to wait a day for the lock to clear." },
      { id: "d", label: "Turn off their second factor." },
    ],
    teach: "Confirm who you are talking to first, then unlock. An identity check before any account change keeps the desk safe.",
  },
  {
    id: "q-incident",
    track: "helpdesk",
    concept: "Incident triage",
    prompt: "Twenty tickets land in five minutes, all about the same app being down. What is the smart move?",
    context: "Triage is the heart of a busy desk.",
    options: [
      { id: "a", label: "Treat it as one incident and find the root cause.", correct: true },
      { id: "b", label: "Work all twenty tickets one by one." },
      { id: "c", label: "Close them as duplicates and move on." },
      { id: "d", label: "Reboot every laptop in the office." },
    ],
    teach: "A flood of identical tickets is one incident. Fix the root cause once and the rest clear together.",
  },
  {
    id: "q-phishing",
    track: "soc",
    concept: "Phishing and email",
    prompt: "An email from a lookalike domain says verify your password now. What do you do?",
    context: "Cybersecurity work starts with reading email like an analyst.",
    options: [
      { id: "a", label: "Report it as phishing and do not click.", correct: true },
      { id: "b", label: "Click the link to see if it is real." },
      { id: "c", label: "Reply and ask the sender to confirm." },
      { id: "d", label: "Forward it to everyone as a warning." },
    ],
    teach: "Report it and do not click. A lookalike domain plus an urgent password request is the classic phishing pattern.",
  },
  {
    id: "q-mfa",
    track: "soc",
    concept: "Credential hygiene",
    prompt: "A user reuses one password everywhere and has no second factor. What helps most?",
    context: "Account security is the analyst's bread and butter.",
    options: [
      { id: "a", label: "Make the password a little longer." },
      { id: "b", label: "Write it on a sticky note so it is not forgotten." },
      { id: "c", label: "Turn on multi factor authentication.", correct: true },
      { id: "d", label: "Share the login with a backup person." },
    ],
    teach: "Multi factor is the single biggest win. Even a stolen password fails without the second factor.",
  },
  {
    id: "q-stacktrace",
    track: "swe",
    concept: "Debugging",
    prompt: "Your app starts returning 500 errors right after a deploy. Where do you look first?",
    context: "Every software engineer lives in the logs.",
    options: [
      { id: "a", label: "Refresh your browser and move on." },
      { id: "b", label: "Roll back the database." },
      { id: "c", label: "Read the server logs and the stack trace.", correct: true },
      { id: "d", label: "Check the DNS records." },
    ],
    teach: "Read the stack trace first. A 500 is a server side error, and the log points straight at the failing line.",
  },
  {
    id: "q-rollback",
    track: "swe",
    concept: "Production incidents",
    prompt: "A deploy you shipped is breaking production right now. What is the fastest safe move?",
    context: "Shipping means owning the rollback too.",
    options: [
      { id: "a", label: "Push another quick fix and hope it holds." },
      { id: "b", label: "Wait for the morning standup." },
      { id: "c", label: "Email users to clear their cache." },
      { id: "d", label: "Roll back to the last known good build.", correct: true },
    ],
    teach: "Roll back first to stop the bleeding, then debug the bad build calmly off the critical path.",
  },
  {
    id: "q-dns",
    track: "netops",
    concept: "DNS and connectivity",
    prompt: "A site will not load by name, but it loads fine by its IP address. What is the likely cause?",
    context: "Cloud and network ops chase these all day.",
    options: [
      { id: "a", label: "A failed power supply." },
      { id: "b", label: "A DNS resolution problem.", correct: true },
      { id: "c", label: "A cracked laptop screen." },
      { id: "d", label: "An expired software license." },
    ],
    teach: "If the IP loads but the name does not, name resolution (DNS) is the first thing to check.",
  },
  {
    id: "q-leastpriv",
    track: "netops",
    concept: "Least privilege",
    prompt: "A new hire asks for full admin access to be safe. What do you grant?",
    context: "Cloud roles live and die by least privilege.",
    options: [
      { id: "a", label: "Full admin, it is easier." },
      { id: "b", label: "Only the access their role needs.", correct: true },
      { id: "c", label: "The same access the CEO has." },
      { id: "d", label: "Nothing, let them sort it out." },
    ],
    teach: "Least privilege. Grant exactly what the role needs, and widen access only when it is justified.",
  },
  {
    id: "q-scope",
    track: "redteam",
    concept: "Scope and authorization",
    prompt: "During an authorized test you notice another company's server in range. What now?",
    context: "Ethical hacking is defined by its rules.",
    options: [
      { id: "a", label: "Exploit it before anyone notices." },
      { id: "b", label: "Ignore the rules, you already have access." },
      { id: "c", label: "Delete the logs to stay hidden." },
      { id: "d", label: "Stop and confirm it is in scope first.", correct: true },
    ],
    teach: "Scope is everything in ethical hacking. Out of scope means hands off until it is authorized in writing.",
  },
  {
    id: "q-report",
    track: "redteam",
    concept: "Reporting",
    prompt: "You found a real vulnerability on an authorized engagement. What is the deliverable that matters?",
    context: "A pentest is only useful if it lands as a fix.",
    options: [
      { id: "a", label: "A clear report with the fix and steps to reproduce.", correct: true },
      { id: "b", label: "A screenshot posted publicly." },
      { id: "c", label: "Proof you got in, with no detail." },
      { id: "d", label: "Nothing, they will find it eventually." },
    ],
    teach: "Offense serves defense. A reproducible report with a remediation path is what actually makes them safer.",
  },
];

/** A map of question id to the option id the player chose. */
export type PlacementAnswers = Record<string, string>;

export interface PlacementTrackScore {
  track: Track;
  /** Track display name, denormalized so result surfaces need no second lookup. */
  name: string;
  correct: number;
  total: number;
}

export interface PlacementResult {
  /** Schema version of the stored payload. */
  v: number;
  /** Recommended starting track id (always a real track, deep linkable). */
  track: Track;
  /** Recommended starting difficulty (advisory copy, not a hard gate). */
  difficulty: Difficulty;
  /** Total correct answers. */
  correct: number;
  /** Total questions on the form. */
  total: number;
  /** Per track correct counts, in display order, for the breakdown UI. */
  byTrack: PlacementTrackScore[];
  /** ISO day key (YYYY-MM-DD) when taken, display only. */
  dateIso: string;
}

// Overall accuracy to a starting difficulty. A newcomer who misses most of the
// quiz starts at Entry with no clock pressure; a confident player who aces it is
// pointed higher. Advisory only, it gates nothing.
function difficultyForRatio(ratio: number): Difficulty {
  if (ratio < 0.3) return "Entry";
  if (ratio < 0.6) return "Intermediate";
  if (ratio < 0.85) return "Advanced";
  return "Expert";
}

const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  Entry: "Start at the first rank and learn the desk one ticket at a time. No clock pressure to begin with.",
  Intermediate: "You have the basics down. Jump in and you should clear the early ranks quickly.",
  Advanced: "Strong fundamentals. Push for high grades and try the harder mutators sooner.",
  Expert: "You clearly know your stuff. Aim for the certification exam and the brutal daily chaos runs.",
};

/** Advisory copy for a recommended difficulty. Display only. */
export function difficultyBlurb(d: Difficulty): string {
  return DIFFICULTY_BLURB[d];
}

/**
 * Pure scoring: fold a set of answers into a recommended track and difficulty.
 * Tallies correct answers per track (seeded with every track in display order so
 * the breakdown always lists all five). The recommended track is the one with the
 * most correct answers, ties breaking toward the display order (helpdesk first),
 * which is also the most newcomer friendly entry, so a player who gets nothing
 * right is still pointed at IT Support to start. Deterministic and side effect
 * free, safe to call after mount. Grants nothing.
 */
export function scorePlacement(answers: PlacementAnswers, when: Date = new Date()): PlacementResult {
  const byTrack: PlacementTrackScore[] = TRACKS.map((t) => ({ track: t.id, name: t.name, correct: 0, total: 0 }));

  let correct = 0;
  for (const q of PLACEMENT_QUESTIONS) {
    const slot = byTrack.find((b) => b.track === q.track);
    if (!slot) continue;
    slot.total += 1;
    const picked = q.options.find((o) => o.id === answers[q.id]);
    if (picked?.correct) {
      slot.correct += 1;
      correct += 1;
    }
  }

  const total = PLACEMENT_QUESTIONS.length;

  // argmax over the correct counts; the first track in display order wins ties.
  let best = byTrack[0];
  for (const b of byTrack) {
    if (b.correct > best.correct) best = b;
  }

  return {
    v: PLACEMENT_VERSION,
    track: best.track,
    difficulty: difficultyForRatio(total > 0 ? correct / total : 0),
    correct,
    total,
    byTrack,
    dateIso: when.toISOString().slice(0, 10),
  };
}

/* ───────────────────────── persistence (client only, display only) ─────────────────────────
   The player's last placement result, kept locally so the home nudge can hide
   itself once the test is taken and the result can be reopened or retaken. Same
   robust read / save shape as lib/liondesk/conceptMastery.ts and exam.ts. Grants
   nothing; the economy stays server authoritative. */

export function getPlacementResult(): PlacementResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p === "object" && (p as PlacementResult).v === PLACEMENT_VERSION) return p as PlacementResult;
    return null;
  } catch {
    return null;
  }
}

/** Persist a placement result, overwriting any previous one. No op on the server. */
export function savePlacementResult(r: PlacementResult): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

/** Whether the player has taken the placement test at least once. Client only. */
export function hasTakenPlacement(): boolean {
  return getPlacementResult() !== null;
}

/** Clear the stored placement result (used when a player chooses to start over). */
export function clearPlacementResult(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}
