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

  // Reset the whole terminal when the scenario changes (next ticket / re-open).
  useEffect(() => {
    setLines(intro(scenario));
    setInput("");
    setSolved(false);
    setDoneSteps(new Set());
    firedResolve.current = false;
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

  function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    push({ tone: "input", text: `${PROMPT} ${cmd}` });
    const norm = cmd.toLowerCase();

    if (norm === "clear") { setLines(intro(scenario)); return; }
    if (norm === "help") {
      const names = scenario.commands
        .filter((c) => !c.resolvesTicket && c.tone !== "warn")
        .map((c) => c.aliases[0]);
      push(
        { tone: "info", text: "Investigate, then run your fix. Commands you can try:" },
        { tone: "info", text: "  " + names.join("   ·   ") },
        { tone: "sys", text: "  help · hint · clear" },
      );
      return;
    }
    if (norm === "hint") { push({ tone: "info", text: `💡 ${scenario.hint}` }); return; }

    const match = scenario.commands.find((c) =>
      c.aliases.some((a) => norm === a || norm.startsWith(a + " ")),
    );
    if (!match) {
      push({ tone: "error", text: `command not recognized: "${cmd}". type \`help\`` });
      return;
    }

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
            <div key={ev.label}>
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

        <div ref={scrollRef} className="flex-1 min-h-[340px] max-h-[60vh] overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed space-y-0.5">
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
            <span className="font-mono text-[12.5px] text-electric shrink-0">{PROMPT}</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              aria-label="TechHub terminal command input"
              placeholder="type a command…  (try `help`)"
              className="flex-1 bg-transparent font-mono text-[12.5px] text-cream placeholder:text-cream/25 focus:outline-none"
            />
          </form>
        )}
      </div>
    </div>
  );
}
