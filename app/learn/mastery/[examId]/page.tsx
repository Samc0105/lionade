"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { CaretLeft, CaretUp, CaretDown, Clock, Sparkle, ShareNetwork } from "@phosphor-icons/react";
import SpaceBackground from "@/components/SpaceBackground";
import dynamic from "next/dynamic";
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });
const ShareCard = dynamic(() => import("@/components/ShareCard"), { ssr: false });
import MasteryProgressBar from "@/components/Mastery/MasteryProgressBar";
import SubtopicRail, { type SubtopicRailItem } from "@/components/Mastery/SubtopicRail";
import MasteryMessage, { type MessageShape } from "@/components/Mastery/MasteryMessage";
import MasteryActionArea, { type LiveQuestion, type AnswerOutcome, type HintResult } from "@/components/Mastery/MasteryActionArea";
import ConfirmModal from "@/components/ConfirmModal";
import { useActiveTime } from "@/components/Mastery/useActiveTime";
import SessionReportFab from "@/components/Mastery/StudySheetButton";
import NinnyThinking, { MasteryNotesFooter } from "@/components/Mastery/NinnyThinking";
import type { ThinkingContext } from "@/lib/mastery/thinking-phrases";
import { apiGet, apiPost, swrFetcher } from "@/lib/api-client";
import { readStoredSessionSync } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useHeartbeat } from "@/lib/use-heartbeat";
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
  /** Mastery Hint Pack — hints the user has left to spend in the action area. */
  hintsRemaining?: number;
  pPass: number;
  overallDisplayPct: number;
  ready: boolean;
  mastered: boolean;
}

export default function MasterySessionPage() {
  const params = useParams<{ examId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const examId = params?.examId;

  // If we got here from a class notebook, the URL carries ?classId=<uuid>.
  // We use it to keep the back-link pointed at the class instead of the
  // generic /learn/mastery landing.
  const classIdContext = searchParams?.get("classId") ?? null;
  const backHref = classIdContext ? `/classes/${classIdContext}` : "/learn/mastery";
  const backLabel = classIdContext ? "Class" : "Mastery";

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootRetrying, setBootRetrying] = useState(false);
  const [celebrateKey, setCelebrateKey] = useState(0);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Recoverable, in-session action error (a /next, /answer, or /socratic call
  // failed). Surfaced as an inline banner above the action area with a retry
  // affordance. Distinct from bootError, which is a hard "couldn't start" wall.
  // Init null (not "") so the banner never flashes empty before data lands.
  const [actionError, setActionError] = useState<string | null>(null);
  // Confirm gate for ending the session (grants the reward + closes it).
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);

  // Tier 3 refresh-resumable scratch state — restored from
  // /api/mastery/sessions/:id/state on mount and re-saved (debounced) on
  // every keystroke inside the socratic textarea. Only the partial draft
  // is restored — the question + thread come from the regular session GET.
  const [socraticInitial, setSocraticInitial] = useState<string>("");
  const stateHydratedRef = useRef(false);
  const partialDraftRef = useRef<string>("");
  const stateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest debounced /state payload + endpoint, kept current so the unmount
  // cleanup can flush it (the timer is cleared on unmount before it would
  // otherwise fire). Null when no save is pending.
  const pendingStateSaveRef = useRef<{ path: string; body: Record<string, unknown> } | null>(null);

  // Resolve active session (idempotent POST). Shared by the mount effect and
  // the bootError "Try again" button so a transient resolve failure isn't a
  // dead end. Returns whether it succeeded so callers can manage retry UI.
  const resolveSession = useCallback(async (): Promise<boolean> => {
    if (!examId) return false;
    const r = await apiPost<{ sessionId: string; resumed: boolean }>(
      `/api/mastery/exams/${examId}/sessions`, {},
    );
    if (!r.ok || !r.data?.sessionId) {
      setBootError(r.error || "Couldn't start session");
      return false;
    }
    setBootError(null);
    setSessionId(r.data.sessionId);
    return true;
  }, [examId]);

  // Resolve active session on mount (idempotent)
  useEffect(() => {
    if (!examId) return;
    let cancelled = false;
    (async () => {
      const ok = await resolveSession();
      if (cancelled) void ok; // resolveSession's setState is harmless post-unmount; nothing else to undo
    })();
    return () => { cancelled = true; };
  }, [examId, resolveSession]);

  // bootError "Try again" handler — re-runs the resolve and shows a pending
  // state on the button while in flight.
  const retryBoot = useCallback(async () => {
    if (bootRetrying) return;
    setBootRetrying(true);
    try {
      await resolveSession();
    } finally {
      setBootRetrying(false);
    }
  }, [bootRetrying, resolveSession]);

  // Heartbeat (mastery-specific elapsed-time tracker)
  useActiveTime(sessionId);

  // Heartbeat (Tier 1 lifecycle — Phase 1 — 2026-06-04).
  // Distinct from useActiveTime, which posts elapsed-seconds deltas to the
  // mastery session table. This one posts presence pings to the universal
  // /api/presence/heartbeat endpoint so the AFK reaper knows the user is
  // still here.
  useHeartbeat(sessionId ? "mastery_session" : null, sessionId);

  // Phase 2 Tier 3 — refresh-resumable state hydration. Pull any saved
  // partial textarea draft (only set when the user was mid-socratic on a
  // previous tab session). One-shot per sessionId.
  useEffect(() => {
    if (!sessionId || stateHydratedRef.current) return;
    let cancelled = false;
    (async () => {
      type StateResp = {
        state: { currentQuestionId: string | null; partialAnswer: string | null } | null;
      };
      const r = await apiGet<StateResp>(`/api/mastery/sessions/${sessionId}/state`);
      if (cancelled) return;
      stateHydratedRef.current = true;
      if (r.ok && r.data?.state?.partialAnswer) {
        setSocraticInitial(r.data.state.partialAnswer);
        partialDraftRef.current = r.data.state.partialAnswer;
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

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

  // Tier 3 — debounced state-save (500ms) called from MasteryActionArea on
  // every textarea keystroke. We persist the partial draft + the current
  // question pointer + running counts so a refresh restores. Today the
  // session row already carries runtime_state.pending so the question
  // survives refresh natively; the partial_answer is the value-add here.
  const persistMasteryState = useCallback((draft: string) => {
    partialDraftRef.current = draft;
    if (!sessionId) return;
    if (stateSaveTimerRef.current) clearTimeout(stateSaveTimerRef.current);
    const currentQuestionId = (data?.session.pending as { questionId?: string } | null)?.questionId ?? null;
    // Stage the latest payload so the unmount flush can fire it if the user
    // navigates away inside the debounce window.
    pendingStateSaveRef.current = {
      path: `/api/mastery/sessions/${sessionId}/state`,
      body: {
        current_question_id: currentQuestionId,
        partial_answer: partialDraftRef.current || null,
        answered_count: data?.session.questionsAnswered ?? 0,
        correct_count: data?.session.correctCount ?? 0,
      },
    };
    stateSaveTimerRef.current = setTimeout(() => {
      const staged = pendingStateSaveRef.current;
      pendingStateSaveRef.current = null;
      if (staged) {
        // Re-read the draft at fire time so the body reflects the freshest
        // keystroke (it may have advanced since this save was staged).
        staged.body.partial_answer = partialDraftRef.current || null;
        void apiPost(staged.path, staged.body);
      }
    }, 500);
  }, [sessionId, data?.session.pending, data?.session.questionsAnswered, data?.session.correctCount]);

  // Flush the pending save on unmount so the last (up to 500ms) of keystrokes
  // aren't lost when the user navigates away. clearTimeout alone would discard
  // them; here we fire the staged payload immediately via fetch keepalive so
  // it survives the navigation/teardown. The auth token is read synchronously
  // from storage (apiPost's async getSession() can't complete during teardown).
  useEffect(() => {
    return () => {
      if (stateSaveTimerRef.current) {
        clearTimeout(stateSaveTimerRef.current);
        stateSaveTimerRef.current = null;
      }
      if (prefetchRearmTimerRef.current) {
        clearTimeout(prefetchRearmTimerRef.current);
        prefetchRearmTimerRef.current = null;
      }
      const staged = pendingStateSaveRef.current;
      pendingStateSaveRef.current = null;
      if (staged && typeof window !== "undefined") {
        staged.body.partial_answer = partialDraftRef.current || null;
        const token = readStoredSessionSync()?.access_token;
        try {
          void fetch(staged.path, {
            method: "POST",
            keepalive: true,
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(staged.body),
          });
        } catch {
          // Best-effort flush — nothing actionable if the browser refuses it.
        }
      }
    };
  }, []);

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

  // Cold-cache backoff guard. If a refill returns zero NEW usable questions
  // (cold AI cache, or everything got de-duped against avoidIds), the
  // warming effect would otherwise re-fire instantly — queue.length is still
  // < 2, so its dependency never changes — and tight-loop the (expensive,
  // Claude-backed) prefetch endpoint. We stamp a cooldown deadline on a
  // zero-yield refill and a monotonically-increasing "re-arm" counter that
  // the warming effect waits on, so a cold cache can't spin the endpoint.
  const prefetchCoolUntilRef = useRef(0);
  const prefetchRearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [prefetchRearm, setPrefetchRearm] = useState(0);
  const PREFETCH_COOLDOWN_MS = 8000;

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
        let addedCount = 0;
        if (r.ok && r.data?.questions?.length) {
          const fresh = r.data.questions;
          setQueue(prev => {
            const seen = new Set(prev.map(q => q.questionId));
            const additions = fresh.filter(q => !seen.has(q.questionId));
            addedCount = additions.length;
            return additions.length ? [...prev, ...additions] : prev;
          });
        }
        if (addedCount > 0) {
          // Real progress: clear any cooldown so warming resumes immediately.
          prefetchCoolUntilRef.current = 0;
        } else {
          // Zero new questions: back off so the warming effect can't re-fire
          // until the cooldown elapses. Schedule a single re-arm tick that
          // changes the effect's dependency so it re-evaluates exactly once
          // after the window (rather than spinning).
          prefetchCoolUntilRef.current = Date.now() + PREFETCH_COOLDOWN_MS;
          if (prefetchRearmTimerRef.current) clearTimeout(prefetchRearmTimerRef.current);
          prefetchRearmTimerRef.current = setTimeout(
            () => setPrefetchRearm(n => n + 1),
            PREFETCH_COOLDOWN_MS,
          );
        }
      } finally {
        queueInFlightRef.current = false;
      }
    },
    [sessionId, queue],
  );

  // Kick off the first pre-fetch once the session is live. The effect re-fires
  // if the queue drops below 2, which keeps it warm across turns. The cooldown
  // ref (set when a refill yields zero new questions) prevents a cold cache
  // from tight-looping the prefetch endpoint: while inside the cooldown the
  // effect no-ops, and a scheduled re-arm tick (prefetchRearm) re-evaluates it
  // once the window elapses.
  useEffect(() => {
    if (!sessionId || !data) return;
    if (queue.length >= 2) return;
    if (Date.now() < prefetchCoolUntilRef.current) return;
    void refillQueue("next");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, data?.session.id, queue.length, prefetchRearm]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);

  // Each false→true transition of `busy` is a new "Ninny is thinking" event.
  // We bump a counter so the <NinnyThinking> below remounts (fresh phrase +
  // animation + new scratchpad note row) per thinking window.
  const [thinkingKey, setThinkingKey] = useState(0);
  const prevBusyRef = useRef(false);
  useEffect(() => {
    if (busy && !prevBusyRef.current) setThinkingKey(k => k + 1);
    prevBusyRef.current = busy;
  }, [busy]);

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
      setActionError(null);
      try {
        const body: Record<string, unknown> = {};
        if (opts?.preferredQuestionId) body.preferredQuestionId = opts.preferredQuestionId;
        const r = await apiPost<NextResponse>(
          `/api/mastery/sessions/${sessionId}/next`, body,
        );
        if (!r.ok) {
          // /next failed (commonly a 500 when AI generation hiccups). Surface a
          // recoverable banner with a retry affordance instead of silently
          // swallowing it behind a background mutate(). On a 409 (session no
          // longer active / stale state) resync the snapshot too.
          setActionError(r.error || "Ninny couldn't load the next step. Try again.");
          if (r.status === 409) void mutate();
          return;
        }
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

  const doAnswer = useCallback(async (selectedIndex: number): Promise<AnswerOutcome | { ok: false }> => {
    if (!sessionId || !liveQuestion || busy) return { ok: false };
    // Snapshot subtopic BEFORE mutating; after the optimistic update,
    // liveQuestion might be about to change.
    const answeredSubtopicId = data?.session.pending?.subtopicId ?? null;
    setBusy(true);
    setActionError(null);
    try {
      const r = await apiPost<AnswerResponse>(
        `/api/mastery/sessions/${sessionId}/answer`,
        { selectedIndex, challengeToken: liveQuestion.challengeToken },
      );
      if (!r.ok || !r.data) {
        // Submit failed: 500 (record error), 401 (expired auth), 409 (no
        // pending / token mismatch), or a network drop. Surface an inline
        // banner AND return { ok: false } so QuestionOptionsBody clears its
        // picked/outcome state and re-enables the buttons for a retry. On a
        // 409 the client's `pending` is stale, so resync via mutate() — the
        // question may have already been consumed server-side.
        setActionError(
          r.status === 409
            ? "That question already moved on. Reloading the latest step."
            : r.error || "Couldn't record that answer. Try again.",
        );
        if (r.status === 409) void mutate();
        return { ok: false };
      }
      const ans = r.data;
      // Capture the outcome to return to QuestionOptions for its
      // green/red feedback animation. Returned at end of try block.
      const outcomeForUi = { wasCorrect: ans.wasCorrect, correctIndex: ans.correctIndex };

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
        return outcomeForUi;
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
      //
      // We FIRE doNext but don't await it here — that way the doAnswer
      // promise resolves immediately after /answer returns, letting the
      // option-card feedback animation render before the new question
      // remounts the button. doNext flips `busy` itself; we leave busy
      // true via a no-op finally so the action area doesn't flicker.
      void doNext({ preferredQuestionId: nextQId });
      return outcomeForUi;
    } finally { setBusy(false); }
  }, [sessionId, liveQuestion, busy, data?.session.pending?.subtopicId, queue, mutate, doNext, refillQueue]);

  // Mastery Hint Pack — spend one hint to eliminate a wrong option on the live
  // question. The server returns a WRONG index (never the answer); we reflect
  // the new remaining count in the cache so it stays right across questions.
  const doHint = useCallback(
    async (): Promise<HintResult | null> => {
      // Server owns the eliminated set (keyed to the pending question), so we
      // send only the challenge token. busy-guarded for symmetry with
      // doAnswer/doNext so a hint can't fire during a question transition.
      if (!sessionId || !liveQuestion || busy) return null;
      setActionError(null);
      try {
        const r = await apiPost<HintResult>(
          `/api/mastery/sessions/${sessionId}/hint`,
          { challengeToken: liveQuestion.challengeToken },
        );
        if (!r.ok || !r.data) {
          setActionError(r.error || "Couldn't use a hint. Try again.");
          return null;
        }
        const res = r.data;
        mutate(
          (current) => (current ? { ...current, hintsRemaining: res.hintsRemaining } : current),
          { revalidate: false },
        );
        return res;
      } catch {
        setActionError("Couldn't use a hint. Try again.");
        return null;
      }
    },
    [sessionId, liveQuestion, busy, mutate],
  );

  const doSocratic = async (reply: string) => {
    if (!sessionId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await apiPost(`/api/mastery/sessions/${sessionId}/socratic`, { reply });
      if (!r.ok) {
        // Submit failed (500, 401, 409 no-probe-pending, 429 rate-limit, or a
        // network drop). Surface a banner and THROW so SocraticInput.send's
        // setText("") never runs — the user's typed reasoning stays in the
        // textarea for a retry. We deliberately do NOT clear partialDraftRef
        // or post partial_answer:null until we've confirmed success, so a
        // failed submit never wipes the persisted draft either. On a 409
        // (probe already consumed) resync so the UI reflects the real state.
        setActionError(
          r.status === 429
            ? "Easy there. Give Ninny a moment before sending again."
            : r.error || "Couldn't send your reasoning. Try again.",
        );
        if (r.status === 409) void mutate();
        throw new Error(r.error || "socratic failed");
      }
      // Success only: clear the persisted partial answer — the user just
      // submitted, so the draft is no longer "in progress". We keep the row so
      // answered_count / correct_count survive; only the textarea draft is
      // cleared. Fire-and-forget; not critical to await. Also drop any staged
      // unmount-flush payload so it can't re-post the now-stale draft.
      partialDraftRef.current = "";
      pendingStateSaveRef.current = null;
      if (stateSaveTimerRef.current) clearTimeout(stateSaveTimerRef.current);
      void apiPost(`/api/mastery/sessions/${sessionId}/state`, {
        partial_answer: null,
        answered_count: data?.session.questionsAnswered ?? 0,
        correct_count: data?.session.correctCount ?? 0,
      });
      await mutate();
      // Auto-advance after Ninny's socratic follow-up
      void doNext();
    } finally { setBusy(false); }
  };

  // End the session — the ONLY path that closes it + grants the completion
  // reward (POST /complete). Previously unreachable: no UI ever called it, so
  // sessions ran forever and the Fang reward was un-earnable. The route is
  // idempotent (atomic close-claim) so a double-tap / retry can't double-credit.
  // On success we mutate() so status flips off 'active' and the "Session
  // Wrapped" summary (gated on `ended`) reveals with the reward already banked.
  const doComplete = async () => {
    if (!sessionId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await apiPost<{ coinsEarned?: number; alreadyClosed?: boolean }>(
        `/api/mastery/sessions/${sessionId}/complete`,
        {},
      );
      if (!r.ok) {
        setActionError(r.error || "Couldn't end the session. Try again.");
        return;
      }
      if ((r.data?.coinsEarned ?? 0) > 0) setCelebrateKey(k => k + 1);
      await mutate();
    } catch {
      setActionError("Couldn't end the session. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // ── Derived display values (MUST be computed before any early return so
  //    hook order stays stable across renders when data arrives) ────────────
  const stats = useStatsBits(data);

  // ── Render ───────────────────────────────────────────────────────────────
  if (bootError) {
    return (
      <div className="min-h-screen bg-navy text-cream pt-12">
        <div className="max-w-[720px] mx-auto px-6 py-24 text-center">
          <h1 className="font-bebas text-3xl tracking-wider mb-3">Couldn't load this session</h1>
          <p className="text-[14px] text-cream/70 mb-6">{bootError}</p>
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={retryBoot}
              disabled={bootRetrying}
              aria-busy={bootRetrying}
              className="inline-flex items-center min-h-[40px] rounded-full bg-gold text-navy hover:bg-gold/90 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            >
              {bootRetrying ? "Retrying" : "Try again"}
            </button>
            <Link href={backHref} className="inline-block rounded-md font-mono text-[11px] uppercase tracking-[0.25em] text-cream/55 hover:text-cream hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy">
              {classIdContext ? "Back to Class" : "Back to Mastery Mode"}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <div className="max-w-[980px] mx-auto px-6 py-10">
          <div className="h-5 w-28 bg-white/[0.06] rounded-full mb-5 animate-pulse" />
          <div className="h-12 w-80 bg-white/[0.06] rounded-md mb-4 animate-pulse" />
          <div className="h-[6px] w-full bg-white/[0.06] rounded-full mb-8 animate-pulse" />
          <div className="space-y-3">
            {[0,1,2].map(i => <div key={i} className="h-16 w-full bg-white/[0.04] rounded-lg animate-pulse" />)}
          </div>
        </div>
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

  // Derive ThinkingContext for NinnyThinking. We walk the recent feedback
  // messages to compute the trailing correct-streak (the SessionResponse
  // doesn't carry a session-wide streak field — per-subtopic streaks live
  // on `subtopics[].currentStreak`, but the "you're on a tear" voice is
  // about overall flow, so we count across the tail).
  const thinkingContext: ThinkingContext = (() => {
    const msgs = data.messages;
    let streak = 0;
    let lastAnswerCorrect: boolean | null = null;
    // Walk newest → oldest, count consecutive correct feedback messages,
    // stop on the first miss. Also capture the most-recent correctness.
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      if (m.kind !== "feedback") continue;
      const wasCorrect = (m.payload as { wasCorrect?: boolean } | null)?.wasCorrect;
      if (typeof wasCorrect !== "boolean") continue;
      if (lastAnswerCorrect === null) lastAnswerCorrect = wasCorrect;
      if (wasCorrect) streak += 1;
      else break;
    }
    // Total questions: we don't have a hard cap, but the exam has subtopics
    // each with their own weight; for the LATE_SESSION heuristic we treat
    // ~20 questions as a "full" session — common Mastery session length.
    const totalQuestions = 20;
    return {
      questionIndex: data.session.questionsAnswered,
      totalQuestions,
      lastAnswerCorrect,
      currentStreak: streak,
    };
  })();

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

      {/* Top bar — now a regular shrink-0 flex item. No more sticky overlap:
          the chat below can't scroll behind it because the chat has its own
          independent overflow. */}
      <div className="shrink-0 z-20 bg-navy/90 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 pt-3 pb-2.5">
          {!headerCollapsed && (
            <div className="flex items-center justify-between gap-3 mb-2">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 rounded-md font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 hover:text-cream transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                <CaretLeft size={12} weight="bold" aria-hidden="true" /> {backLabel}
              </Link>
              <h1 className="font-bebas text-xl sm:text-2xl tracking-wider text-cream truncate">
                {data.exam.title}
              </h1>
              <div className="flex items-center gap-3 shrink-0">
                <SessionReportFab
                  userId={user?.id}
                  buildInput={buildStudySheet}
                  overallPct={data.overallDisplayPct}
                />
                {/* End session — the only way to close a session + bank the
                    completion reward. Hidden once ended (the Wrapped view owns
                    the exit then). */}
                {!ended && (
                  <button
                    type="button"
                    onClick={() => setConfirmEndOpen(true)}
                    disabled={busy}
                    className="shrink-0 rounded-full border border-gold/40 text-gold hover:bg-gold/10 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                  >
                    End session
                  </button>
                )}
                <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
                  <Clock size={12} weight="bold" aria-hidden="true" />
                  <span className="tabular-nums" aria-label={`Total study time: ${stats.timeLabel}`}>{stats.timeLabel}</span>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <MasteryProgressBar
                value={data.overallDisplayPct}
                readyThreshold={data.exam.readyThreshold}
                label={data.mastered ? "Mastery" : data.ready ? "Ready" : "Mastery"}
                size="lg"
              />
            </div>
            <button
              type="button"
              onClick={() => setHeaderCollapsed(c => !c)}
              aria-label={headerCollapsed ? "Expand session header" : "Collapse session header"}
              aria-expanded={!headerCollapsed}
              className="shrink-0 grid place-items-center w-9 h-9 rounded-full border border-white/[0.08] text-cream/55 hover:text-cream hover:border-white/[0.2] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            >
              {headerCollapsed
                ? <CaretDown size={14} weight="bold" aria-hidden="true" />
                : <CaretUp size={14} weight="bold" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main fills remaining vertical space. min-h-0 on every flex-chain
          parent is essential for flex-1 children to actually constrain their
          height (otherwise flex-grow items can overflow). */}
      <div className="flex-1 min-h-0 relative z-10 w-full max-w-[1080px] mx-auto px-4 sm:px-6 pt-4 pb-3 flex flex-col">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 flex-1 min-h-0">
          {/* Chat column */}
          <section className="flex flex-col min-h-0" aria-label="Tutoring conversation with Ninny">
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label="Lesson and question thread"
              className="flex-1 min-h-0 space-y-4 pt-2 pr-1 overflow-y-auto"
            >
              {/* Only render the tail of the thread — keeps the session
                  surface minimal and makes "Session Report" the canonical
                  place to retrieve older material. `allMessages` still passes
                  the full thread so HistoricalQuestion can pair each question
                  with its (possibly older) answer + feedback records. */}
              {data.messages.length > VISIBLE_MESSAGES && (
                <div className="pl-[40px]">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/55">
                    {data.messages.length - VISIBLE_MESSAGES} earlier · full thread in Session Report
                  </span>
                </div>
              )}
              {data.messages.slice(-VISIBLE_MESSAGES).map(m => (
                <MasteryMessage key={m.id} message={m} allMessages={data.messages} />
              ))}
              {busy && sessionId && (
                <NinnyThinking
                  key={thinkingKey}
                  sessionId={sessionId}
                  questionId={liveQuestion?.questionId ?? data.session.pending?.questionId ?? null}
                  context={thinkingContext}
                  hideScratchpad={ended}
                />
              )}
            </div>

            {/* Action area — shrink-0 so it never gets squeezed by the scroll
                container. Sits directly below the messages. No separator line
                (keeps the chat feeling airy; the visual grouping is carried
                by the option-button card styles themselves). */}
            <div className="shrink-0 mt-4 pt-2">
              {ended ? (
                <div className="rounded-[12px] bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent border border-white/[0.08] px-5 py-5">
                  <div className="flex items-center gap-2 mb-3 justify-center">
                    <Sparkle size={12} className="text-gold" weight="fill" aria-hidden="true" />
                    <h2 className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
                      Session Wrapped
                    </h2>
                  </div>
                  {data.session.questionsAnswered > 0 && (
                    <div className="flex items-end justify-center gap-6 mb-4">
                      <div className="text-center">
                        <div className="font-bebas text-[44px] tracking-wider text-cream leading-none tabular-nums">
                          {Math.round((data.session.correctCount / data.session.questionsAnswered) * 100)}%
                        </div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/55 mt-1">
                          accuracy
                        </div>
                      </div>
                      <div className="w-px h-10 bg-white/[0.08]" aria-hidden="true" />
                      <div className="text-center">
                        <div className="font-bebas text-[44px] tracking-wider text-cream leading-none tabular-nums">
                          {data.session.questionsAnswered}
                        </div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/55 mt-1">
                          questions
                        </div>
                      </div>
                      <div className="w-px h-10 bg-white/[0.08]" aria-hidden="true" />
                      <div className="text-center">
                        <div className="font-bebas text-[44px] tracking-wider text-cream leading-none tabular-nums">
                          {stats.sessionTime}
                        </div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/55 mt-1">
                          time
                        </div>
                      </div>
                    </div>
                  )}
                  <p className="text-[12.5px] text-cream/70 mb-4 text-center">
                    Session closed. Start a new one anytime.
                  </p>
                  <div className="flex justify-center">
                    <Link
                      href={backHref}
                      className="inline-block rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                    >
                      {classIdContext ? "Back to Class" : "Back to Mastery"}
                    </Link>
                  </div>
                  {sessionId && <MasteryNotesFooter sessionId={sessionId} />}
                </div>
              ) : (
                <>
                  {actionError && (
                    <div
                      role="alert"
                      className="mb-3 flex items-start gap-3 rounded-[8px] border border-[#EF4444]/40 bg-[#EF4444]/[0.08] px-4 py-3"
                    >
                      <p className="flex-1 text-[13px] leading-relaxed text-cream/90">{actionError}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* When nothing is pending, the only way to recover a
                            failed /next is to re-ask for it. For question /
                            socratic states the user retries by re-picking or
                            re-sending, so we just offer dismiss there. */}
                        {!data.session.pending && (
                          <button
                            type="button"
                            onClick={() => { void doNext(); }}
                            disabled={busy}
                            className="rounded-full bg-gold text-navy hover:bg-gold/90 disabled:opacity-50 disabled:cursor-not-allowed font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-1 focus-visible:ring-offset-navy"
                          >
                            Try again
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setActionError(null)}
                          aria-label="Dismiss error"
                          className="rounded-full border border-white/[0.15] text-cream/55 hover:text-cream hover:border-white/[0.3] font-mono text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-1 focus-visible:ring-offset-navy"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                  <MasteryActionArea
                    pending={data.session.pending}
                    liveQuestion={liveQuestion}
                    disabled={busy}
                    onContinue={doNext}
                    onAnswer={doAnswer}
                    hintsRemaining={data.hintsRemaining ?? 0}
                    onHint={doHint}
                    onSocraticSubmit={doSocratic}
                    socraticInitial={socraticInitial}
                    onSocraticChange={persistMasteryState}
                  />
                </>
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
      </div>

      {/* Fixed bottom session-stats bar. Sits ABOVE the mobile nav on phones
          (bottom-14) and at bottom-0 on desktop. The outer h-screen flex
          reserves pb-14 (mobile) / pb-10 (desktop) so nothing is covered. */}
      <div
        role="status"
        aria-label="Session stats"
        className="fixed left-0 right-0 bottom-14 md:bottom-0 z-30 bg-navy/90 backdrop-blur-md border-t border-white/[0.06]"
      >
        <div className="max-w-[1080px] mx-auto pl-4 sm:pl-6 pr-[100px] py-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
          <span><span className="tabular-nums text-cream/85">{data.session.questionsAnswered}</span> Qs</span>
          <span><span className="tabular-nums text-cream/85">{data.session.correctCount}</span> right</span>
          <span><span className="tabular-nums text-cream/85">{data.session.teachingPanelsShown}</span> taught</span>
          <span><span className="tabular-nums text-cream/85">{stats.sessionTime}</span> this session</span>
          {data.session.reachedMasteryAt && (
            <span className="text-gold flex items-center gap-1">
              <Sparkle size={10} weight="fill" aria-hidden="true" /> Mastered
            </span>
          )}
          {(data.mastered || data.ready) && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="ml-auto inline-flex items-center gap-1.5 min-h-[32px] rounded-full border border-gold/40 bg-gold/10 hover:bg-gold/20 px-3 py-1 text-gold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              aria-label="Share milestone"
            >
              <ShareNetwork size={10} weight="fill" aria-hidden="true" /> Share
            </button>
          )}
        </div>
      </div>

      <ShareCard
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shareTitle={`mastery-${data.exam.title.toLowerCase().replace(/\s+/g, "-").slice(0, 24)}`}
        card={{
          headline: data.mastered ? "MASTERED" : "READY TO PASS",
          subline: data.exam.title,
          bigNumber: {
            value: `${Math.round(data.overallDisplayPct)}%`,
            label: data.mastered ? "Mastery" : "Predicted pass",
          },
          stats: [
            { label: "Questions", value: `${data.session.questionsAnswered}` },
            { label: "Correct", value: `${data.session.correctCount}` },
          ],
          accent: data.mastered ? "#FFD700" : "#A855F7",
        }}
      />

      {/* Session Report pill moved into the page header (above) so it stays
          content-anchored and clear of the global LaunchDock "+" button at
          bottom-right. Locked below 33% mastery, then paywalled for free
          users. */}

      {/* Celebration confetti on mastery — key forces remount so it re-fires */}
      <Confetti
        key={celebrateKey}
        trigger={celebrateKey > 0}
        origin="center"
        palette={["#FFD700", "#A855F7", "#4A90D9"]}
      />

      {/* End-session confirm — the reward is banked on confirm, and the session
          closes (you can start a fresh one anytime). */}
      <ConfirmModal
        open={confirmEndOpen}
        onClose={() => setConfirmEndOpen(false)}
        onConfirm={async () => {
          await doComplete();
          setConfirmEndOpen(false);
        }}
        title="End this session?"
        message="You'll bank your Fangs for this session and see your wrap-up. You can start a new session on this exam anytime."
        confirmLabel="End & claim"
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
