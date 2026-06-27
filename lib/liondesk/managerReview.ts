// End-of-shift manager debrief. Each career track has a standing boss who reads
// your shift back to you in their own voice, reacting to the grade, SLA
// breaches, and anything you mishandled. Fully deterministic (seeded off the
// shift id) and zero-API, so the same run always gets the same note while
// different shifts in the same tier read differently.

export interface Manager { name: string; role: string; initial: string; accent: string }
export interface ManagerReview extends Manager { verdict: string; tone: "great" | "good" | "ok" | "poor" }

const MANAGERS: Record<string, Manager> = {
  helpdesk: { name: "Dana Whitfield", role: "Support Lead", initial: "D", accent: "#4A90D9" },
  soc: { name: "Marcus Reyes", role: "SOC Manager", initial: "M", accent: "#2BBE6B" },
  swe: { name: "Priya Nair", role: "Engineering Manager", initial: "P", accent: "#A855F7" },
  redteam: { name: "Vic Calloway", role: "Engagement Lead", initial: "V", accent: "#EF4444" },
};
const FALLBACK: Manager = { name: "Shift Supervisor", role: "Operations", initial: "S", accent: "#94A3B8" };

// Voice differs by tier. Pick one opener deterministically per shift so a given
// run always reads the same, but neighbouring shifts vary.
const OPENERS: Record<ManagerReview["tone"], string[]> = {
  great: [
    "That is exactly the shift I want to see.",
    "Textbook. The whole floor should run a shift like that.",
    "Nothing slipped, nothing burned. Clean work.",
  ],
  good: [
    "Solid shift. You handled the queue and kept people calm.",
    "Good work out there. A couple of rough edges, nothing serious.",
    "I can leave you on the desk without watching. That counts for a lot.",
  ],
  ok: [
    "You got through it, but it was closer than it needed to be.",
    "Passable. We kept the lights on, just not gracefully.",
    "It worked out, though I want tighter calls next time.",
  ],
  poor: [
    "We need to talk about this one.",
    "That shift cost us. Let us reset before the next one.",
    "Rough night. I have seen worse, but not by much.",
  ],
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface ReviewInput {
  track: string;
  shiftId: string;
  grade: string;
  resolved: number;
  total: number;
  breaches: number;
  fumbles: number;
}

export function managerReviewFor(o: ReviewInput): ManagerReview {
  const mgr = MANAGERS[o.track] ?? FALLBACK;
  const passing = !["D", "F"].includes(o.grade);
  const tone: ManagerReview["tone"] = !passing
    ? "poor"
    : (o.grade === "S" || o.grade === "A") && o.breaches === 0 && o.fumbles === 0
      ? "great"
      : o.fumbles <= 1 && o.breaches <= 1 && (o.grade === "A" || o.grade === "B")
        ? "good"
        : "ok";

  const openers = OPENERS[tone];
  const opener = openers[hash(o.shiftId) % openers.length];

  // Specific clauses layered on top of the tier opener.
  const clauses: string[] = [];
  if (o.total > 0 && o.resolved === o.total && o.fumbles === 0) {
    clauses.push("Every ticket closed clean.");
  } else if (o.resolved < o.total) {
    const left = o.total - o.resolved;
    clauses.push(`${left} ticket${left === 1 ? "" : "s"} we never got to.`);
  }
  if (o.fumbles > 0) {
    clauses.push(`${o.fumbles} call${o.fumbles === 1 ? "" : "s"} went the wrong way. Walk me through your thinking on those.`);
  }
  if (o.breaches > 0) {
    clauses.push(`${o.breaches} SLA breach${o.breaches === 1 ? "" : "es"}. Hit the high-priority queue first next time.`);
  }
  if (tone === "great") {
    clauses.push("Keep this up and we are talking about your next title.");
  }

  return { ...mgr, tone, verdict: [opener, ...clauses].join(" ") };
}
