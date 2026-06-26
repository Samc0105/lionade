// TechHub — shared types for the terminal career simulator.
//
// A "track" is a career path (IT support, SOC, software, red team). Each track
// has a full rank ladder (Intern -> CTO/CISO) shown as a career timeline. Each
// scenario is one ticket the player works in a fake terminal: read the
// evidence, investigate with scripted commands, run the correct fix. Wrong
// fixes teach instead of solving. Harder ranks add red herrings + multi-step
// gating (you must confirm before you act). Everything is deterministic and
// authored, so it costs zero API.

export type Tone = "info" | "warn" | "success";

export type Track = "helpdesk" | "soc" | "swe" | "redteam";

export type Difficulty = "Entry" | "Intermediate" | "Advanced" | "Expert";

export type Priority = "Low" | "Medium" | "High" | "Critical";

export interface SimCommand {
  /** Lowercased inputs that trigger this command (matched exact OR by prefix). */
  aliases: string[];
  /** What the terminal prints back. */
  output: string;
  /** Marks the correct fix. Running it resolves the ticket (if `requires` met). */
  resolvesTicket?: boolean;
  /** Output colour: info (default), warn (a plausible-but-wrong fix), success. */
  tone?: Tone;
  /**
   * Multi-step gating. If set on the resolving command, every key here must
   * have been completed (via a command carrying a matching `step`) before the
   * fix is allowed. Acting early prints a teaching warning instead of solving,
   * so the lesson is "confirm the cause before you pull the trigger".
   */
  requires?: string[];
  /** Running this command marks the named investigation step complete. */
  step?: string;
}

export interface EvidencePanel {
  label: string;
  lines: string[];
}

export interface SimScenario {
  id: string;
  track: Track;
  /** Human rank this ticket belongs to, e.g. "Help Desk Intern". */
  rank: string;
  /** 0-based index into the track's rank ladder. Gates unlock order. */
  rankLevel: number;
  difficulty: Difficulty;
  /** Fangs awarded on resolve (display-only until a server route validates it). */
  reward: number;
  /** XP awarded on resolve (display-only for now). */
  xp: number;
  ticket: {
    from: string;
    subject: string;
    priority: Priority;
    body: string;
  };
  /** The evidence panels (logs / statuses / errors) the player reads. */
  evidence: EvidencePanel[];
  /** One-line statement of what "fixed" means. */
  goal: string;
  /** Revealed by the `hint` command. */
  hint: string;
  /** Shown on resolve. The teaching payload: the "why". */
  successMessage: string;
  commands: SimCommand[];
}

export interface RankDef {
  level: number;
  title: string;
}

export interface TrackDef {
  id: Track;
  name: string;
  tagline: string;
  blurb: string;
  /** Hex accent for the track. */
  color: string;
  /** Phosphor icon name, mapped to a component in the UI layer. */
  icon: string;
  /** Full ladder from intern to the top, shown as a career timeline. */
  ranks: RankDef[];
}
