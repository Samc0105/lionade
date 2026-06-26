"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { SCENARIOS, type SimScenario, type Tone } from "@/lib/helpdesk/scenarios";

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

const PROMPT = "helpdesk@LION-SOC:~$";

function intro(s: SimScenario): Line[] {
  return [
    { tone: "sys", text: `Ticket #${1000 + SCENARIOS.indexOf(s)} assigned. Investigate with the terminal, then run the fix.` },
    { tone: "sys", text: "Type `help` for your tools, `hint` if you're stuck." },
  ];
}

export default function HelpDeskSim() {
  const [index, setIndex] = useState(0);
  const [lines, setLines] = useState<Line[]>(() => intro(SCENARIOS[0]));
  const [input, setInput] = useState("");
  const [solved, setSolved] = useState(false);
  const [fangs, setFangs] = useState(0);

  const scenario = SCENARIOS[index];
  const isLast = index === SCENARIOS.length - 1;

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Autoscroll the terminal to the newest line.
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  const push = (...l: Line[]) => setLines((prev) => [...prev, ...l]);

  function run(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    push({ tone: "input", text: `${PROMPT} ${cmd}` });
    const norm = cmd.toLowerCase();

    if (norm === "clear") { setLines(intro(scenario)); return; }
    if (norm === "help") {
      const names = scenario.commands.map((c) => c.aliases[0]);
      push(
        { tone: "info", text: "Tools you can run on this ticket:" },
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
      push({ tone: "error", text: `command not recognized: "${cmd}" — type \`help\`` });
      return;
    }

    const tone: Tone = match.tone ?? "info";
    match.output.split("\n").forEach((t) => push({ tone, text: t }));

    if (match.resolvesTicket) {
      setSolved(true);
      setFangs((f) => f + scenario.reward);
      push(
        { tone: "sys", text: "" },
        { tone: "success", text: `✅ TICKET RESOLVED  ·  +${scenario.reward} Fangs` },
        { tone: "info", text: scenario.successMessage },
      );
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (solved) return;
    run(input);
    setInput("");
  }

  function nextTicket() {
    const ni = index + 1;
    setIndex(ni);
    setLines(intro(SCENARIOS[ni]));
    setSolved(false);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const priorityColor = useMemo(
    () => ({ High: "#EF4444", Medium: "#F59E0B", Low: "#4A90D9" }[scenario.ticket.priority]),
    [scenario.ticket.priority],
  );

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
        <p className="text-cream/80 text-sm leading-relaxed mt-3 italic">“{scenario.ticket.body}”</p>

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
          <span className="ml-2 font-mono text-[11px] text-cream/45">terminal — {PROMPT}</span>
          <span className="ml-auto font-mono text-[11px] text-gold/80">{fangs} Fangs this session</span>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-[340px] max-h-[60vh] overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed space-y-0.5">
          {lines.map((l, i) => (
            <div key={i} className={`${TONE_CLASS[l.tone]} whitespace-pre-wrap`}>{l.text || " "}</div>
          ))}
        </div>

        {solved ? (
          <div className="border-t border-white/[0.06] p-3">
            {isLast ? (
              <p className="text-center font-bebas text-lg text-[#2BBE6B] tracking-wide">Queue clear. Nice shift. 🎉</p>
            ) : (
              <button
                onClick={nextTicket}
                className="w-full min-h-[44px] rounded-xl font-bold text-sm text-[#04080F] transition-transform active:scale-[0.99]"
                style={{ background: "linear-gradient(135deg,#FFD700,#FFA500)" }}
              >
                Resolve &amp; pull next ticket →
              </button>
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
              aria-label="Help desk terminal command input"
              placeholder="type a command…  (try `help`)"
              className="flex-1 bg-transparent font-mono text-[12.5px] text-cream placeholder:text-cream/25 focus:outline-none"
            />
          </form>
        )}
      </div>
    </div>
  );
}
