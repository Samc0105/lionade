"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { SimScenario, SimCommand, Tone } from "@/lib/helpdesk/types";

type LineTone = "sys" | "input" | "info" | "warn" | "success" | "error";
interface Line { tone: LineTone; text: string }

const TONE_CLASS: Record<LineTone, string> = {
  sys: "text-cream/40",
  input: "text-electric",
  info: "text-cream/85",
  warn: "text-amber-400",
  success: "text-[#2BBE6B] font-semibold",
  error: "text-red-400",
};

const PRIORITY_COLOR: Record<string, string> = {
  Critical: "#EF4444",
  High: "#EF4444",
  Medium: "#F59E0B",
  Low: "#4A90D9",
};

const PROMPT = "techhub@LION-LAB:~$";

function intro(s: SimScenario): Line[] {
  return [
    { tone: "sys", text: `Ticket assigned: ${s.rank} queue. Investigate with the terminal, then run the fix.` },
    { tone: "sys", text: "Type `help` for your tools, `hint` if you're stuck." },
  ];
}

/** Unique investigation steps this ticket gates its fix behind. */
function stepKeys(s: SimScenario): string[] {
  const keys = new Set<string>();
  for (const c of s.commands) if (c.step) keys.add(c.step);
  return Array.from(keys);
}

/**
 * Canonicalize a typed command: lowercase, collapse every run of
 * non-alphanumerics to a single space, trim. This makes matching forgiving of
 * punctuation and spacing, so "clear-queue", "Clear  Queue" and "clear queue"
 * are all the same command. Real players type the dash; don't wall them off.
 */
function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True if `a` is an ordered subsequence of `b` (they typed a shorthand). */
function isSubseq(a: string, b: string): boolean {
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) if (a[i] === b[j]) i += 1;
  return i === a.length;
}

/** Levenshtein edit distance. Strings + command set are tiny, so DP is fine. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

/**
 * Best "did you mean" for an unrecognized command, or null if nothing's close.
 * Ranks prefix matches first ("print" -> "printer status"), then shorthands
 * ("cancel 7" -> "cancel job 7" as a subsequence), then near-typos within a
 * length-scaled edit budget. `pool` is display strings; comparison is on canon.
 */
function suggestFor(nc: string, pool: string[]): string | null {
  let best: string | null = null;
  let bestRank = Infinity;
  for (const cand of pool) {
    const cc = canon(cand);
    if (cc === nc) continue; // an exact match would have been recognized already
    let rank: number;
    if (cc.startsWith(nc) || nc.startsWith(cc)) rank = 0;
    else if (isSubseq(nc, cc)) rank = 1;
    else {
      const d = editDistance(nc, cc);
      rank = d <= Math.max(2, Math.floor(cc.length / 3)) ? 1 + d / 100 : Infinity;
    }
    if (rank < bestRank) {
      bestRank = rank;
      best = cand;
    }
  }
  return bestRank < Infinity ? best : null;
}

interface HelpDeskSimProps {
  scenario: SimScenario;
  /** Already cleared in a prior session (lets us show the resolved state up front). */
  alreadyCleared?: boolean;
  /** Fired once, the moment the ticket is resolved this session. */
  onResolved?: (scenario: SimScenario) => void;
  /** If provided, a "next ticket" button shows on resolve. */
  onNext?: () => void;
  nextLabel?: string;
}

export default function HelpDeskSim({
  scenario,
  alreadyCleared = false,
  onResolved,
  onNext,
  nextLabel = "Next ticket →",
}: HelpDeskSimProps) {
  const [lines, setLines] = useState<Line[]>(() => intro(scenario));
  const [input, setInput] = useState("");
  const [solved, setSolved] = useState(false);
  const [doneSteps, setDoneSteps] = useState<Set<string>>(() => new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firedResolve = useRef(false);

  const allSteps = useMemo(() => stepKeys(scenario), [scenario]);

  // Consecutive unrecognized commands for THIS ticket. Drives escalating help
  // so no one dead-ends in the terminal; any recognized command resets it.
  const missStreak = useRef(0);

  // Flat pool of every accepted command (+ built-ins) for "did you mean".
  const suggestPool = useMemo<string[]>(() => {
    const pool = ["help", "hint", "clear"];
    for (const c of scenario.commands) for (const a of c.aliases) pool.push(a);
    return pool;
  }, [scenario]);

  // Reset the whole terminal when the scenario changes (next ticket / re-open).
  useEffect(() => {
    setLines(intro(scenario));
    setInput("");
    setSolved(false);
    setDoneSteps(new Set());
    firedResolve.current = false;
    missStreak.current = 0;
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [scenario]);

  // Autoscroll to the newest line.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const push = (...l: Line[]) => setLines((prev) => [...prev, ...l]);

  function resolveNow(match: SimCommand) {
    const tone: Tone = match.tone ?? "success";
    match.output.split("\n").forEach((t) => push({ tone, text: t }));
    push(
      { tone: "sys", text: "" },
      { tone: "success", text: `✅ TICKET RESOLVED  ·  +${scenario.reward} Fangs  ·  +${scenario.xp} XP` },
      { tone: "info", text: scenario.successMessage },
    );
    setSolved(true);
    if (!firedResolve.current) {
      firedResolve.current = true;
      onResolved?.(scenario);
    }
  }

  // Escalating rescue: reveal the exact next command(s) so a stuck player can
  // always progress. If the fix's prerequisites are already confirmed, hand
  // over the fix itself; otherwise reveal the investigation commands that
  // unlock it. Nobody should have to guess their way out of a dead end.
  function revealPath() {
    const fix = scenario.commands.find((c) => c.resolvesTicket);
    const needed = (fix?.requires ?? []).filter((r) => !doneSteps.has(r));
    if (fix && needed.length === 0) {
      push(
        { tone: "warn", text: "Let's get you moving. You've dug in enough. Here's the fix:" },
        { tone: "info", text: `  ${fix.aliases[0]}` },
      );
      return;
    }
    const investigate = scenario.commands
      .filter((c) => c.step && !c.resolvesTicket && needed.includes(c.step!))
      .map((c) => c.aliases[0]);
    const list =
      investigate.length > 0
        ? investigate
        : scenario.commands.filter((c) => !c.resolvesTicket && c.tone !== "warn").map((c) => c.aliases[0]);
    push(
      { tone: "warn", text: "Let's get you moving. Run these to see what's happening, then the fix unlocks:" },
      { tone: "info", text: "  " + Array.from(new Set(list)).join("   ·   ") },
    );
  }

  function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    push({ tone: "input", text: `${PROMPT} ${cmd}` });
    // Canonicalize punctuation + spacing so "clear-queue" == "clear queue" and
    // a stray dash never walls a player off from a command they clearly meant.
    const nc = canon(cmd);

    if (nc === "clear") { setLines(intro(scenario)); missStreak.current = 0; return; }
    if (nc === "help") {
      const names = scenario.commands
        .filter((c) => !c.resolvesTicket && c.tone !== "warn")
        .map((c) => c.aliases[0]);
      push(
        { tone: "info", text: "Investigate, then run your fix. Commands you can try:" },
        { tone: "info", text: "  " + names.join("   ·   ") },
        { tone: "sys", text: "  help · hint · clear" },
      );
      missStreak.current = 0;
      return;
    }
    if (nc === "hint") { push({ tone: "info", text: `💡 ${scenario.hint}` }); missStreak.current = 0; return; }

    // Two-pass matching. An EXACT alias match anywhere in the command list
    // always wins before any prefix match — otherwise a later command's exact
    // alias (e.g. the "rollback migration" rookie trap) gets captured by an
    // earlier command's shorter prefix alias ("rollback"), making traps and
    // steps unreachable (and in one scenario, paying out a resolve for the
    // trap). Within the prefix pass the LONGEST matching alias wins, so
    // "inspect order 8844 --verbose" routes to "inspect order 8844", not
    // "inspect order".
    let match: SimCommand | undefined;
    for (const c of scenario.commands) {
      if (c.aliases.some((a) => canon(a) === nc)) {
        match = c;
        break;
      }
    }
    if (!match) {
      let bestLen = -1;
      for (const c of scenario.commands) {
        for (const a of c.aliases) {
          const ca = canon(a);
          if (nc.startsWith(ca + " ") && ca.length > bestLen) {
            bestLen = ca.length;
            match = c;
          }
        }
      }
    }
    if (!match) {
      missStreak.current += 1;
      const guess = suggestFor(nc, suggestPool);
      push({
        tone: "error",
        text: `command not recognized: "${cmd}".${guess ? ` did you mean \`${guess}\`?` : " type \`help\`"}`,
      });
      // No dead ends: a gentle hint at 2 misses, then reveal the real next
      // command at 4 and every couple after, so nobody stays stuck.
      if (missStreak.current === 2) {
        push({ tone: "info", text: `💡 Stuck? ${scenario.hint}` });
      } else if (missStreak.current >= 4 && missStreak.current % 2 === 0) {
        revealPath();
      }
      return;
    }
    missStreak.current = 0;

    // Mark investigation step complete (a command can be both a step and a fix-blocker).
    if (match.step && !doneSteps.has(match.step)) {
      setDoneSteps((prev) => new Set(prev).add(match.step!));
    }

    // Gated fix: block the resolve until the required steps are confirmed.
    if (match.resolvesTicket && match.requires && match.requires.length > 0) {
      const missing = match.requires.filter((r) => !doneSteps.has(r));
      if (missing.length > 0) {
        push(
          { tone: "warn", text: "⚠ Hold on. You're trying to fix this before you've confirmed what's actually happening." },
          { tone: "warn", text: "  Investigate first (check the status and the logs), then apply the fix. Acting blind is how real outages get worse." },
        );
        return;
      }
    }

    if (match.resolvesTicket) { resolveNow(match); return; }

    const tone: Tone = match.tone ?? "info";
    match.output.split("\n").forEach((t) => push({ tone, text: t }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (solved) return;
    run(input);
    setInput("");
  }

  const priorityColor = PRIORITY_COLOR[scenario.ticket.priority] ?? "#4A90D9";
  // Cleared tickets stay replayable: `alreadyCleared` only surfaces a note, it
  // does not lock the terminal. Only an in-session solve ends the round.
  const isDone = solved;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ── LEFT: the ticket + evidence ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40">Active ticket</span>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
            style={{ color: priorityColor, background: `${priorityColor}1f`, border: `1px solid ${priorityColor}40` }}
          >
            {scenario.ticket.priority} · {scenario.difficulty}
          </span>
        </div>
        <h2 className="font-bebas text-2xl text-cream tracking-wide leading-tight">{scenario.ticket.subject}</h2>
        <p className="text-cream/50 text-xs mt-0.5">From {scenario.ticket.from}</p>
        <p className="text-cream/80 text-sm leading-relaxed mt-3 italic">&ldquo;{scenario.ticket.body}&rdquo;</p>

        <div className="mt-5 space-y-3">
          {scenario.evidence.map((ev) => (
            <div key={ev.label} role="group" aria-label={`Evidence, ${ev.label}`}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-electric/70 mb-1.5">{ev.label}</p>
              <pre className="text-[11px] leading-relaxed text-cream/70 font-mono bg-black/30 border border-white/[0.06] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
{ev.lines.join("\n")}
              </pre>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-gold/20 bg-gold/[0.05] p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/80 mb-1">Goal</p>
          <p className="text-cream/75 text-xs leading-relaxed">{scenario.goal}</p>
        </div>
      </div>

      {/* ── RIGHT: the terminal ── */}
      <div className="rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col bg-[#05080f]">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
          <span className="ml-2 font-mono text-[11px] text-cream/45 truncate">terminal</span>
          {allSteps.length > 0 && !isDone && (
            <span className="ml-auto font-mono text-[10px] text-cream/45">
              confirmed {Array.from(doneSteps).filter((s) => allSteps.includes(s)).length}/{allSteps.length}
            </span>
          )}
          <span className={`font-mono text-[11px] text-gold/80 ${allSteps.length > 0 && !isDone ? "ml-3" : "ml-auto"}`}>
            {scenario.reward} Fangs
          </span>
        </div>

        <div ref={scrollRef} role="log" aria-live="polite" aria-label="Terminal output" className="flex-1 min-h-[340px] max-h-[60vh] overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed space-y-0.5">
          {lines.map((l, i) => (
            <div key={i} className={`${TONE_CLASS[l.tone]} whitespace-pre-wrap`}>{l.text || " "}</div>
          ))}
          {alreadyCleared && !solved && (
            <div className="text-[#2BBE6B] mt-2">✓ You already cleared this ticket. Replay it any time to sharpen up.</div>
          )}
        </div>

        {isDone ? (
          <div className="border-t border-white/[0.06] p-3">
            {onNext ? (
              <button
                onClick={onNext}
                className="w-full min-h-[44px] rounded-xl font-bold text-sm text-[#04080F] transition-transform active:scale-[0.99]"
                style={{ background: "linear-gradient(135deg,#FFD700,#FFA500)" }}
              >
                {nextLabel}
              </button>
            ) : (
              <p className="text-center font-bebas text-lg text-[#2BBE6B] tracking-wide">Resolved. Nice work. 🎉</p>
            )}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-white/[0.06] px-4 py-3">
            <span className="font-mono text-[12.5px] text-electric shrink-0" aria-hidden="true">{PROMPT}</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              aria-label="TechHub terminal command input"
              placeholder="type a command…  (try `help`)"
              className="flex-1 bg-transparent font-mono text-[12.5px] text-cream placeholder:text-cream/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 rounded-sm"
            />
          </form>
        )}
      </div>
    </div>
  );
}
