"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Compass, ArrowRight, ArrowClockwise, CheckCircle, XCircle, Target, GraduationCap } from "@phosphor-icons/react";
import { TRACKS, getTrack } from "@/lib/helpdesk/tracks";
import { trackIconFor } from "@/components/helpdesk/icons";
import {
  PLACEMENT_QUESTIONS,
  scorePlacement,
  savePlacementResult,
  getPlacementResult,
  difficultyBlurb,
  type PlacementAnswers,
  type PlacementResult,
} from "@/lib/liondesk/placement";

const ACCENT = "#C9A2F2";

type Phase = "intro" | "quiz" | "result";

// The recommended track card and its difficulty advisory, shown once the test is
// scored. Deep links the player straight into the recommended track. Cosmetic and
// advisory: it grants nothing, and the player can pick any track they like.
function ResultPanel({ result, onRetake }: { result: PlacementResult; onRetake: () => void }) {
  const track = getTrack(result.track) ?? TRACKS[0];
  const Icon = trackIconFor(track.icon);
  const startRef = useRef<HTMLAnchorElement>(null);

  // Land keyboard focus on the primary action (Start the track) when the result
  // appears, so a keyboard user is not stranded at the top of the page.
  useEffect(() => { startRef.current?.focus(); }, []);

  return (
    <div className="space-y-3">
      {/* Recommended track */}
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{ background: `linear-gradient(135deg, ${track.color}1f 0%, rgba(168,85,247,0.06) 55%, rgba(12,16,32,0.96) 100%)`, border: `1px solid ${track.color}55` }}
      >
        <div className="flex items-center gap-2 mb-2">
          <Compass size={20} weight="fill" color={ACCENT} aria-hidden="true" />
          <h2 className="font-bebas text-2xl text-cream tracking-wider leading-none">YOUR RECOMMENDED START</h2>
          <span className="ml-auto font-mono text-[10px] tabular-nums text-cream/55">{result.correct}/{result.total} correct</span>
        </div>

        <div className="flex items-start gap-3 mt-3">
          <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${track.color}1f`, border: `1px solid ${track.color}55` }}>
            <Icon size={24} weight="fill" color={track.color} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bebas text-2xl text-cream tracking-wide leading-none">{track.name}</h3>
            <p className="text-cream/60 text-xs mt-1">{track.tagline}</p>
            <p className="text-cream/75 text-xs leading-relaxed mt-2">{track.blurb}</p>
          </div>
        </div>

        {/* Difficulty advisory */}
        <div className="flex items-start gap-2 rounded-xl p-3 mt-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <Target size={16} weight="fill" color={ACCENT} aria-hidden="true" className="flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-syne font-semibold text-sm text-cream">Suggested difficulty: {result.difficulty}</p>
            <p className="text-cream/60 text-[11px] mt-0.5 leading-relaxed">{difficultyBlurb(result.difficulty)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <Link
            ref={startRef}
            href={`/learn/techhub/${result.track}`}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm text-[#04080F]"
            style={{ background: `linear-gradient(135deg, ${track.color}, ${track.color}aa)` }}
          >
            Start {track.name} <ArrowRight size={15} weight="bold" aria-hidden="true" />
          </Link>
          <button type="button" onClick={onRetake} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/15 text-cream/80 text-sm font-semibold hover:bg-white/[0.06] transition-colors">
            <ArrowClockwise size={15} weight="bold" aria-hidden="true" /> Retake test
          </button>
          <Link href="/learn/techhub" className="inline-flex items-center px-4 py-2 rounded-xl border border-white/15 text-cream/80 text-sm font-semibold hover:bg-white/[0.05] transition-colors">Back to TechHub</Link>
        </div>
      </div>

      {/* Per track breakdown */}
      <div className="rounded-2xl p-4 sm:p-5 border border-white/[0.08] bg-white/[0.03]">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55 mb-3">how you scored by track</p>
        <div className="space-y-2">
          {result.byTrack.map((b) => {
            const def = getTrack(b.track);
            const color = def?.color ?? ACCENT;
            const pct = b.total > 0 ? Math.round((b.correct / b.total) * 100) : 0;
            const isPick = b.track === result.track;
            return (
              <div key={b.track} className="flex items-center gap-3">
                <span className="w-28 flex-shrink-0 truncate text-xs" style={{ color: isPick ? color : "rgba(231,238,250,0.7)", fontWeight: isPick ? 700 : 400 }}>{b.name}</span>
                <span className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/10">
                  <span className="block h-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} />
                </span>
                <span className="font-mono text-[10px] tabular-nums text-cream/55 flex-shrink-0 w-8 text-right">{b.correct}/{b.total}</span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="font-mono text-[10px] text-cream/40 leading-relaxed">
        This is a guide, not a gate. Nothing is granted here, and you can switch tracks anytime. Any Fangs are only ever granted server side once a real solve is validated, so the in game economy stays tamper proof.
      </p>
    </div>
  );
}

/**
 * Placement test (Idea 40). A short, mixed concept quiz that recommends a
 * starting track and difficulty for newcomers. Authored and deterministic, zero
 * API, client only and mount guarded so no stored value flashes a zero. Inline
 * (not a modal), so every control stays keyboard reachable without a focus trap.
 * The result is advisory and grants nothing; the economy stays server
 * authoritative.
 */
export default function PlacementTest() {
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("intro");
  const [saved, setSaved] = useState<PlacementResult | null>(null);
  const [answers, setAnswers] = useState<PlacementAnswers>({});
  const [current, setCurrent] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Read the stored result after mount (localStorage), so the result is shown
  // straight away to a returning player and the intro to a first timer. Avoids a
  // hydration mismatch and any flash of a zeroed result.
  useEffect(() => {
    setMounted(true);
    const s = getPlacementResult();
    if (s) {
      setSaved(s);
      setPhase("result");
    }
  }, []);

  // After answering, move focus to the advance button so a keyboard user can
  // continue without hunting for it.
  useEffect(() => {
    if (phase === "quiz" && revealed) nextRef.current?.focus();
  }, [phase, revealed, current]);

  function startQuiz() {
    setAnswers({});
    setCurrent(0);
    setRevealed(false);
    setPhase("quiz");
  }

  function choose(questionId: string, optionId: string) {
    if (revealed) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
    setRevealed(true);
  }

  function advance() {
    if (current < PLACEMENT_QUESTIONS.length - 1) {
      setCurrent((c) => c + 1);
      setRevealed(false);
      return;
    }
    // Last question answered: score, persist, and show the recommendation. The
    // answers state already holds the final pick (choose ran before advance).
    const r = scorePlacement(answers);
    savePlacementResult(r);
    setSaved(r);
    setPhase("result");
  }

  // Pre mount: a neutral skeleton so a stored result never flashes in or out.
  if (!mounted) {
    return (
      <div className="rounded-2xl p-4 sm:p-5 border border-white/[0.08] bg-white/[0.03]">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded bg-white/10 motion-safe:animate-pulse" aria-hidden="true" />
          <span className="h-5 w-44 rounded bg-white/10 motion-safe:animate-pulse" aria-hidden="true" />
        </div>
        <div className="h-3 w-3/4 rounded bg-white/10 motion-safe:animate-pulse mt-3" aria-hidden="true" />
        <div className="h-3 w-2/3 rounded bg-white/10 motion-safe:animate-pulse mt-2" aria-hidden="true" />
      </div>
    );
  }

  if (phase === "result" && saved) {
    return <ResultPanel result={saved} onRetake={startQuiz} />;
  }

  if (phase === "quiz") {
    const q = PLACEMENT_QUESTIONS[current];
    const chosen = answers[q.id];
    const total = PLACEMENT_QUESTIONS.length;
    const last = current === total - 1;
    const pct = Math.round(((current + (revealed ? 1 : 0)) / total) * 100);

    return (
      <div className="space-y-3">
        {/* Progress */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">Question {current + 1} of {total}</span>
          <span className="font-mono text-[10px] tabular-nums text-cream/45">{q.concept}</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden bg-white/10">
          <div className="h-full transition-[width] duration-500" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${ACCENT}, #4A90D9)` }} />
        </div>

        {/* Question */}
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.10) 0%, rgba(74,144,217,0.05) 55%, rgba(12,16,32,0.95) 100%)", border: "1px solid rgba(168,85,247,0.22)" }}>
          <p className="font-syne font-semibold text-base text-cream leading-snug">{q.prompt}</p>
          <p className="text-cream/55 text-xs mt-1">{q.context}</p>

          <fieldset className="mt-4 space-y-2" aria-label={q.prompt}>
            {q.options.map((opt) => {
              const isChosen = chosen === opt.id;
              const isCorrect = !!opt.correct;
              // Highlight only after the player answers: the correct option turns
              // green, a wrong pick turns crimson, the rest stay neutral.
              let border = "rgba(255,255,255,0.10)";
              let bg = "rgba(255,255,255,0.025)";
              if (revealed && isCorrect) { border = "rgba(43,190,107,0.6)"; bg = "rgba(43,190,107,0.10)"; }
              else if (revealed && isChosen && !isCorrect) { border = "rgba(239,68,68,0.6)"; bg = "rgba(239,68,68,0.10)"; }
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => choose(q.id, opt.id)}
                  disabled={revealed}
                  aria-pressed={isChosen}
                  className="w-full text-left flex items-center gap-3 rounded-xl p-3 transition-colors disabled:cursor-default enabled:hover:bg-white/[0.05]"
                  style={{ background: bg, border: `1px solid ${border}` }}
                >
                  <span className="flex-1 min-w-0 text-sm text-cream/90">{opt.label}</span>
                  {revealed && isCorrect && <CheckCircle size={18} weight="fill" color="#2BBE6B" aria-hidden="true" className="flex-shrink-0" />}
                  {revealed && isChosen && !isCorrect && <XCircle size={18} weight="fill" color="#F87171" aria-hidden="true" className="flex-shrink-0" />}
                </button>
              );
            })}
          </fieldset>

          {/* Teach line, announced once an answer is locked in. */}
          <div aria-live="polite" className="min-h-[1.2em] mt-3">
            {revealed && (
              <p className="text-cream/70 text-xs leading-relaxed rounded-xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>{q.teach}</p>
            )}
          </div>

          {revealed && (
            <div className="flex justify-end mt-3">
              <button
                ref={nextRef}
                type="button"
                onClick={advance}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm text-[#04080F]"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #A855F7)` }}
              >
                {last ? "See your result" : "Next question"} <ArrowRight size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Intro
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.10) 0%, rgba(74,144,217,0.06) 55%, rgba(12,16,32,0.95) 100%)", border: "1px solid rgba(168,85,247,0.24)" }}>
      <div className="flex items-center gap-2">
        <Compass size={20} weight="fill" color={ACCENT} aria-hidden="true" />
        <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">FIND YOUR TRACK</h2>
      </div>
      <p className="text-cream/65 text-[13px] mt-2 leading-relaxed">
        {PLACEMENT_QUESTIONS.length} quick questions across IT support, cybersecurity, software, cloud, and ethical hacking. Answer how you would on the job and we will recommend a track and a starting difficulty. There are no wrong careers here, just a place to start.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
        <div className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <Target size={16} weight="fill" color={ACCENT} aria-hidden="true" />
          <p className="text-cream/70 text-[11px]">Takes about two minutes. Each answer teaches the why.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
          <GraduationCap size={16} weight="fill" color="#2BBE6B" aria-hidden="true" />
          <p className="text-cream/70 text-[11px]">Just a guide. Nothing is granted and you can retake it anytime.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          onClick={startQuiz}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm text-[#04080F]"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #A855F7)` }}
        >
          Start the placement test <ArrowRight size={15} weight="bold" aria-hidden="true" />
        </button>
        <Link href="/learn/techhub" className="inline-flex items-center px-4 py-2 rounded-xl border border-white/15 text-cream/80 text-sm font-semibold hover:bg-white/[0.05] transition-colors">Back to TechHub</Link>
      </div>
    </div>
  );
}
