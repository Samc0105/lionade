"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { CaretLeft, CaretUp, CaretDown, Clock, DotsThree, Sparkle } from "@phosphor-icons/react";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import Confetti from "@/components/Confetti";
import MasteryProgressBar from "@/components/Mastery/MasteryProgressBar";
import SubtopicRail, { type SubtopicRailItem } from "@/components/Mastery/SubtopicRail";
import MasteryMessage, { type MessageShape } from "@/components/Mastery/MasteryMessage";
import MasteryActionArea, { type LiveQuestion } from "@/components/Mastery/MasteryActionArea";
import { useActiveTime } from "@/components/Mastery/useActiveTime";
import SessionReportFab from "@/components/Mastery/StudySheetButton";
import { apiGet, apiPost, swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import type { StudySheetInput, SubtopicSummary } from "@/components/Mastery/studySheetPdf";

// How many chat messages stay visible. Older ones drop off the UI; the full
// thread lives in the DB and surfaces in the Session Report PDF. Tight
// window (3) shows the current Q plus whatever just preceded it — matches
// the "last and current" feel without clutter.
const VISIBLE_MESSAGES = 3;

/**
 * Active Mastery Mode session — the chat thread + progress bar + subtopic rail.
 *
 * Shape of work per tick:
 *  - On mount, resolve examId → active sessionId (POST idempotent)
 *  - Load session snapshot (messages + pending + subtopics)
 *  - If pending=null, auto-call /next once so Ninny opens with a teach/question
 *  - Render the thread, pin the progress bar at top, show the right rail
 *  - MasteryActionArea at the bottom reads `pending` and renders the right input
 *  - useActiveTime sends /heartbeat deltas while the tab is visible + user active
 */

interface Pending {
  type: "teach" | "question" | "socratic";
  messageId?: string;
  subtopicId?: string;
  questionId?: string;
  challengeToken?: string;
  [k: string]: unknown;
}

interface QueuedQuestion {
  questionId: string;
  subtopicId: string;
  subtopicName: string;
  question: string;
  options: string[];
  difficulty: string;
}

interface SessionResponse {
  session: {
    id: string;
    status: string;
    startedAt: string;
    lastActiveAt: string;
    activeSeconds: number;
    questionsAnswered: number;
    correctCount: number;
    teachingPanelsShown: number;
    explanationsShown: number;
    socraticTurnsSpent: number;
    startingPPass: number | null;
    currentPPass: number | null;
    reachedMasteryAt: string | null;
    pending: Pending | null;
  };
  exam: {
    id: string;
    title: string;
    readyThreshold: number;
    masteryBktTarget: number;
    targetDate: string | null;
    totalActiveSeconds: number;
    reachedMasteryAt: string | null;
  };
  subtopics: {
    id: string; slug: string; name: string; weight: number; shortSummary: string | null;
    pMastery: number; attempts: number; correct: number; currentStreak: number;
    displayPct: number;
  }[];
  messages: MessageShape[];
  pPass: number;
  overallDisplayPct: number;
  ready: boolean;
  mastered: boolean;
}

export default function MasterySessionPage() {
  const params = useParams<{ examId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const examId = params?.examId;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);

  // Resolve active session on mount (idempotent)
  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    (async () => {
      const r = await apiPost<{ sessionId: string; resumed: boolean }>(
        `/api/mastery/exams/${examId}/sessions`, {},
      );
      if (cancelled) return;
      if (!r.ok || !r.data?.sessionId) {
        setBootError(r.error || "Couldn't start session");
        return;
      }
      setSessionId(r.data.sessionId);
    })();
    return () => { cancelled = true; };
  }, [examId]);

  // Heartbeat
  useActiveTime(sessionId);

  // Session snapshot — SWR keeps this fresh on focus + after each mutation
  const { data, mutate, isLoading } = useSWR<SessionResponse>(
    sessionId ? `/api/mastery/sessions/${sessionId}` : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  // Live question state — populated when pending is a question
  const [liveQuestion, setLiveQuestion] = useState<LiveQuestion | null>(null);
  useEffect(() => {
    if (!data) { setLiveQuestion(null); return; }
    const pending = data.session.pending;
    if (pending?.type !== "question") { setLiveQuestion(null); return; }
    const msg = data.messages.find(m => m.id === pending.messageId);
    if (!msg || msg.kind !== "question") { setLiveQuestion(null); return; }
    const p = msg.payload as { options?: string[]; difficulty?: string; subtopicName?: string; challengeToken?: string; questionId?: string };
    if (!p?.options || !p?.questionId || !pending.challengeToken) { setLiveQuestion(null); return; }
    setLiveQuestion({
      questionId: p.questionId,
      options: p.options,
      subtopicName: p.subtopicName,
      difficulty: p.difficulty,
      challengeToken: pending.challengeToken,
    });
  }, [data]);

  // Auto-advance: if no messages yet OR latest Ninny message is a teach/text
  // AND nothing is pending, kick off /next to produce the opening move.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!data || !sessionId) return;
    if (autoStartedRef.current) return;
    const pending = data.session.pending;
    const lastMsg = data.messages[data.messages.length - 1];
    const needsFirstMove = !lastMsg || (lastMsg.kind === "text" && (lastMsg.payload as { opening?: boolean })?.opening);
    if (!pending && needsFirstMove && !data.mastered) {
      autoStartedRef.current = true;
      void doNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sessionId]);

  // Scroll behavior:
  //   - First render with data → leave scrollTop at 0 so the intro message's
  //     top is fully visible (was getting clipped before because we auto-
  //     scrolled to bottom on mount).
  //   - Subsequent message-count changes → scroll so the NEWEST message's top
  //     is aligned with the top of the scroll container. That way tall teach
  //     cards never have their header cut off, and short messages still read
  //     naturally from the top down.
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !data?.messages.length) return;

    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      el.scrollTop = 0;
      return;
    }

    const last = el.lastElementChild as HTMLElement | null;
    if (!last) return;
    el.scrollTo({
      top: Math.max(0, last.offsetTop - 8),
      behavior: "smooth",
    });
  }, [data?.messages.length]);

  // ── Pre-fetch queue ──────────────────────────────────────────────────────
  //    We stage N upcoming questions client-side so the gap between answering
  //    one and seeing the next feels instant. The queue holds fully-shaped
  //    question data; when the user advances we pass `preferredQuestionId` to
  //    /next, which promotes the queued question into the live pending state.
  const [queue, setQueue] = useState<QueuedQuestion[]>([]);
  const queueInFlightRef = useRef(false);

  const refillQueue = useCallback(
    async (strategy: "next" | "reinforce", lastSubtopicId?: string) => {
      if (!sessionId || queueInFlightRef.current) return;
      queueInFlightRef.current = true;
      try {
        const avoidIds = queue.map(q => q.questionId);
        const r = await apiPost<{ questions: QueuedQuestion[] }>(
          `/api/mastery/sessions/${sessionId}/prefetch`,
          { strategy, lastSubtopicId, count: 5, avoidIds },
        );
        if (r.ok && r.data?.questions?.length) {
          const fresh = r.data.questions;
          setQueue(prev => {
            const seen = new Set(prev.map(q => q.questionId));
            return [...prev, ...fresh.filter(q => !seen.has(q.questionId))];
          });
        }
      } finally {
        queueInFlightRef.current = false;
      }
    },
    [sessionId, queue],
  );

  // Kick off the first pre-fetch once the session is live. The effect re-fires
  // if the queue drops below 2, which keeps it warm across turns.
  useEffect(() => {
    if (!sessionId || !data) return;
    if (queue.length >= 2) return;
    void refillQueue("next");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, data?.session.id, queue.length]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);

  // /next response shape — kept local so we can drive optimistic updates
  // off it without going back to the server for a fresh snapshot.
  type NextResponse = {
    kind: string;
    message?: MessageShape;
    subtopicId?: string;
    challengeToken?: string;
  };

  /**
   * Ask the orchestrator for the next card and render it optimistically —
   * no refetch, no spinner between answer and next. The server response
   * carries every field we need (new message + challengeToken + subtopicId),
   * so we splice it directly into SWR's cached snapshot with
   * `{ revalidate: false }`. A background revalidation fires eventually
   * via SWR's focus/interval strategies and would paper over any drift.
   */
  const doNext = useCallback(
    async (opts?: { preferredQuestionId?: string }) => {
      if (!sessionId || busy) return;
      setBusy(true);
      try {
        const body: Record<string, unknown> = {};
        if (opts?.preferredQuestionId) body.preferredQuestionId = opts.preferredQuestionId;
        const r = await apiPost<NextResponse>(
          `/api/mastery/sessions/${sessionId}/next`, body,
        );
        if (r.ok && r.data?.kind === "celebrate") setCelebrateKey(k => k + 1);
        if (r.ok && r.data?.kind === "question" && r.data.message && r.data.challengeToken && r.data.subtopicId) {
          const msg = r.data.message;
          const token = r.data.challengeToken;
          const subtopicId = r.data.subtopicId;
          const questionId = (msg.payload as { questionId?: string } | null)?.questionId;
          mutate((current) => {
            if (!current) return current;
            return {
              ...current,
              messages: [...current.messages, msg],
              session: {
                ...current.session,
                pending: questionId ? {
                  type: "question",
                  messageId: msg.id,
                  subtopicId,
                  questionId,
                  challengeToken: token,
                } : current.session.pending,
              },
            };
          }, { revalidate: false });
        } else if (r.ok && r.data?.kind === "teach" && r.data.message) {
          const msg = r.data.message;
          mutate((current) => {
            if (!current) return current;
            return {
              ...current,
              messages: [...current.messages, msg],
              session: { ...current.session, pending: null },
            };
          }, { revalidate: false });
        } else {
          // Celebrate or unknown — do a real refetch to stay safe.
          void mutate();
        }
      } finally { setBusy(false); }
    },
    [sessionId, busy, mutate],
  );

  /** /answer response shape for local typing. */
  type AnswerResponse = {
    wasCorrect: boolean;
    correctIndex: number;
    explanation: string;
    pPass: number;
    displayPct: number;
    pMasteryForSubtopic: number;
    streakAtSubtopic: number;
    socraticProbe: boolean;
    answerMessage: MessageShape | null;
    feedbackMessage: MessageShape | null;
    socraticProbeMessage: MessageShape | null;
  };

  const doAnswer = useCallback(async (selectedIndex: number) => {
    if (!sessionId || !liveQuestion || busy) return;
    // Snapshot subtopic BEFORE mutating; after the optimistic update,
    // liveQuestion might be about to change.
    const answeredSubtopicId = data?.session.pending?.subtopicId ?? null;
    setBusy(true);
    try {
      const r = await apiPost<AnswerResponse>(
        `/api/mastery/sessions/${sessionId}/answer`,
        { selectedIndex, challengeToken: liveQuestion.challengeToken },
      );
      if (!r.ok || !r.data) return;
      const ans = r.data;

      // OPTIMISTIC UPDATE — splice the answer + feedback messages into the
      // SWR cache directly. No network refetch, no 300ms wait, feedback
      // renders the instant /answer resolves.
      mutate((current) => {
        if (!current) return current;
        const newMessages = [...current.messages];
        if (ans.answerMessage) newMessages.push(ans.answerMessage);
        if (ans.feedbackMessage) newMessages.push(ans.feedbackMessage);
        if (ans.socraticProbeMessage) newMessages.push(ans.socraticProbeMessage);
        return {
          ...current,
          messages: newMessages,
          pPass: ans.pPass,
          overallDisplayPct: ans.displayPct,
          session: {
            ...current.session,
            pending: ans.socraticProbe && ans.socraticProbeMessage
              ? {
                  type: "socratic",
                  messageId: ans.socraticProbeMessage.id,
                  subtopicId: answeredSubtopicId ?? undefined,
                  questionId: liveQuestion.questionId,
                }
              : null,
            currentPPass: ans.pPass,
            questionsAnswered: current.session.questionsAnswered + 1,
            correctCount: current.session.correctCount + (ans.wasCorrect ? 1 : 0),
            socraticTurnsSpent: current.session.socraticTurnsSpent + (ans.socraticProbe ? 1 : 0),
          },
        };
      }, { revalidate: false });

      if (ans.socraticProbe) {
        // Wait for user text reply. Queue stays as-is (still valid).
        return;
      }

      // Pick the next question from the pre-fetched queue.
      const wasCorrect = ans.wasCorrect;
      let nextQId: string | undefined;

      if (!wasCorrect && answeredSubtopicId) {
        // Reinforce: promote a queued question from the SAME subtopic.
        const sameTopicIdx = queue.findIndex(q => q.subtopicId === answeredSubtopicId);
        if (sameTopicIdx >= 0) {
          nextQId = queue[sameTopicIdx].questionId;
          setQueue(q => q.filter((_, i) => i !== sameTopicIdx));
        }
        void refillQueue("reinforce", answeredSubtopicId);
      } else {
        if (queue.length > 0) {
          nextQId = queue[0].questionId;
          setQueue(q => q.slice(1));
        }
        void refillQueue("next", answeredSubtopicId ?? undefined);
      }

      // doNext ALSO uses optimistic updates, so the next question appears
      // the instant /next resolves (~200-400ms on a cache hit). `busy`
      // stays true through both calls so the action area doesn't flicker
      // to the "Continue" state between feedback and the new question.
      await doNext({ preferredQuestionId: nextQId });
    } finally { setBusy(false); }
  }, [sessionId, liveQuestion, busy, data?.session.pending?.subtopicId, queue, mutate, doNext, refillQueue]);

  const doSocratic = async (reply: string) => {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/mastery/sessions/${sessionId}/socratic`, { reply });
      await mutate();
      // Auto-advance after Ninny's socratic follow-up
      void doNext();
    } finally { setBusy(false); }
  };

  // ── Derived display values (MUST be computed before any early return so
  //    hook order stays stable across renders when data arrives) ────────────
  const stats = useStatsBits(data);

  // ── Render ───────────────────────────────────────────────────────────────
  if (bootError) {
    return (
      <div className="min-h-screen bg-navy text-cream pt-12">
        <Navbar />
        <main className="max-w-[720px] mx-auto px-6 py-24 text-center">
          <h1 className="font-bebas text-3xl tracking-wider mb-3">Couldn't load this session</h1>
          <p className="text-[14px] text-cream/60 mb-6">{bootError}</p>
          <Link href="/learn/mastery" className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold hover:underline">
            Back to Mastery Mode
          </Link>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <Navbar />
        <main className="max-w-[980px] mx-auto px-6 py-10">
          <div className="h-5 w-28 bg-white/[0.06] rounded-full mb-5 animate-pulse" />
          <div className="h-12 w-80 bg-white/[0.06] rounded-md mb-4 animate-pulse" />
          <div className="h-[6px] w-full bg-white/[0.06] rounded-full mb-8 animate-pulse" />
          <div className="space-y-3">
            {[0,1,2].map(i => <div key={i} className="h-16 w-full bg-white/[0.04] rounded-lg animate-pulse" />)}
          </div>
        </main>
      </div>
    );
  }

  const subtopicItems: SubtopicRailItem[] = data.subtopics.map(s => ({
    id: s.id, name: s.name, weight: s.weight, displayPct: s.displayPct, attempts: s.attempts,
  }));
  // Only highlight the active subtopic in the rail when Ninny is teaching
  // it — for questions, hiding which subtopic is being tested is the point
  // (no free hints).
  const activeSubtopicId =
    data.session.pending?.type === "teach"
      ? (data.session.pending?.subtopicId ?? null)
      : null;
  const ended = data.session.status !== "active";

  // Build the Study Sheet input on-demand (passed as a thunk so the PDF
  // module stays decoupled from the page's live state).
  const buildStudySheet = (): StudySheetInput | null => {
    if (!data) return null;
    const subtopics: SubtopicSummary[] = data.subtopics.map(s => ({
      name: s.name,
      weight: s.weight,
      pMastery: s.pMastery,
      displayPct: s.displayPct,
      attempts: s.attempts,
      correct: s.correct,
    }));
    return {
      examTitle: data.exam.title,
      overallDisplayPct: data.overallDisplayPct,
      pPass: data.pPass,
      readyThreshold: data.exam.readyThreshold,
      sessionDurationSec: data.session.activeSeconds,
      questionsAnswered: data.session.questionsAnswered,
      correctCount: data.session.correctCount,
      subtopics,
      messages: data.messages,
    };
  };

  return (
    // Viewport-height flex column: no page scroll, inner scroll containers
    // handle all overflow. `pt-12` clears the fixed 48-px Navbar. `pb-14` on
    // mobile leaves room for the fixed Navbar bottom nav; on desktop we only
    // need room for the fixed stats bar (~40 px).
    <div className="h-screen bg-navy text-cream overflow-x-hidden overflow-y-hidden flex flex-col pt-12 pb-14 md:pb-10">
      <SpaceBackground />
      <Navbar />

      {/* Top bar — now a regular shrink-0 flex item. No more sticky overlap:
          the chat below can't scroll behind it because the chat has its own
          independent overflow. */}
      <div className="shrink-0 z-20 bg-navy/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 pt-3 pb-2.5">
          {!headerCollapsed && (
            <div className="flex items-center justify-between gap-3 mb-2">
              <Link
                href="/learn/mastery"
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream transition-colors"
              >
                <CaretLeft size={12} weight="bold" /> Mastery
              </Link>
              <h1 className="font-bebas text-xl sm:text-2xl tracking-wider text-cream truncate">
                {data.exam.title}
              </h1>
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50">
                <Clock size={12} weight="bold" />
                <span className="tabular-nums">{stats.timeLabel}</span>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <MasteryProgressBar
                value={data.overallDisplayPct}
                readyThreshold={data.exam.readyThreshold}
                label={data.mastered ? "Mastered" : data.ready ? "Ready" : "Progress"}
              />
            </div>
            <button
              type="button"
              onClick={() => setHeaderCollapsed(c => !c)}
              aria-label={headerCollapsed ? "Expand header" : "Collapse header"}
              aria-expanded={!headerCollapsed}
              className="shrink-0 grid place-items-center w-7 h-7 rounded-full border border-white/[0.08] text-cream/50 hover:text-cream hover:border-white/[0.2] transition-colors"
            >
              {headerCollapsed
                ? <CaretDown size={12} weight="bold" />
                : <CaretUp size={12} weight="bold" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main fills remaining vertical space. min-h-0 on every flex-chain
          parent is essential for flex-1 children to actually constrain their
          height (otherwise flex-grow items can overflow). */}
      <main className="flex-1 min-h-0 relative z-10 w-full max-w-[1080px] mx-auto px-4 sm:px-6 pt-4 pb-3 flex flex-col">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 flex-1 min-h-0">
          {/* Chat column */}
          <section className="flex flex-col min-h-0">
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 space-y-4 pt-2 pr-1 overflow-y-auto"
            >
              {/* Only render the tail of the thread — keeps the session
                  surface minimal and makes "Session Report" the canonical
                  place to retrieve older material. `allMessages` still passes
                  the full thread so HistoricalQuestion can pair each question
                  with its (possibly older) answer + feedback records. */}
              {data.messages.length > VISIBLE_MESSAGES && (
                <div className="pl-[40px]">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/30">
                    {data.messages.length - VISIBLE_MESSAGES} earlier · full thread in Session Report
                  </span>
                </div>
              )}
              {data.messages.slice(-VISIBLE_MESSAGES).map(m => (
                <MasteryMessage key={m.id} message={m} allMessages={data.messages} />
              ))}
              {busy && (
                <div className="flex gap-3 items-center pl-[40px]">
                  <DotsThree size={20} className="text-[#A855F7] animate-pulse" weight="bold" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40">
                    Ninny's thinking…
                  </span>
                </div>
              )}
            </div>

            {/* Action area — shrink-0 so it never gets squeezed by the scroll
                container. Sits directly below the messages. No separator line
                (keeps the chat feeling airy; the visual grouping is carried
                by the option-button card styles themselves). */}
            <div className="shrink-0 mt-4 pt-2">
              {ended ? (
                <div className="rounded-[10px] bg-white/[0.03] border border-white/[0.06] px-4 py-4 text-center">
                  <p className="text-[13px] text-cream/70 mb-3">Session closed. Start a new one anytime.</p>
                  <Link
                    href="/learn/mastery"
                    className="inline-block rounded-full bg-gold text-navy font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5"
                  >
                    Back to Mastery
                  </Link>
                </div>
              ) : (
                <MasteryActionArea
                  pending={data.session.pending}
                  liveQuestion={liveQuestion}
                  disabled={busy}
                  onContinue={doNext}
                  onAnswer={doAnswer}
                  onSocraticSubmit={doSocratic}
                />
              )}
            </div>
          </section>

          {/* Right rail — desktop only; on mobile the aggregate bar at the
              top plus the confidence figure is enough signal. Scrollable so
              long subtopic lists don't blow out the column height. */}
          <SubtopicRail
            items={subtopicItems}
            activeSubtopicId={activeSubtopicId}
            className="hidden lg:flex lg:min-h-0 lg:overflow-y-auto lg:self-start lg:max-h-full"
          />
        </div>
      </main>

      {/* Fixed bottom session-stats bar. Sits ABOVE the mobile nav on phones
          (bottom-14) and at bottom-0 on desktop. The outer h-screen flex
          reserves pb-14 (mobile) / pb-10 (desktop) so nothing is covered. */}
      <div
        role="status"
        aria-label="Session stats"
        className="fixed left-0 right-0 bottom-14 md:bottom-0 z-30 bg-navy/90 backdrop-blur-md border-t border-white/[0.06]"
      >
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50">
          <span><span className="tabular-nums text-cream/80">{data.session.questionsAnswered}</span> Qs</span>
          <span><span className="tabular-nums text-cream/80">{data.session.correctCount}</span> right</span>
          <span><span className="tabular-nums text-cream/80">{data.session.teachingPanelsShown}</span> taught</span>
          <span><span className="tabular-nums text-cream/80">{stats.sessionTime}</span> this session</span>
          {data.session.reachedMasteryAt && (
            <span className="text-gold flex items-center gap-1 ml-auto">
              <Sparkle size={10} weight="fill" /> Mastered
            </span>
          )}
        </div>
      </div>

      {/* Session Report FAB — sits above the fixed stats bar. Visible to
          everyone; locked below 33% mastery, then paywalled for free users. */}
      <SessionReportFab
        userId={user?.id}
        buildInput={buildStudySheet}
        overallPct={data.overallDisplayPct}
      />

      {/* Celebration confetti on mastery — key forces remount so it re-fires */}
      <Confetti
        key={celebrateKey}
        trigger={celebrateKey > 0}
        origin="center"
        palette={["#FFD700", "#A855F7", "#4A90D9"]}
      />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function useStatsBits(data: SessionResponse | undefined) {
  const totalExam = data?.exam.totalActiveSeconds ?? 0;
  const sessionActive = data?.session.activeSeconds ?? 0;
  return useMemo(() => {
    const fmt = (sec: number) => {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      if (h > 0) return `${h}h ${m}m`;
      if (m > 0) return `${m}m`;
      return `${sec}s`;
    };
    return {
      timeLabel: fmt(totalExam),
      sessionTime: fmt(sessionActive),
    };
  }, [totalExam, sessionActive]);
}
