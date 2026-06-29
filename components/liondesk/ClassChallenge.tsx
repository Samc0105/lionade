"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UsersThree, LinkSimple, Copy, Lightning, ArrowsClockwise, Trophy, GraduationCap, ListChecks } from "@phosphor-icons/react";
import LionDesk from "@/components/liondesk/LionDesk";
import AchievementBanner from "@/components/liondesk/AchievementBanner";
import { generateShift, MODIFIERS } from "@/lib/liondesk/generate";
import { decodeCombo, encodeCombo, type ComboData } from "@/lib/liondesk/combocode";
import { recordShiftResult } from "@/lib/liondesk/stats";
import { recordShiftConcepts } from "@/lib/liondesk/conceptMastery";
import { recordPlayDay } from "@/lib/liondesk/playstreak";
import type { Shift } from "@/lib/liondesk/types";
import type { State, ShiftResult } from "@/lib/liondesk/engine";
import type { Track } from "@/lib/helpdesk/types";

// Idea 33: Team / classroom challenge mode.
//
// A teacher builds one shift (track, size, mutators) and gets a link that fixes
// that exact shift behind a seed. Every student who opens it plays the identical
// queue, in the same order, with the same mutators. When a student finishes they
// get a short result code (and a matching results link) carrying their name,
// score, and grade, which they send back to the teacher. The teacher pastes those
// codes into the collector below and sees a ranked table. There is no server: the
// whole thing rides on the shareable seed code (combocode.ts), so it grants no
// Fangs and stores nothing remotely. The economy stays server-authoritative.
//
// Two views, chosen from the URL:
//   ?code=<class code>  -> student play view (the exact shift, then a send card)
//   no code             -> teacher view (build a link + collect results)
// An optional ?result=<code> prefills the collector from a student's results link.

type TrackSel = Track | "any";
const TRACK_OPTS: { id: TrackSel; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "helpdesk", label: "IT" },
  { id: "soc", label: "SOC" },
  { id: "swe", label: "SWE" },
  { id: "redteam", label: "Red Team" },
  { id: "netops", label: "NetOps" },
];

// Same grade to color mapping the shift report and the beat my desk card use, so a
// grade reads the same everywhere on the desk.
function gradeColor(g: string): string {
  return g === "S" || g === "A" ? "#2BBE6B" : g === "B" ? "#4A90D9" : g === "C" ? "#F59E0B" : "#EF4444";
}

// Gold, silver, bronze for the top three rows of the ranking; everyone else reads
// in plain cream.
const RANK_TINT = ["#FFD700", "#C9CCD6", "#CD7F32"];

// Pull a combo code out of whatever a student pasted: a full link with a code,
// result, seed, or combo query param, or a bare code on its own.
function extractCode(token: string): string {
  const t = token.trim();
  if (!t) return "";
  const m = /[?&](?:result|code|seed|combo)=([^&\s]+)/.exec(t);
  if (m) return m[1];
  return t;
}

export default function ClassChallenge({ code, prefillResult }: { code?: string; prefillResult?: string }) {
  // window, localStorage, and the random seed are all client only. Read after
  // mount so nothing flashes or mismatches during hydration.
  const [mounted, setMounted] = useState(false);

  // The class challenge this link points to, if any. A result code (one carrying a
  // vs score) is for the collector, not for playing, so it never opens the play
  // view. Decoded from the URL, so there is no stored value to flash.
  const challenge = useMemo<ComboData | null>(() => {
    if (!code) return null;
    const c = decodeCombo(code);
    if (!c || c.vs) return null;
    return c;
  }, [code]);

  /* ── student play state ── */
  const [shift, setShift] = useState<Shift | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [newAch, setNewAch] = useState<string[]>([]);
  const [result, setResult] = useState<ShiftResult | null>(null);
  const [studentName, setStudentName] = useState("");
  const [resultCopied, setResultCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // The student can close the end of shift report (its Back button is wired to
  // onExit below). Closing it unmounts the desk, which releases the report's
  // focus trap, but keeps `result` set so the send card stays on screen and
  // becomes reachable. The ref lets us move focus there on dismiss.
  const [reportDismissed, setReportDismissed] = useState(false);
  const sendCardRef = useRef<HTMLDivElement>(null);

  /* ── teacher build state ── */
  const [track, setTrack] = useState<TrackSel>("any");
  const [count, setCount] = useState(6);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [seed, setSeed] = useState<number | null>(null);
  const [classCopied, setClassCopied] = useState(false);

  /* ── teacher collect state ── */
  const [pasted, setPasted] = useState("");

  useEffect(() => {
    setMounted(true);
    setSeed(Math.floor(Math.random() * 1e9) >>> 0);
  }, []);

  // Prefill the collector from a student's results link, once, without clobbering
  // anything the teacher has already pasted.
  useEffect(() => {
    if (prefillResult) setPasted((p) => (p.trim() ? p : prefillResult));
  }, [prefillResult]);

  // Build the student's exact shift from the seeded class code: explicit mutators
  // plus a fixed seed make the queue identical for everyone (the same path a
  // hand picked shared seed takes in PlayGeneratedShift). Generated after mount so
  // the RNG never runs during SSR.
  useEffect(() => {
    if (!mounted || !challenge) {
      setShift(null);
      return;
    }
    setShift(
      generateShift({
        seed: challenge.seed,
        track: challenge.track,
        count: challenge.count,
        modifierIds: challenge.modifierIds,
        name: challenge.label || "Class Challenge",
      }),
    );
    setResult(null);
    setNewAch([]);
    setReportDismissed(false);
  }, [mounted, challenge]);

  // When the student closes the report, the focus trapped dialog unmounts with
  // the desk and focus would otherwise fall to the body. Move it to the still
  // rendered send card so a keyboard or screen reader student lands on their
  // result and can copy it. Guarded by reportDismissed plus a present result, so
  // it only fires on an actual dismiss.
  useEffect(() => {
    if (reportDismissed && result) sendCardRef.current?.focus();
  }, [reportDismissed, result]);

  const trackOpt = (): Track | undefined => (track === "any" ? undefined : track);

  function toggle(id: string) {
    setEnabled((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function copy(text: string, flag: (v: boolean) => void) {
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        flag(true);
        setTimeout(() => flag(false), 1800);
      })
      .catch(() => {});
  }

  // Replay the same class shift: remount the desk fresh, clear the finished
  // result (so the send card hides until the new run ends), and un-dismiss the
  // report. Shared by the report's Run it back button and the Play again button
  // shown after the report is closed.
  function playAgain() {
    setRunKey((k) => k + 1);
    setResult(null);
    setNewAch([]);
    setReportDismissed(false);
  }

  // The shareable class code: the chosen recipe, a fixed seed, and the optional
  // class label. Mutators are hand picked (no rolled flag), so the seed reproduces
  // the same draw for every student.
  const classCode = useMemo(() => {
    if (seed == null) return "";
    return encodeCombo({ track: trackOpt(), count, modifierIds: enabled, seed, label: label.trim() || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, track, count, enabled, label]);
  const classUrl = mounted && classCode ? `${window.location.origin}/learn/techhub/class?code=${classCode}` : "";

  // The student's paste back result: the same shift config plus their name and
  // their score and grade under vs. Recomputed live as they type their name.
  const myResultCode = useMemo(() => {
    if (!challenge || !result) return "";
    const data: ComboData = {
      track: challenge.track,
      count: challenge.count,
      modifierIds: challenge.modifierIds,
      seed: challenge.seed,
      label: challenge.label,
      student: studentName.trim() || undefined,
      vs: { score: result.score, grade: result.grade },
    };
    return encodeCombo(data);
  }, [challenge, result, studentName]);
  const myResultUrl = mounted && myResultCode ? `${window.location.origin}/learn/techhub/class?result=${myResultCode}` : "";

  // Parse the collector textarea into a ranked table. Each token is decoded; only
  // codes carrying a vs score count as a result. Best score per name is kept, then
  // sorted high to low. A Map keeps the dedupe O(n) without spreading.
  const rows = useMemo(() => {
    const map = new Map<string, { name: string; score: number; grade: string }>();
    pasted.split(/[\s,]+/).forEach((tok) => {
      const c = decodeCombo(extractCode(tok));
      if (!c || !c.vs) return;
      const name = (c.student ?? "").trim() || "Anonymous";
      const prev = map.get(name.toLowerCase());
      if (!prev || c.vs.score > prev.score) map.set(name.toLowerCase(), { name, score: c.vs.score, grade: c.vs.grade });
    });
    return Array.from(map.values()).sort((a, b) => b.score - a.score);
  }, [pasted]);

  const seg = (active: boolean) =>
    `px-3 py-1.5 rounded-md font-mono text-[11px] border transition-colors ${active ? "border-[#FFD700]/70 bg-[#FFD700]/15 text-cream" : "border-white/12 text-cream/60 hover:bg-white/[0.05]"}`;

  /* ─────────────────────────── student play view ─────────────────────────── */
  if (challenge) {
    if (!shift) {
      return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-10 text-center text-cream/40 font-mono text-sm">loading the class shift...</div>;
    }
    return (
      <div className="space-y-3">
        <AchievementBanner ids={newAch} />

        {/* Which class this shift belongs to, plus how the round trip works. */}
        <div className="rounded-xl border border-[#FFD700]/30 bg-[#FFD700]/[0.06] p-3.5">
          <div className="flex items-center gap-2">
            <GraduationCap size={18} weight="fill" color="#FFD700" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/90">class challenge</span>
          </div>
          {challenge.label ? (
            <p className="font-syne font-semibold text-sm text-cream mt-1.5">{challenge.label}</p>
          ) : (
            <p className="font-syne font-semibold text-sm text-cream mt-1.5">Your teacher's shared shift</p>
          )}
          <p className="text-cream/60 text-[11px] mt-1 leading-relaxed">
            Everyone in your class plays this exact shift, the same tickets in the same order. Play it, then send your result back to your teacher. It grants no Fangs and touches no server.
          </p>
        </div>

        {shift.modifiers && shift.modifiers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">modifiers</span>
            {shift.modifiers.map((m) => (
              <span key={m.id} title={m.desc} className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.15)", color: "#C9A2F2", border: "1px solid rgba(168,85,247,0.35)" }}>
                {m.label}
              </span>
            ))}
          </div>
        )}

        {/* The send card surfaces only once the shift is finished, since you cannot
            send a result you do not have yet. It sits above the desk and, when the
            student closes the end of shift report (its Back button is wired to
            onExit, which unmounts the desk and so releases the report's focus
            trap), focus moves here so a keyboard or screen reader student can reach
            and copy their result. It copies a code and a link, both seeded and
            client side, and grants nothing. */}
        {result && (
          <div
            ref={sendCardRef}
            tabIndex={-1}
            role="group"
            aria-label="Your shift result, ready to send to your teacher"
            className="animate-slide-up rounded-xl border border-[#A855F7]/30 bg-[#A855F7]/[0.07] p-3.5 space-y-3 focus:outline-none"
          >
            <div className="flex items-center gap-2">
              <Trophy size={18} weight="fill" color="#C9A2F2" aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C9A2F2]">send your result to your teacher</span>
            </div>
            <p className="text-cream text-sm">
              You scored <span className="font-bold tabular-nums">{result.score}</span> (grade{" "}
              <span className="font-bold" style={{ color: gradeColor(result.grade) }}>{result.grade}</span>).
            </p>
            <input
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="your name (so your teacher knows it is you)"
              maxLength={32}
              aria-label="Your name"
              className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream/30 focus:outline-none focus:border-[#A855F7]/50"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => copy(myResultCode, setResultCopied)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#A855F7]/45 text-[#C9A2F2] text-[11px] hover:bg-[#A855F7]/10 transition-colors"
              >
                <Copy size={13} weight="fill" aria-hidden="true" /> <span aria-live="polite">{resultCopied ? "Code copied" : "Copy result code"}</span>
              </button>
              <button
                onClick={() => copy(myResultUrl, setLinkCopied)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gold/45 text-gold text-[11px] hover:bg-gold/10 transition-colors"
              >
                <LinkSimple size={13} weight="fill" aria-hidden="true" /> <span aria-live="polite">{linkCopied ? "Link copied" : "Copy results link"}</span>
              </button>
            </div>
            <p className="font-mono text-[10px] text-cream/45 break-all leading-relaxed">{myResultCode}</p>
            <p className="font-mono text-[10px] text-cream/40 leading-relaxed">
              Send the code or link however your teacher asked (chat, email, or your class page). Your name, score, and grade live inside it. You can replay to improve before you send.
            </p>
          </div>
        )}

        {/* Closing the report (onExit) unmounts the desk so the focus trap is
            released and the send card above is reachable. We swap in a small
            panel that keeps a replay affordance, since the report's own Run it
            back button is gone with it. */}
        {reportDismissed ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-center space-y-3">
            <p className="text-cream/70 text-sm leading-relaxed">Report closed. Your result is above, ready to send to your teacher.</p>
            <button
              onClick={playAgain}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl border border-gold/45 text-gold text-sm hover:bg-gold/10 transition-colors"
            >
              <ArrowsClockwise size={15} weight="fill" aria-hidden="true" /> Play this shift again
            </button>
          </div>
        ) : (
          <LionDesk
            key={`${shift.id}-${runKey}`}
            shift={shift}
            onComplete={(r, state: State) => {
              recordPlayDay();
              recordShiftConcepts(shift, state);
              setNewAch(recordShiftResult(shift, r));
              setResult(r);
            }}
            onReplay={playAgain}
            onExit={() => setReportDismissed(true)}
          />
        )}
        <p className="font-mono text-[10px] text-cream/40">A class shift. The same queue every time you open this link.</p>
      </div>
    );
  }

  /* ─────────────────────────── teacher view ─────────────────────────── */
  return (
    <div className="space-y-5">
      {/* How it works, stated plainly: no server, link and paste based. */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <UsersThree size={18} weight="fill" color="#FFD700" aria-hidden="true" />
          <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">HOW IT WORKS</h2>
        </div>
        <p className="text-cream/70 text-sm leading-relaxed mt-2">
          Build one shift, share the link, and your whole class plays the exact same tickets in the same order. There is no server: students send their results back to you as a code or link, and you paste them into the collector to see the ranking. Nothing is graded for you and no Fangs are granted.
        </p>
      </div>

      {/* 1. Build the class shift. */}
      <div className="rounded-2xl p-4 sm:p-5 space-y-4" style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.10) 0%, rgba(168,85,247,0.06) 55%, rgba(12,16,32,0.95) 100%)", border: "1px solid rgba(255,215,0,0.22)" }}>
        <div className="flex items-center gap-2">
          <Lightning size={18} weight="fill" color="#FFD700" aria-hidden="true" />
          <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">1. BUILD THE CLASS SHIFT</h2>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">class label</p>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="class label (e.g. Period 3 Networking)"
            maxLength={48}
            aria-label="Class label"
            className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream/30 focus:outline-none focus:border-[#FFD700]/50"
          />
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">track</p>
          <div className="flex gap-2 flex-wrap">
            {TRACK_OPTS.map((t) => (
              <button key={t.id} className={seg(track === t.id)} onClick={() => setTrack(t.id)}>{t.label}</button>
            ))}
          </div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">tickets</p>
          <div className="flex items-center gap-3">
            <button onClick={() => setCount((c) => Math.max(4, c - 1))} aria-label="Fewer tickets" className="w-8 h-8 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06]">−</button>
            <span className="font-bebas text-2xl text-cream tabular-nums w-8 text-center">{count}</span>
            <button onClick={() => setCount((c) => Math.min(9, c + 1))} aria-label="More tickets" className="w-8 h-8 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06]">+</button>
            <span className="font-mono text-[10px] text-cream/40">4 to 9</span>
          </div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">modifiers</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODIFIERS.map((m) => {
              const on = enabled.includes(m.id);
              return (
                <button key={m.id} onClick={() => toggle(m.id)} className={`text-left rounded-lg border p-2.5 transition-colors ${on ? "border-[#FFD700]/60 bg-[#FFD700]/10" : "border-white/[0.08] hover:bg-white/[0.04]"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${on ? "bg-[#FFD700] border-[#FFD700]" : "border-white/25"}`}>{on && <span className="text-[#04060c] text-[9px] font-bold leading-none">✓</span>}</span>
                    <span className="text-cream text-sm font-semibold">{m.label}</span>
                  </div>
                  <p className="text-cream/50 text-[11px] mt-1 leading-snug">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* The shareable link. Mount guarded: before the seed is rolled on the
            client we show a calm placeholder rather than an empty or shifting URL. */}
        <div className="pt-1 border-t border-white/[0.06]">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">class link</p>
          {!mounted ? (
            <div className="h-9 rounded-lg bg-white/[0.05] motion-safe:animate-pulse" aria-hidden="true" />
          ) : (
            <>
              <p className="font-mono text-[10px] text-cream/50 break-all leading-relaxed bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2">{classUrl}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button
                  onClick={() => copy(classUrl, setClassCopied)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-xl font-bold text-sm text-[#04060c]"
                  style={{ background: "linear-gradient(135deg,#FFD700,#FFA500)" }}
                >
                  <LinkSimple size={15} weight="fill" aria-hidden="true" /> <span aria-live="polite">{classCopied ? "Class link copied" : "Copy class link"}</span>
                </button>
                <button
                  onClick={() => setSeed(Math.floor(Math.random() * 1e9) >>> 0)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/15 text-cream/75 text-sm hover:bg-white/[0.06]"
                >
                  <ArrowsClockwise size={15} weight="fill" aria-hidden="true" /> New draw
                </button>
              </div>
              <p className="font-mono text-[10px] text-cream/40 mt-2 leading-relaxed">
                Send this link to your students. They open it, play the identical shift, and send their result back to you. New draw rolls a different set of tickets at the same recipe.
              </p>
            </>
          )}
        </div>
      </div>

      {/* 2. Collect results. */}
      <div className="rounded-2xl p-4 sm:p-5 space-y-3" style={{ background: "linear-gradient(135deg, rgba(74,144,217,0.10) 0%, rgba(168,85,247,0.06) 55%, rgba(12,16,32,0.95) 100%)", border: "1px solid rgba(74,144,217,0.22)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListChecks size={18} weight="fill" color="#4A90D9" aria-hidden="true" />
            <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">2. COLLECT RESULTS</h2>
          </div>
          <span className="font-mono text-[10px] tabular-nums text-cream/55">{rows.length} {rows.length === 1 ? "result" : "results"}</span>
        </div>
        <p className="text-cream/60 text-[11px] leading-relaxed">
          Paste the result codes or links your students send back, one per line. The ranking builds below. The best score per name is kept and nothing leaves your browser.
        </p>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="paste student result codes or links here, one per line..."
          rows={4}
          aria-label="Paste student result codes"
          className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] font-mono text-cream placeholder:text-cream/30 focus:outline-none focus:border-[#4A90D9]/50 resize-y"
        />

        {rows.length === 0 ? (
          <p className="text-cream/40 text-[11px] font-mono">No results yet. Paste what students send back to build the ranking.</p>
        ) : (
          <ul className="space-y-1.5" aria-label="Class ranking">
            {rows.map((r, i) => {
              const tint = i < 3 ? RANK_TINT[i] : "rgba(255,255,255,0.12)";
              return (
                <li
                  key={`${r.name.toLowerCase()}-${i}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2"
                  style={{ background: i < 3 ? `${RANK_TINT[i]}10` : "rgba(255,255,255,0.025)", border: `1px solid ${i < 3 ? `${RANK_TINT[i]}3a` : "rgba(255,255,255,0.07)"}` }}
                >
                  <span className="font-bebas text-lg tabular-nums w-6 text-center leading-none" style={{ color: tint }}>{i + 1}</span>
                  <span className="flex-1 min-w-0 font-syne font-semibold text-sm text-cream truncate">{r.name}</span>
                  <span className="font-mono text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded" style={{ background: `${gradeColor(r.grade)}1f`, color: gradeColor(r.grade), border: `1px solid ${gradeColor(r.grade)}44` }}>{r.grade}</span>
                  <span className="font-mono text-[12px] tabular-nums text-cream/70 w-8 text-right">{r.score}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
