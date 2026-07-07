"use client";

// Review Hub — ONE spaced-repetition session over every review system:
//   weak spots (missed Ninny questions), vocab words, class flashcards, and
//   study set cards.
//
// The queue comes merged + interleaved from GET /api/review/queue. Grading is
// DISPATCHED to each source's existing endpoint (the hub never re-implements
// grading):
//   weak_spot        -> POST  /api/ninny/review/grade   (server-side MCQ regrade)
//   vocab            -> POST  /api/vocab/review/[id]    (may award Fangs)
//   class_flashcard  -> PATCH /api/classes/[classId]/flashcards/[cardId]
//   study_set        -> POST  /api/study-sets/cards/[cardId]/review
//
// Weak spots and study sets stay reward-free (self-grading can't be gamed).
// Vocab keeps its existing +2 Fang correct-review grant, surfaced inline.
//
// Deep link tolerated: /learn/review?source=study_set&set=<id> filters the
// session to one deck (the study-set detail page's "Review now" button).
//
// The 7-day retention stat comes from review_events (HELD migration
// 20260702100000) and is hidden while the table is missing (retention7d null).

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost, apiPatch } from "@/lib/api-client";
// Queue item shapes come from the server module itself, TYPE-ONLY so the
// import is erased at build time (no supabaseAdmin reaches the client
// bundle; same pattern as the focus page's room-state types).
import type { HubItem } from "@/lib/review-hub";
import {
  Target,
  Translate,
  Cards,
  ChartLineUp,
  ArrowRight,
  CheckCircle,
  XCircle,
  Sparkle,
  ArrowClockwise,
  Eye,
  Stack,
} from "@phosphor-icons/react";

const PURPLE = "#A855F7";

interface QueueResponse {
  items: HubItem[];
  total: number;
  counts: { weak_spot: number; vocab: number; class_flashcard: number; study_set: number };
  sources: {
    weak_spot: { ok: boolean };
    vocab: { ok: boolean };
    class_flashcard: { ok: boolean };
    study_set: { ok: boolean };
  };
  filtered: { source: string; set: string | null } | null;
  retention7d: { total: number; correct: number } | null;
  nextDueInMs: number | null;
}

type Phase = "loading" | "error" | "empty" | "active" | "done";
type ClassRating = "again" | "hard" | "good" | "easy";

interface GradeOutcome {
  success: boolean;
  correct: boolean;
  mastered: boolean;
  coinsAwarded: number;
}

const GRADE_FAILED: GradeOutcome = {
  success: false,
  correct: false,
  mastered: false,
  coinsAwarded: 0,
};

/* ── Countdown formatting for the "all caught up" state ───────── */
function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/* ── Source presentation helpers ──────────────────────────────── */
function sourceLabel(item: HubItem): string {
  if (item.source === "weak_spot") return "weak spot";
  if (item.source === "vocab") return "vocab";
  if (item.source === "study_set") return "study set";
  return "class card";
}
function sourceContext(item: HubItem): string | null {
  if (item.source === "weak_spot") return item.meta.materialTitle;
  if (item.source === "vocab") {
    const { sourceLang, targetLang } = item.meta;
    return sourceLang && targetLang ? `${sourceLang} to ${targetLang}` : null;
  }
  if (item.source === "study_set") return item.meta.setTitle;
  return item.meta.className;
}

export default function ReviewHubPage() {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<HubItem[]>([]);
  const [counts, setCounts] = useState({ weak_spot: 0, vocab: 0, class_flashcard: 0, study_set: 0 });
  const [total, setTotal] = useState(0);
  const [degraded, setDegraded] = useState(false);
  const [filtered, setFiltered] = useState(false);
  const [retention, setRetention] = useState<{ total: number; correct: number } | null>(null);
  const [nextDueInMs, setNextDueInMs] = useState<number | null>(null);

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null); // mcq choice
  const [revealed, setRevealed] = useState(false); // reveal-style cards
  const [guess, setGuess] = useState(""); // optional typed recall attempt before reveal (active recall)
  const [grading, setGrading] = useState(false);
  const [lastResult, setLastResult] = useState<GradeOutcome | null>(null);

  // Session tally
  const [reviewed, setReviewed] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [fangsEarned, setFangsEarned] = useState(0);
  // Active-recall accuracy: of the cards where you actually TYPED a guess before
  // revealing, how many you then self-graded correct. Pure session stat, no API.
  const [guessAttempts, setGuessAttempts] = useState(0);
  const [guessHits, setGuessHits] = useState(0);

  const load = useCallback(async () => {
    setPhase("loading");
    // Tolerated deep-link filter: ?source=study_set&set=<id> narrows the
    // session to one deck. Read from window (not useSearchParams) so this
    // client page needs no Suspense boundary. Unknown values are ignored
    // server-side, so a stale link still loads the full queue.
    let query = "/api/review/queue?limit=30";
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const source = params.get("source");
      const set = params.get("set");
      if (source === "study_set") {
        query += "&source=study_set";
        if (set) query += `&set=${encodeURIComponent(set)}`;
      }
    }
    const res = await apiGet<QueueResponse>(query);
    if (res.ok && res.data) {
      setItems(res.data.items);
      setCounts(res.data.counts);
      setTotal(res.data.total);
      setRetention(res.data.retention7d);
      setNextDueInMs(res.data.nextDueInMs);
      setFiltered(res.data.filtered != null);
      setDegraded(
        !res.data.sources.weak_spot.ok ||
          !res.data.sources.vocab.ok ||
          !res.data.sources.class_flashcard.ok ||
          !res.data.sources.study_set.ok,
      );
      setIndex(0);
      setSelected(null);
      setRevealed(false);
      setGuess("");
      setLastResult(null);
      setReviewed(0);
      setCorrectCount(0);
      setMasteredCount(0);
      setFangsEarned(0);
      setGuessAttempts(0);
      setGuessHits(0);
      setPhase(res.data.items.length > 0 ? "active" : "empty");
    } else {
      // The QUEUE FETCH ITSELF failed — this is not "nothing due". Rendering
      // the empty state here would falsely tell someone with due cards that
      // they're caught up, so show a real error with a retry instead.
      setItems([]);
      setCounts({ weak_spot: 0, vocab: 0, class_flashcard: 0, study_set: 0 });
      setTotal(0);
      setRetention(null);
      setNextDueInMs(null);
      setFiltered(false);
      setDegraded(false);
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    if (user?.id) load();
  }, [user?.id, load]);

  const current = items[index];

  /* ── Grade dispatch — each source keeps its OWN endpoint ─────── */
  const applyOutcome = useCallback((outcome: GradeOutcome) => {
    setLastResult(outcome);
    setReviewed((n) => n + 1);
    if (outcome.success && outcome.correct) setCorrectCount((n) => n + 1);
    if (outcome.success && outcome.mastered) setMasteredCount((n) => n + 1);
    if (outcome.success && outcome.coinsAwarded > 0) {
      setFangsEarned((n) => n + outcome.coinsAwarded);
    }
    // Recall-accuracy tally: only counts cards where a guess was actually typed
    // (the guess box only renders for reveal-style cards; MCQ cards leave it "").
    if (outcome.success && guess.trim()) {
      setGuessAttempts((n) => n + 1);
      if (outcome.correct) setGuessHits((n) => n + 1);
    }
  }, [guess]);

  const gradeWeakSpot = useCallback(
    async (payload: { selectedIndex?: number; knewIt?: boolean }) => {
      if (!current || current.source !== "weak_spot" || grading) return;
      setGrading(true);
      const res = await apiPost<{ success: boolean; correct: boolean; mastered: boolean }>(
        "/api/ninny/review/grade",
        { id: current.id, ...payload },
      );
      setGrading(false);
      applyOutcome(
        res.ok && res.data
          ? { success: true, correct: res.data.correct, mastered: res.data.mastered, coinsAwarded: 0 }
          : GRADE_FAILED,
      );
    },
    [current, grading, applyOutcome],
  );

  const gradeVocab = useCallback(
    async (knewIt: boolean) => {
      if (!current || current.source !== "vocab" || grading) return;
      setGrading(true);
      const res = await apiPost<{ coinsAwarded?: number }>(
        `/api/vocab/review/${current.id}`,
        { correct: knewIt },
      );
      setGrading(false);
      applyOutcome(
        res.ok
          ? {
              success: true,
              correct: knewIt,
              mastered: false,
              coinsAwarded: res.data?.coinsAwarded ?? 0,
            }
          : GRADE_FAILED,
      );
    },
    [current, grading, applyOutcome],
  );

  const gradeClassCard = useCallback(
    async (rating: ClassRating) => {
      if (!current || current.source !== "class_flashcard" || grading) return;
      setGrading(true);
      const res = await apiPatch(
        `/api/classes/${current.meta.classId}/flashcards/${current.id}`,
        { rating },
      );
      setGrading(false);
      applyOutcome(
        res.ok
          ? { success: true, correct: rating !== "again", mastered: false, coinsAwarded: 0 }
          : GRADE_FAILED,
      );
    },
    [current, grading, applyOutcome],
  );

  const gradeStudySet = useCallback(
    async (correct: boolean) => {
      if (!current || current.source !== "study_set" || grading) return;
      setGrading(true);
      const res = await apiPost(`/api/study-sets/cards/${current.id}/review`, {
        correct,
      });
      setGrading(false);
      // Reward-free source (weak-spot precedent): coinsAwarded is always 0.
      applyOutcome(
        res.ok
          ? { success: true, correct, mastered: false, coinsAwarded: 0 }
          : GRADE_FAILED,
      );
    },
    [current, grading, applyOutcome],
  );

  const handleSelectOption = (i: number) => {
    if (selected !== null || grading) return;
    setSelected(i);
    void gradeWeakSpot({ selectedIndex: i });
  };

  const handleSelectStudySetOption = (i: number) => {
    if (!current || current.source !== "study_set" || selected !== null || grading) return;
    setSelected(i);
    void gradeStudySet(i === current.correctIndex);
  };

  const handleNext = () => {
    const next = index + 1;
    if (next >= items.length) {
      setPhase("done");
      return;
    }
    setIndex(next);
    setSelected(null);
    setRevealed(false);
    setGuess("");
    setLastResult(null);
  };

  const progressPct =
    items.length > 0 ? ((index + (lastResult ? 1 : 0)) / items.length) * 100 : 0;

  const retentionPct =
    retention && retention.total > 0
      ? Math.round((retention.correct / retention.total) * 100)
      : null;

  const chips: { key: string; label: string; count: number; icon: JSX.Element }[] = [
    {
      key: "weak_spot",
      label: "weak spots",
      count: counts.weak_spot,
      icon: <Target size={12} weight="fill" color={PURPLE} aria-hidden="true" />,
    },
    {
      key: "vocab",
      label: "vocab",
      count: counts.vocab,
      icon: <Translate size={12} weight="fill" color={PURPLE} aria-hidden="true" />,
    },
    {
      key: "class_flashcard",
      label: "class cards",
      count: counts.class_flashcard,
      icon: <Cards size={12} weight="fill" color={PURPLE} aria-hidden="true" />,
    },
    {
      key: "study_set",
      label: "study set cards",
      count: counts.study_set,
      icon: <Stack size={12} weight="fill" color={PURPLE} aria-hidden="true" />,
    },
  ].filter((c) => c.count > 0);

  /* ── Shared button styles ─────────────────────────────────────── */
  const selfGradeButtons = (onGrade: (knewIt: boolean) => void) => (
    <div className="grid grid-cols-2 gap-2.5">
      <button
        type="button"
        disabled={grading}
        onClick={() => onGrade(false)}
        className="rounded-xl border px-4 py-3.5 min-h-[52px] font-bebas text-base tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-60"
        style={{ background: "rgba(239,68,68,0.1)", borderColor: "rgba(239,68,68,0.4)", color: "#EEF4FF" }}
      >
        <XCircle size={16} weight="fill" aria-hidden="true" />
        Missed it
      </button>
      <button
        type="button"
        disabled={grading}
        onClick={() => onGrade(true)}
        className="rounded-xl border px-4 py-3.5 min-h-[52px] font-bebas text-base tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-60"
        style={{ background: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.45)", color: "#EEF4FF" }}
      >
        <CheckCircle size={16} weight="fill" aria-hidden="true" />
        I knew it
      </button>
    </div>
  );

  const ratingButtons = (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {(
        [
          { rating: "again" as const, label: "Again", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.4)" },
          { rating: "hard" as const, label: "Hard", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.4)" },
          { rating: "good" as const, label: "Good", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.45)" },
          { rating: "easy" as const, label: "Easy", bg: "rgba(74,144,217,0.12)", border: "rgba(74,144,217,0.45)" },
        ]
      ).map((b) => (
        <button
          key={b.rating}
          type="button"
          disabled={grading}
          onClick={() => void gradeClassCard(b.rating)}
          className="rounded-xl border px-3 py-3.5 min-h-[52px] font-bebas text-base tracking-wider flex items-center justify-center transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-60"
          style={{ background: b.bg, borderColor: b.border, color: "#EEF4FF" }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.4s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
        }
      `}</style>

      <FeatureGate feature="learn">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            {/* Header */}
            <header className="mb-4 flex items-center justify-between animate-slide-up">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: `${PURPLE}18`, border: `1px solid ${PURPLE}40` }}
                >
                  <Target size={20} weight="fill" color={PURPLE} aria-hidden="true" />
                </div>
                <div>
                  <h1 className="font-bebas text-2xl sm:text-3xl text-cream tracking-[0.06em] leading-none">
                    Review Hub
                  </h1>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55 mt-1">
                    spaced repetition
                  </p>
                </div>
              </div>
              <Link
                href="/learn"
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/50 hover:text-cream/80 transition-colors"
              >
                exit
              </Link>
            </header>

            {/* Source chips + retention */}
            {phase !== "loading" && (chips.length > 0 || retentionPct !== null) && (
              <div className="mb-5 flex flex-wrap items-center gap-2 animate-slide-up">
                {chips.map((c) => (
                  <span
                    key={c.key}
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-full"
                    style={{ background: `${PURPLE}14`, border: `1px solid ${PURPLE}35`, color: "#C79BFF" }}
                  >
                    {c.icon}
                    {c.count} {c.label}
                  </span>
                ))}
                {retentionPct !== null && (
                  <span
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-full ml-auto"
                    style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ADE80" }}
                    title="Share of reviews you got right in the last 7 days"
                  >
                    <ChartLineUp size={12} weight="fill" aria-hidden="true" />
                    7-day retention {retentionPct}%
                  </span>
                )}
              </div>
            )}

            {/* Honest degraded-source note */}
            {phase !== "loading" && degraded && (
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-400/80 animate-slide-up">
                some review sources could not load right now
              </p>
            )}

            {/* Deep-link filter note (study-set "Review now") */}
            {phase !== "loading" && filtered && (
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.15em] text-cream/50 animate-slide-up">
                reviewing one study set ·{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-cream/80 transition-colors uppercase tracking-[0.15em]"
                  onClick={() => {
                    window.history.replaceState(null, "", "/learn/review");
                    void load();
                  }}
                >
                  review everything instead
                </button>
              </p>
            )}

            {/* LOADING */}
            {phase === "loading" && (
              <div className="space-y-3 animate-slide-up" aria-hidden="true">
                <div className="h-2 rounded-full bg-white/[0.05]" />
                <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] h-40" />
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] h-12" />
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] h-12" />
              </div>
            )}

            {/* ERROR — the queue fetch itself failed (distinct from empty) */}
            {phase === "error" && (
              <div className="text-center py-14 animate-slide-up">
                <div
                  className="w-16 h-16 rounded-full inline-flex items-center justify-center mb-5"
                  style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)" }}
                >
                  <XCircle size={32} weight="fill" color="#F59E0B" aria-hidden="true" />
                </div>
                <p className="font-bebas text-2xl text-cream tracking-wide mb-2">
                  Your queue could not load
                </p>
                <p className="text-cream/60 text-sm font-syne mb-6 max-w-sm mx-auto leading-relaxed">
                  Something went wrong fetching your review queue. Your cards and
                  their schedules are safe on the server.
                </p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="inline-flex items-center gap-2 font-bebas text-base tracking-wider px-6 py-3 rounded-xl transition-all active:scale-[0.99] hover:brightness-110"
                  style={{ background: `${PURPLE}25`, border: `1px solid ${PURPLE}60`, color: "#EEF4FF" }}
                >
                  <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
                  Try again
                </button>
              </div>
            )}

            {/* EMPTY — nothing due (or nothing to review at all) */}
            {phase === "empty" && (
              <div className="text-center py-14 animate-slide-up">
                <div
                  className="w-16 h-16 rounded-full inline-flex items-center justify-center mb-5"
                  style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)" }}
                >
                  <CheckCircle size={32} weight="fill" color="#22C55E" aria-hidden="true" />
                </div>
                {total === 0 && nextDueInMs === null ? (
                  <>
                    <p className="font-bebas text-2xl text-cream tracking-wide mb-2">Nothing to review yet</p>
                    <p className="text-cream/60 text-sm font-syne mb-6 max-w-sm mx-auto leading-relaxed">
                      Missed Ninny questions, saved vocab words, class flashcards, and study
                      set cards all land here so you can drill them until they stick.
                    </p>
                    <Link
                      href="/learn/ninny"
                      className="inline-flex items-center gap-2 font-bebas text-base tracking-wider px-6 py-3 rounded-xl transition-all active:scale-[0.99] hover:brightness-110"
                      style={{ background: `${PURPLE}25`, border: `1px solid ${PURPLE}60`, color: "#EEF4FF" }}
                    >
                      Study with Ninny
                      <ArrowRight size={16} weight="bold" aria-hidden="true" />
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="font-bebas text-2xl text-cream tracking-wide mb-2">All caught up</p>
                    <p className="text-cream/60 text-sm font-syne mb-6 max-w-sm mx-auto leading-relaxed">
                      Nothing is due right now.
                      {nextDueInMs != null && (
                        <> The next card comes back in about {formatDuration(nextDueInMs)}.</>
                      )}
                    </p>
                    <Link
                      href="/learn"
                      className="inline-flex items-center gap-2 font-bebas text-base tracking-wider px-6 py-3 rounded-xl transition-all active:scale-[0.99] hover:brightness-110"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#EEF4FF" }}
                    >
                      Back to Learn
                    </Link>
                  </>
                )}
              </div>
            )}

            {/* ACTIVE — the session loop */}
            {phase === "active" && current && (
              <div className="animate-slide-up" key={`${current.source}-${current.id}`}>
                {/* Progress bar + counter */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">
                      {index + 1} / {items.length}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: PURPLE }}>
                      {current.source === "weak_spot"
                        ? `missed ${current.meta.missCount}×`
                        : sourceLabel(current)}
                    </p>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div
                      className="h-full"
                      style={{
                        width: `${progressPct}%`,
                        background: `linear-gradient(90deg, ${PURPLE}80, ${PURPLE})`,
                        transition: reduceMotion ? "none" : "width 400ms var(--ease-out-emil, cubic-bezier(0.16,1,0.3,1))",
                      }}
                    />
                  </div>
                </div>

                {/* Context tag (material / lang pair / class name) */}
                {sourceContext(current) && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/40 mb-2 truncate">
                    {sourceContext(current)}
                  </p>
                )}

                {/* Question / word card */}
                <div
                  className="rounded-2xl border p-5 sm:p-6 mb-4"
                  style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
                >
                  {current.source === "vocab" && (
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/50 mb-1.5">
                      what does this mean?
                    </p>
                  )}
                  <p className="font-syne text-cream text-lg leading-snug">{current.question}</p>
                </div>

                {/* ── MCQ options (weak spot + study set mcq cards) ── */}
                {((current.source === "weak_spot" && current.kind === "mcq") ||
                  (current.source === "study_set" && current.kind === "set_mcq")) &&
                  current.options && (
                  <div className="space-y-2.5">
                    {current.options.map((opt, i) => {
                      const isChosen = selected === i;
                      const isCorrect = i === current.correctIndex;
                      const answered = selected !== null;
                      let bg = "rgba(255,255,255,0.03)";
                      let border = "rgba(255,255,255,0.08)";
                      let text = "#EEF4FF";
                      if (answered) {
                        if (isCorrect) {
                          bg = "rgba(34,197,94,0.12)";
                          border = "rgba(34,197,94,0.5)";
                        } else if (isChosen) {
                          bg = "rgba(239,68,68,0.12)";
                          border = "rgba(239,68,68,0.5)";
                        } else {
                          text = "rgba(238,244,255,0.4)";
                        }
                      }
                      return (
                        <button
                          key={i}
                          type="button"
                          disabled={answered || grading}
                          onClick={() =>
                            current.source === "study_set"
                              ? handleSelectStudySetOption(i)
                              : handleSelectOption(i)
                          }
                          className="w-full text-left rounded-xl border px-4 py-3.5 min-h-[52px] font-syne text-sm transition-all duration-200 disabled:cursor-default flex items-center gap-3 hover:brightness-110"
                          style={{ background: bg, borderColor: border, color: text }}
                        >
                          <span
                            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center font-mono text-[11px]"
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              color: answered && isCorrect ? "#22C55E" : answered && isChosen ? "#EF4444" : "rgba(238,244,255,0.6)",
                            }}
                          >
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span className="flex-1">{opt}</span>
                          {answered && isCorrect && <CheckCircle size={18} weight="fill" color="#22C55E" aria-hidden="true" />}
                          {answered && isChosen && !isCorrect && <XCircle size={18} weight="fill" color="#EF4444" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ── Reveal-style cards (weak-spot flashcard / vocab / class card / study-set flashcard) ── */}
                {((current.source === "weak_spot" && current.kind === "flashcard") ||
                  current.source === "vocab" ||
                  current.source === "class_flashcard" ||
                  (current.source === "study_set" && current.kind === "set_flashcard")) && (
                  <div>
                    {!revealed ? (
                      <div className="space-y-2.5">
                        {/* Active recall: commit a guess BEFORE the reveal. Optional
                            (empty is fine), but typing it first turns a passive peek
                            into a real retrieval attempt — the whole point of the deck. */}
                        <label htmlFor="recall-guess" className="sr-only">
                          Type your answer before revealing
                        </label>
                        <textarea
                          id="recall-guess"
                          value={guess}
                          onChange={(e) => setGuess(e.target.value)}
                          placeholder="Make your guess first, then reveal…"
                          rows={2}
                          className="w-full resize-none rounded-xl border px-4 py-3 font-syne text-sm text-cream placeholder:text-cream/35 focus:outline-none transition-colors"
                          style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)" }}
                        />
                        <button
                          type="button"
                          onClick={() => setRevealed(true)}
                          className="w-full rounded-xl border px-4 py-4 min-h-[52px] font-bebas text-base tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110"
                          style={{ background: `${PURPLE}18`, borderColor: `${PURPLE}45`, color: "#EEF4FF" }}
                        >
                          <Eye size={18} weight="fill" aria-hidden="true" />
                          {guess.trim() ? "Check my answer" : "Reveal answer"}
                        </button>
                      </div>
                    ) : (
                      <div className="animate-slide-up">
                        {/* Your guess, side by side with the truth, so you grade honestly. */}
                        {guess.trim() && (
                          <div
                            className="rounded-2xl border p-4 mb-3"
                            style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.1)" }}
                          >
                            <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">your guess</p>
                            <p className="font-syne text-cream/85 text-base leading-snug whitespace-pre-wrap">{guess.trim()}</p>
                          </div>
                        )}
                        <div
                          className="rounded-2xl border p-5 mb-4"
                          style={{ background: "rgba(34,197,94,0.08)", borderColor: "rgba(34,197,94,0.35)" }}
                        >
                          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-green-400/80 mb-1.5">answer</p>
                          <p className="font-syne text-cream text-base leading-snug">{current.correctAnswer}</p>
                          {current.source === "vocab" && current.meta.userDefinition && (
                            <p className="font-syne text-cream/60 text-sm leading-relaxed mt-2 italic">
                              Your note: {current.meta.userDefinition}
                            </p>
                          )}
                        </div>
                        {!lastResult && (
                          <>
                            {current.source === "weak_spot" && selfGradeButtons((knewIt) => void gradeWeakSpot({ knewIt }))}
                            {current.source === "vocab" && selfGradeButtons((knewIt) => void gradeVocab(knewIt))}
                            {current.source === "class_flashcard" && ratingButtons}
                            {current.source === "study_set" && selfGradeButtons((knewIt) => void gradeStudySet(knewIt))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Explanation (weak-spot MCQ, after answering) */}
                {current.source === "weak_spot" && current.kind === "mcq" && selected !== null && current.explanation && (
                  <div
                    className="mt-4 rounded-xl border p-4 animate-slide-up"
                    style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/50 mb-1.5">why</p>
                    <p className="font-syne text-cream/75 text-sm leading-relaxed italic">{current.explanation}</p>
                  </div>
                )}

                {/* Explanation (study-set MCQ: the card back, after answering) */}
                {current.source === "study_set" && current.kind === "set_mcq" && selected !== null && current.correctAnswer && (
                  <div
                    className="mt-4 rounded-xl border p-4 animate-slide-up"
                    style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/50 mb-1.5">why</p>
                    <p className="font-syne text-cream/75 text-sm leading-relaxed italic">{current.correctAnswer}</p>
                  </div>
                )}

                {/* Result banner + Next */}
                {lastResult && (
                  <div className="mt-5 animate-slide-up">
                    {!lastResult.success ? (
                      <p className="text-center mb-4 font-syne text-sm text-amber-400/80">
                        That grade did not save. This card stays in your queue.
                      </p>
                    ) : lastResult.mastered ? (
                      <div className="flex items-center gap-2 justify-center mb-4 font-syne text-sm" style={{ color: "#FFD700" }}>
                        <Sparkle size={16} weight="fill" aria-hidden="true" />
                        Mastered. This one is retired from your review deck.
                      </div>
                    ) : lastResult.correct ? (
                      <p className="text-center mb-4 font-syne text-sm text-green-400/90">
                        Nice. You will see this again later, spaced further out.
                        {lastResult.coinsAwarded > 0 && (
                          <span className="block mt-1" style={{ color: "#FFD700" }}>
                            +{lastResult.coinsAwarded} Fangs
                          </span>
                        )}
                      </p>
                    ) : (
                      <p className="text-center mb-4 font-syne text-sm text-red-400/80">
                        No worries. This comes back sooner so it sticks.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleNext}
                      className="w-full font-bebas text-base tracking-wider px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110"
                      style={{ background: `${PURPLE}25`, border: `1px solid ${PURPLE}60`, color: "#EEF4FF" }}
                    >
                      {index + 1 >= items.length ? "Finish review" : "Next"}
                      <ArrowRight size={16} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* DONE — session summary */}
            {phase === "done" && (
              <div className="text-center py-12 animate-slide-up">
                <div
                  className="w-20 h-20 rounded-full inline-flex items-center justify-center mb-5"
                  style={{
                    background: `radial-gradient(circle, ${PURPLE}40 0%, transparent 70%)`,
                    boxShadow: `0 0 40px ${PURPLE}44`,
                    color: PURPLE,
                  }}
                >
                  <Sparkle size={40} weight="fill" aria-hidden="true" color="currentColor" />
                </div>
                <p className="font-bebas text-5xl text-cream tracking-wider mb-1">
                  {correctCount} / {reviewed}
                </p>
                <p className="text-cream/60 text-sm font-syne mb-2">
                  {masteredCount > 0
                    ? `You mastered ${masteredCount} weak spot${masteredCount === 1 ? "" : "s"} this round.`
                    : "Every rep makes the next one easier."}
                </p>
                {/* Active-recall accuracy — only when you actually committed guesses. */}
                {guessAttempts > 0 && (
                  <p className="font-syne text-sm mb-2" style={{ color: "#C79BFF" }}>
                    {Math.round((guessHits / guessAttempts) * 100)}% recall &middot; you nailed {guessHits} of {guessAttempts} guess{guessAttempts === 1 ? "" : "es"} before the reveal
                  </p>
                )}
                {fangsEarned > 0 && (
                  <p className="font-syne text-sm mb-8" style={{ color: "#FFD700" }}>
                    +{fangsEarned} Fangs from vocab reviews
                  </p>
                )}
                {fangsEarned === 0 && <div className="mb-8" />}

                <div className="flex flex-col sm:flex-row gap-2.5 justify-center max-w-md mx-auto">
                  <button
                    type="button"
                    onClick={load}
                    className="flex-1 font-bebas text-base tracking-wider px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110"
                    style={{ background: `${PURPLE}25`, border: `1px solid ${PURPLE}60`, color: "#EEF4FF" }}
                  >
                    <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
                    Review more
                  </button>
                  <Link
                    href="/learn"
                    className="flex-1 font-bebas text-base tracking-wider px-6 py-3 rounded-xl flex items-center justify-center transition-all active:scale-[0.99] hover:brightness-110"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#EEF4FF" }}
                  >
                    Back to Learn
                  </Link>
                </div>
              </div>
            )}

          </div>
        </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
