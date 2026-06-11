"use client";

// TriviaView — the per-round screen for Trivia (DISPLAY name "Lightning
// Round"). Kahoot-style MCQ race: everyone gets the SAME question, locks one
// answer fast, keeps a streak alive, and climbs the board between rounds.
//
// Two server phases drive this component:
//   1. "answer" (~12s): everyone picks one of 4 options. The server NEVER
//      ships correct_option_id during this phase. Picking is one-shot, no
//      take-backs (the tile grid disables once you've answered).
//   2. "reveal" (~6s): correct option + per-option tallies + per-player points
//      breakdown + leaderboard. Staged choreography (lock -> flip -> points ->
//      board). After the FINAL round's reveal, the shared GameOverScreen takes
//      over (podium + Play Again / Back to Lobby).
//
// Realtime wiring is mirrored 1:1 from BluffView / PokerFaceView: adoptRound,
// 1.5s refreshDetail poll, subscribe-once channel wrapped in subscribeResilient,
// effectiveHostUserId fallback, activeRound discovery fallback, host auto-start,
// client-side phase-timer auto-advance (server lazy-advance is the backstop),
// 8s loading-stuck rescue, playersForBoard memo, handleRematch.
//
// The 4 option tiles use a FIXED positional palette + glyph so color is never
// the only signal (the glyph shape is the colorblind-safe anchor):
//   0: blue ▲ / 1: purple ◆ / 2: gold ● / 3: cyan ■

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api-client";
import PartyScoreboard from "./PartyScoreboard";
import AvatarCheckRow from "./AvatarCheckRow";
import IntermissionCard from "./IntermissionCard";
import NinnyHostBubble from "./NinnyHostBubble";
import JoiningNextRoundBanner from "./JoiningNextRoundBanner";
import RoundCountdown from "./RoundCountdown";
import GameOverScreen from "./GameOverScreen";
import CountUp from "@/components/CountUp";
import dynamic from "next/dynamic";
// Confetti is dynamic-imported — see RoundEndOverlay for the why. Saves
// shipping the canvas particle code on every TriviaView mount.
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });
import { triviaChannel, TRIVIA_EVENTS, roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";
import PostRoundVoteCard from "./PostRoundVoteCard";
import MidGameInviteModal from "./MidGameInviteModal";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";

// Trivia's signature accent (orange) — header glow, timer ring base, NEXT CTA,
// countdown + game-over accent, invite pill.
const ACCENT = "#FF6B35";
const COUNTDOWN_SECONDS = 5;

// Fixed positional palette + glyph for the 4 answer tiles. Index is the
// option id (the server's options are index-keyed "0".."3"). The glyph SHAPE
// is the colorblind-safe anchor — color alone is never the signal.
const TILE_PALETTE: { color: string; glyph: string }[] = [
  { color: "#4A90D9", glyph: "▲" }, // 0 blue, triangle up
  { color: "#A855F7", glyph: "◆" }, // 1 purple, diamond
  { color: "#FFD700", glyph: "●" }, // 2 gold, circle
  { color: "#22D3EE", glyph: "■" }, // 3 cyan, square
];

const GREEN = "#22C55E";
const DANGER = "#EF4444";

// ── Copy banks (rotate per round via a stable index) ──
const COUNTDOWN_SUBLINES = [
  "lock in fast. don't choke.",
  "fastest right answer takes it.",
  "speed counts. so does being right.",
];
const WAITING_LINES = [
  "Nice. Sit tight while the room catches up.",
  "Answer's in. Waiting on the rest.",
  "Locked. Let's see who else is quick.",
];
const REVEAL_CORRECT_LINES = [
  "Correct. Clean.",
  "Nailed it.",
  "Right on the money.",
  "You knew that one.",
  "Easy. Next.",
];
// {answer} placeholder filled at render for the incorrect lines that use it.
const REVEAL_WRONG_LINES = [
  "Not this time.",
  "So close. The answer was {answer}.",
  "Nope, it was {answer}. You'll get the next one.",
  "Off by a hair. Shake it off.",
  "Wrong, but you locked in fast. Respect.",
];

function streakLine(n: number): string | null {
  if (n <= 1) return null;
  if (n === 2) return "2 in a row";
  if (n === 3) return "3 in a row! \u{1F525}";
  if (n === 4) return "4 straight. heating up. \u{1F525}";
  return `${n} in a row! unstoppable. \u{1F525}\u{1F525}`;
}

interface Props {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
  activeRound?: { id: string; phase: string; started_at: string | null } | null;
  onReturnToLobby: () => void;
}

type Phase = "loading" | "answer" | "reveal";
type RevealStage = "lock" | "flip" | "points" | "board";

interface TriviaOptionView {
  id: string;
  text: string;
}

interface RoundDetail {
  round: {
    id: string;
    room_id: string;
    round_num: number;
    question: string;
    category: string | null;
    phase: "answer" | "reveal";
    started_at: string;
    answer_ends_at: string | null;
    reveal_ends_at: string | null;
    ended_at: string | null;
    options: TriviaOptionView[];
    correct_option_id?: string;
  };
  my_answer_option_id: string | null;
  answered_count: number;
  answered_user_ids: string[];
  reveal?: {
    correct_option_id: string;
    option_tallies: Record<string, number>;
    round_points: Record<string, number>;
    breakdown: Record<
      string,
      { base: number; speed: number; streak: number; correct: boolean; streak_count: number }
    >;
  };
}

export default function TriviaView({
  room,
  players,
  isHost,
  meUserId,
  activeRound,
  onReturnToLobby,
}: Props) {
  const reduced = useReducedMotion();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RoundDetail | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [ninnyMsg, setNinnyMsg] = useState<string | null>("Get ready to race.");
  // ONE dedicated live region for the reveal result. Set exactly once per round
  // (keyed on round id via revealNinnyRef in the reveal effect) so the 1.5s
  // polls never re-announce. Cleared on round adoption.
  const [revealAnnounce, setRevealAnnounce] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  // Local-optimistic lock-in (like Poker Face's myCallLocal). One pick per
  // round, no take-backs in the UI. The server's my_answer_option_id confirms
  // on the next poll. Cleared whenever a fresh round adopts.
  const [pickLocal, setPickLocal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One advance attempt per (round id, phase), with a 4s retry window for
  // failed POSTs (mirrors BluffView).
  const advanceAttemptRef = useRef<{ key: string; at: number } | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const seenRoundIdsRef = useRef<Set<string>>(new Set());
  const triviaChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Between-rounds countdown (shared RoundCountdown, 5s) ──
  const [countdownRoundId, setCountdownRoundId] = useState<string | null>(null);
  const countdownSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!detail || detail.round.phase !== "answer") return;
    if (countdownSeenRef.current.has(detail.round.id)) return;
    countdownSeenRef.current.add(detail.round.id);
    setCountdownRoundId(detail.round.id);
  }, [detail]);
  const handleCountdownDone = useCallback(() => setCountdownRoundId(null), []);

  // ── Game length (from room settings; default 10 questions) ──
  const totalRounds = Math.max(1, room.settings?.trivia_round_count ?? 10);

  // ── Staged reveal choreography ──
  // lock (~0ms) -> flip (~400ms) -> points (~1300ms) -> board (~1900ms).
  // Reduced motion jumps straight to board. Keyed on the revealed round id so
  // the 1.5s polls don't restart the show.
  const [revealStage, setRevealStage] = useState<RevealStage>("board");
  const revealKey = detail?.round.phase === "reveal" ? detail.round.id : null;
  useEffect(() => {
    if (!revealKey) return;
    if (reduced) {
      setRevealStage("board");
      return;
    }
    setRevealStage("lock");
    const t1 = setTimeout(() => setRevealStage("flip"), 400);
    const t2 = setTimeout(() => setRevealStage("points"), 1300);
    const t3 = setTimeout(() => setRevealStage("board"), 1900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [revealKey, reduced]);

  // Phase 2 — mid-game invite modal (host surface).
  const [inviteOpen, setInviteOpen] = useState(false);

  // ── Round adoption — the ONLY place roundId changes ──
  const adoptRound = useCallback((id: string) => {
    if (seenRoundIdsRef.current.has(id)) return;
    seenRoundIdsRef.current.add(id);
    roundIdRef.current = id;
    setRoundId(id);
    setPhase("answer");
    setPickLocal(null);
    setDetail(null);
    setError(null);
    setRevealAnnounce(null);
    setNinnyMsg("Same question for everyone. Fastest right answer wins.");
  }, []);

  // ── Poll round detail (server is the source of truth) ──
  const refreshDetail = useCallback(async () => {
    const rid = roundIdRef.current;
    if (!rid) return;
    const res = await apiGet<RoundDetail>(`/api/party/trivia/rounds/${rid}`);
    if (!res.ok || !res.data) return;
    // Round changed while this GET was in flight — drop the stale payload.
    if (roundIdRef.current !== rid) return;
    setDetail(res.data);
    setPhase(res.data.round.phase);
  }, []);

  // Outgoing trivia broadcasts ride the SUBSCRIBED channel (fast ws push). The
  // fallback covers the pre-subscribe window via supabase.channel()'s
  // topic-dedupe. Never removeChannel here — removal detaches by topic.
  const sendTriviaEvent = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const ch = triviaChRef.current ?? supabase.channel(triviaChannel(room.code));
      try {
        await ch.send({ type: "broadcast", event, payload });
      } catch {
        // Best-effort — every client's poll reconciles within ~1.5s anyway.
      }
    },
    [room.code],
  );

  // ── Start a fresh round (host) ──
  const startRound = useCallback(async () => {
    setPhase("loading");
    setDetail(null);
    setPickLocal(null);
    setError(null);
    const res = await apiPost<{ round: RoundDetail["round"] }>(
      "/api/party/trivia/rounds",
      { code: room.code },
    );
    if (!res.ok || !res.data) {
      setError("Couldn't pull a question. Try again.");
      return;
    }
    // The create route is idempotent: a round already in flight returns THAT
    // round, so racing creators converge on one id.
    adoptRound(res.data.round.id);
    void refreshDetail();
    void sendTriviaEvent(TRIVIA_EVENTS.ROUND_STARTED, { round_id: res.data.round.id });
  }, [room.code, adoptRound, refreshDetail, sendTriviaEvent]);

  // ── Effective-host derivation (deadlock fallback) ──
  const effectiveHostUserId = useMemo(() => {
    const realHostActive = players.some((p) => p.user_id === room.host_user_id);
    if (realHostActive) return room.host_user_id;
    const sorted = [...players].sort((a, b) => {
      const ja = a.joined_at ?? "";
      const jb = b.joined_at ?? "";
      if (ja !== jb) return ja < jb ? -1 : 1;
      return a.user_id.localeCompare(b.user_id);
    });
    return sorted[0]?.user_id ?? room.host_user_id;
  }, [players, room.host_user_id]);
  const isEffectiveHost = effectiveHostUserId === meUserId;

  // Round discovery fallback (poll-driven): the page's room snapshot carries
  // the in-flight round (activeRound). Covers rejoin/mid-phase mount AND any
  // missed ROUND_STARTED broadcast. The seen-set makes this safe vs stale snaps.
  const activeRoundId = activeRound?.id ?? null;
  useEffect(() => {
    if (activeRoundId) adoptRound(activeRoundId);
  }, [activeRoundId, adoptRound]);

  // Host auto-starts the first round — only when there's no in-flight round.
  useEffect(() => {
    if (isEffectiveHost && !roundId && phase === "loading" && !activeRound?.id) {
      void startRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEffectiveHost]);

  // ── Trivia channel: subscribe ONCE per room ──
  useEffect(() => {
    const ch = supabase.channel(triviaChannel(room.code));
    ch.on("broadcast", { event: TRIVIA_EVENTS.ROUND_STARTED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { round_id?: string };
      if (payload.round_id) adoptRound(payload.round_id);
    });
    ch.on("broadcast", { event: TRIVIA_EVENTS.PHASE_CHANGED }, () => void refreshDetail());
    ch.on("broadcast", { event: TRIVIA_EVENTS.ROUND_ENDED }, () => void refreshDetail());
    ch.on("broadcast", { event: TRIVIA_EVENTS.ANSWER_SUBMITTED }, () => void refreshDetail());
    const handle = subscribeResilient(ch, { label: `trivia-room:${room.code}` });
    triviaChRef.current = ch;
    return () => {
      triviaChRef.current = null;
      handle.cancel();
      supabase.removeChannel(ch);
    };
  }, [room.code, adoptRound, refreshDetail]);

  useEffect(() => {
    if (!roundId) return;
    void refreshDetail();
    const iv = setInterval(refreshDetail, 1500);
    return () => clearInterval(iv);
  }, [roundId, refreshDetail]);

  // Deterministic per-user jitter so the non-host fallback advancers don't all
  // fire on the exact same tick (the server CAS makes a stampede safe anyway).
  const advanceJitterMs = useMemo(() => {
    let h = 0;
    for (let i = 0; i < meUserId.length; i++) h = (h * 31 + meUserId.charCodeAt(i)) >>> 0;
    return h % 1500;
  }, [meUserId]);

  // ── Phase timer + auto-advance ──
  // The effective host advances the moment the server deadline passes. Every
  // other client is a fallback after deadline + 5s (+ jitter). The server's
  // lazy-advance + member-grace already covers backgrounded hosts; this is the
  // fast path. Driven from answer_ends_at / reveal_ends_at (server timestamps).
  useEffect(() => {
    if (!detail) return;
    const round = detail.round;
    if (round.ended_at) {
      setTimeLeft(0);
      return;
    }
    const target = round.phase === "answer" ? round.answer_ends_at : round.reveal_ends_at;
    if (!target) {
      setTimeLeft(0);
      return;
    }
    const targetMs = new Date(target).getTime();
    const myAdvanceAt = isEffectiveHost ? targetMs : targetMs + 5_000 + advanceJitterMs;
    function tick() {
      const now = Date.now();
      setTimeLeft(Math.max(0, Math.ceil((targetMs - now) / 1000)));
      if (now < myAdvanceAt) return;
      const key = `${round.id}:${round.phase}`;
      const prev = advanceAttemptRef.current;
      if (prev && prev.key === key && now - prev.at < 4_000) return;
      advanceAttemptRef.current = { key, at: now };
      void apiPost(`/api/party/trivia/rounds/${round.id}/complete`, {
        action: "advance",
        from_phase: round.phase,
      }).then((res) => {
        if (!res.ok) return; // pre-grace / transient failure — retry in 4s
        void refreshDetail();
        void sendTriviaEvent(TRIVIA_EVENTS.PHASE_CHANGED, { round_id: round.id });
      });
    }
    tick();
    // Reduced motion still ticks per-second below (discrete, no smooth tween).
    const iv = setInterval(tick, reduced ? 1000 : 500);
    return () => clearInterval(iv);
  }, [detail, isEffectiveHost, advanceJitterMs, refreshDetail, sendTriviaEvent, reduced]);

  // ── Submit answer (one pick, no take-backs) ──
  async function submitAnswer(option: TriviaOptionView) {
    if (!roundId || submitting) return;
    // Already locked (locally or server-confirmed) — no take-backs.
    if (pickLocal || detail?.my_answer_option_id) return;
    setPickLocal(option.id);          // lock the UI immediately
    setSubmitting(true);
    setError(null);
    const res = await apiPost(`/api/party/trivia/rounds/${roundId}/answer`, {
      choice_index: parseInt(option.id, 10),
    });
    setSubmitting(false);
    if (!res.ok) {
      console.error("[party:trivia-answer] failed", res.error);
      setPickLocal(null); // unlock so they can retry
      setError(res.error || "Couldn't lock your answer. Tap it again.");
      return;
    }
    setNinnyMsg("Locked in. Let's see who's quick.");
    void refreshDetail();
    void sendTriviaEvent(TRIVIA_EVENTS.ANSWER_SUBMITTED, { round_id: roundId });
  }

  // Phase transition: clear stale error + reveal-stage rewind so a previous
  // round's MAX stage can't flash the board before the kick effect runs.
  useEffect(() => {
    setError(null);
  }, [phase]);
  useEffect(() => {
    setRevealStage(reduced ? "board" : "lock");
  }, [roundId, reduced]);

  // Ninny reveal line — set once per round when reveal first lands.
  const revealNinnyRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "reveal" || !detail?.reveal) return;
    if (revealNinnyRef.current === detail.round.id) return;
    revealNinnyRef.current = detail.round.id;
    const myOpt = detail.my_answer_option_id;
    const correct = myOpt != null && myOpt === detail.reveal.correct_option_id;
    setNinnyMsg(correct ? "Got it. Keep that streak going." : "Not that one. Next question's yours.");
    // Mirror the result into the dedicated live region — fires once per round.
    const answerText =
      detail.round.options.find((o) => o.id === detail.reveal!.correct_option_id)?.text ?? "";
    setRevealAnnounce(
      correct
        ? `Correct. The answer was ${answerText}.`
        : `Incorrect. The answer was ${answerText}.`,
    );
  }, [phase, detail]);

  // ── Rematch CTA (host-only fresh-start) ──
  const [rematchPending, setRematchPending] = useState(false);
  const handleRematch = useCallback(async () => {
    if (!isEffectiveHost || rematchPending) return;
    setRematchPending(true);
    const res = await apiPost(`/api/party/rooms/${room.code}/rematch`, {});
    if (!res.ok) {
      setRematchPending(false);
      return;
    }
    const ch = supabase.channel(roomChannel(room.code));
    await ch
      .send({ type: "broadcast", event: PARTY_EVENTS.GAME_ENDED, payload: {} })
      .catch(() => {});
    setRematchPending(false);
  }, [isEffectiveHost, rematchPending, room.code]);

  // Phase 2 vote auto-decide callbacks (75% threshold). Effective host so a
  // host-disconnect can't stall the post-round transition.
  const handleAutoPlayAgain = useCallback(() => {
    if (isEffectiveHost) void startRound();
  }, [isEffectiveHost, startRound]);
  const handleAutoBackToLobby = useCallback(() => {
    if (isEffectiveHost) onReturnToLobby();
  }, [isEffectiveHost, onReturnToLobby]);

  // ── Loading-rescue: 8s stuck spinner gets a host TRY AGAIN ──
  const [loadingStuck, setLoadingStuck] = useState(false);
  const isLoadingScreen = phase === "loading" || !detail;
  useEffect(() => {
    if (!isLoadingScreen) {
      setLoadingStuck(false);
      return;
    }
    const t = setTimeout(() => setLoadingStuck(true), 8_000);
    return () => clearTimeout(t);
  }, [isLoadingScreen]);

  const playersForBoard = useMemo(
    () => players.map((p) => ({ user_id: p.user_id, username: p.username, score: p.score })),
    [players],
  );

  // ── Loading / empty / rescue screen ──
  if (phase === "loading" || !detail) {
    const rescue =
      error || loadingStuck ? (
        <div className="flex flex-col items-center gap-3 pt-1 pb-4">
          {error && (
            <p className="text-red-400 text-sm font-syne text-center" role="alert">
              {error}
            </p>
          )}
          {isEffectiveHost ? (
            <button
              type="button"
              onClick={() => void startRound()}
              className="px-6 py-2.5 rounded-xl font-bebas tracking-wider text-sm transition-all active:scale-95"
              style={{
                background: `linear-gradient(135deg, ${ACCENT} 0%, #C2410C 100%)`,
                color: "#04080F",
                boxShadow: `0 4px 18px ${ACCENT}4d`,
              }}
            >
              {error ? "TRY AGAIN" : "START THE NEXT QUESTION"}
            </button>
          ) : (
            <p className="text-cream/40 text-xs font-syne text-center max-w-xs">
              Syncing with the room. Next question starts when the host kicks it off.
            </p>
          )}
        </div>
      ) : null;

    if (players.some((p) => (p.score ?? 0) > 0)) {
      return (
        <div className="space-y-2">
          <IntermissionCard
            players={players}
            meUserId={meUserId}
            accent={ACCENT}
            headline="NEXT QUESTION LOADING"
            sub="shuffling the deck"
          />
          {rescue}
        </div>
      );
    }
    // Cinematic loading — orange-flavored to match the game accent.
    return (
      <div className="flex flex-col items-center py-20 gap-5 relative">
        <div className="relative w-28 h-28 flex items-center justify-center">
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
            style={{ background: `radial-gradient(circle, ${ACCENT}73 0%, transparent 70%)` }}
          />
          <span
            aria-hidden="true"
            className={`absolute inset-3 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
            style={{
              background: "radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%)",
              animationDelay: "0.6s",
            }}
          />
          <div
            className={`w-12 h-12 rounded-full border-2 relative z-10 ${reduced ? "" : "animate-spin"}`}
            // Reduced motion: full solid accent ring (no spinning "gap" to imply motion).
            style={
              reduced
                ? { borderColor: ACCENT }
                : { borderColor: `${ACCENT}40`, borderTopColor: ACCENT }
            }
          />
        </div>
        <p className="font-bebas text-2xl text-cream/70 tracking-[0.3em]">LOADING QUESTION</p>
        <p className="text-cream/40 text-xs font-syne italic">shuffling the deck</p>
        {rescue}
      </div>
    );
  }

  const round = detail.round;
  const options = round.options;
  const isFinalRound = round.round_num >= totalRounds;
  const myAnswerId = pickLocal ?? detail.my_answer_option_id ?? null;
  const hasAnswered = myAnswerId != null;
  const correctId = detail.reveal?.correct_option_id ?? round.correct_option_id ?? null;
  const tallies = detail.reveal?.option_tallies ?? {};
  const myBreakdown = detail.reveal?.breakdown?.[meUserId] ?? null;
  const myRoundPoints = detail.reveal?.round_points?.[meUserId] ?? 0;
  const iWasCorrect = myBreakdown?.correct ?? (myAnswerId != null && myAnswerId === correctId);
  // Time-pressure: under 5s under the answer phase.
  const showPanicVignette = phase === "answer" && timeLeft > 0 && timeLeft < 5 && !reduced;
  const dangerTimer = phase === "answer" && timeLeft <= 4 && timeLeft > 0;

  const mePlayer = players.find((p) => p.user_id === meUserId);
  const isPendingJoiner = !!mePlayer?.is_pending_round;

  // Stable per-round copy index (so rotating lines don't shuffle on every poll).
  const copyIdx = round.round_num;
  const answeredCount = detail.answered_count ?? 0;
  const correctText =
    correctId != null ? options.find((o) => o.id === correctId)?.text ?? "" : "";

  // ── Timer ring geometry (SVG) ──
  const ringTotal = round.phase === "answer" && round.started_at && round.answer_ends_at
    ? Math.max(1, (new Date(round.answer_ends_at).getTime() - new Date(round.started_at).getTime()) / 1000)
    : 12;
  const ringFrac = Math.max(0, Math.min(1, timeLeft / ringTotal));
  const RING_R = 34;
  const RING_C = 2 * Math.PI * RING_R;

  return (
    <div className="space-y-4">
      {isPendingJoiner && <JoiningNextRoundBanner variant="trivia" />}
      {showPanicVignette && <div aria-hidden="true" className="pa-panic-vignette" />}

      {/* ── Between-rounds countdown (shared RoundCountdown, 5s) ── */}
      <AnimatePresence>
        {countdownRoundId === round.id && phase === "answer" && (
          <RoundCountdown
            key={`countdown-${round.id}`}
            roundNum={round.round_num}
            totalRounds={totalRounds}
            label="QUESTION"
            seconds={COUNTDOWN_SECONDS}
            accent={ACCENT}
            headline={
              isFinalRound ? (
                <>last one. <span style={{ color: ACCENT }}>make it count.</span></>
              ) : (
                <>get ready to <span style={{ color: ACCENT }}>race</span></>
              )
            }
            subline={
              isFinalRound
                ? "everything's on the line."
                : COUNTDOWN_SUBLINES[copyIdx % COUNTDOWN_SUBLINES.length]
            }
            onComplete={handleCountdownDone}
          />
        )}
      </AnimatePresence>

      <NinnyHostBubble message={ninnyMsg} />

      {/* Final-question banner */}
      {isFinalRound && phase === "answer" && (
        <div
          className={`rounded-xl px-4 py-2 text-center ${reduced ? "" : "pa-pop-in"}`}
          style={{
            background: `linear-gradient(135deg, ${ACCENT}22 0%, rgba(255,215,0,0.06) 100%)`,
            border: `1px solid ${ACCENT}59`,
          }}
        >
          <p className="font-bebas text-sm tracking-[0.3em]" style={{ color: ACCENT }}>
            FINAL QUESTION
          </p>
          <p className="text-cream/55 text-[11px] font-syne">last one. everything&apos;s on the line.</p>
        </div>
      )}

      {/* Question card */}
      <div
        key={round.id}
        className={`rounded-2xl p-5 ${reduced ? "" : "ca-pop-in"}`}
        style={{
          background: `linear-gradient(135deg, ${ACCENT}1f 0%, rgba(255,215,0,0.05) 100%)`,
          border: `1px solid ${ACCENT}59`,
          boxShadow: `0 0 24px ${ACCENT}1a`,
        }}
      >
        {round.category && (
          <p className="font-bebas text-xs text-cream/50 tracking-[0.25em] mb-2">
            {round.category.toUpperCase()}
          </p>
        )}
        <p className="font-syne text-lg sm:text-xl text-cream/95 leading-relaxed">
          {round.question}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-bebas text-[10px] tracking-[0.3em] text-cream/40">
            ROUND {round.round_num}/{totalRounds} · {phase.toUpperCase()}
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ── ANSWER PHASE ── */}
        {phase === "answer" && (
          <motion.div
            key="answer"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Timer RING (not a bar — the bar below is "X of Y answered"). */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="relative w-24 h-24">
                <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90">
                  <circle
                    cx="40" cy="40" r={RING_R}
                    fill="none"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="6"
                  />
                  <circle
                    cx="40" cy="40" r={RING_R}
                    fill="none"
                    stroke={dangerTimer ? DANGER : ACCENT}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={RING_C}
                    strokeDashoffset={RING_C * (1 - ringFrac)}
                    style={{
                      transition: reduced ? "none" : "stroke-dashoffset 0.5s linear, stroke 0.3s",
                      filter: dangerTimer ? `drop-shadow(0 0 6px ${DANGER}88)` : `drop-shadow(0 0 6px ${ACCENT}66)`,
                    }}
                  />
                </svg>
                <div
                  className={`absolute inset-0 flex items-center justify-center font-bebas text-3xl tabular-nums ${
                    dangerTimer && !reduced ? "ca-urgent" : ""
                  }`}
                  style={{ color: dangerTimer ? DANGER : "rgba(238,244,255,0.9)" }}
                  aria-label={`${timeLeft} seconds left`}
                >
                  {timeLeft}
                </div>
              </div>
              <p className="font-bebas text-xs tracking-[0.3em] text-cream/55">
                {dangerTimer ? "LOCK IT IN" : "PICK YOUR ANSWER"}
              </p>
            </div>

            {/* 4 option tiles — fixed positional palette + glyph. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {options.map((opt, i) => {
                const pal = TILE_PALETTE[i] ?? TILE_PALETTE[0];
                const selected = myAnswerId === opt.id;
                const dimmed = hasAnswered && !selected;
                return (
                  <button
                    key={opt.id}
                    onClick={() => submitAnswer(opt)}
                    disabled={hasAnswered || submitting}
                    aria-pressed={selected}
                    className={`relative text-left rounded-xl px-4 py-3 min-h-[64px] flex items-center gap-3 transition-all ${
                      hasAnswered ? "cursor-default" : "active:scale-[0.98] hover:-translate-y-0.5"
                    } ${reduced ? "" : "pa-deal-in"}`}
                    style={{
                      background: selected
                        ? `linear-gradient(135deg, ${pal.color}33 0%, ${pal.color}14 100%)`
                        : `linear-gradient(135deg, ${pal.color}16 0%, rgba(8,6,16,0.4) 100%)`,
                      border: selected ? `2px solid ${pal.color}` : `1px solid ${pal.color}40`,
                      opacity: dimmed ? 0.4 : 1,
                      boxShadow: selected ? `0 0 18px ${pal.color}40` : "none",
                      ...(reduced ? {} : { animationDelay: `${i * 80}ms` }),
                    }}
                  >
                    {/* Glyph chip — gradient of the tile accent, glyph navy. */}
                    <span
                      aria-hidden="true"
                      className={`flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm ${
                        selected && !reduced ? "pa-pop-in" : ""
                      }`}
                      style={{
                        background: `linear-gradient(135deg, ${pal.color} 0%, ${pal.color}aa 100%)`,
                        color: "#04080F",
                        boxShadow: selected ? `0 0 10px ${pal.color}88` : "none",
                      }}
                    >
                      {pal.glyph}
                    </span>
                    <span className="font-syne text-base text-cream/92 flex-1 min-w-0">
                      {opt.text}
                    </span>
                    {/* Selected check badge top-right, tinted to the tile accent. */}
                    {selected && (
                      <span
                        aria-hidden="true"
                        className={`absolute -top-2 -right-2 inline-flex items-center justify-center w-5 h-5 rounded-full ${
                          reduced ? "" : "pa-chip-in"
                        }`}
                        style={{
                          background: `linear-gradient(135deg, ${pal.color} 0%, ${pal.color}aa 100%)`,
                          border: "1px solid rgba(4,8,15,0.6)",
                        }}
                      >
                        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="#04080F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1.5 5.5 4 8l4.5-6" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Locked-in card + roster + progress (once answered). */}
            {hasAnswered && (
              <div
                className={`rounded-xl px-4 py-2.5 text-center ${reduced ? "" : "pa-pop-in"}`}
                style={{
                  background: `linear-gradient(135deg, ${ACCENT}22 0%, rgba(255,215,0,0.06) 100%)`,
                  border: `1px solid ${ACCENT}59`,
                }}
              >
                <p className="font-bebas text-sm tracking-wider" style={{ color: ACCENT }}>
                  LOCKED IN
                </p>
                <p className="text-cream/55 text-[11px] font-syne">
                  {WAITING_LINES[copyIdx % WAITING_LINES.length]}
                </p>
                <p className="text-cream/35 text-[10px] font-syne italic mt-0.5">
                  No take-backs. Hope you&apos;re right.
                </p>
              </div>
            )}

            {/* "X of Y locked in" ticker + orange progress bar. */}
            <div className="space-y-1.5">
              <p className="text-cream/50 text-xs font-syne text-right">
                <span className="font-bebas text-sm text-cream/85 tabular-nums">
                  <CountUp value={answeredCount} duration={500} />
                </span>{" "}
                / {players.length} locked in
              </p>
              <div className="h-1.5 rounded-full bg-cream/[0.07] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${players.length > 0 ? (answeredCount / players.length) * 100 : 0}%`,
                    background: `linear-gradient(90deg, ${ACCENT}, #FFD700)`,
                    transition: reduced ? "none" : "width 0.5s var(--ease-out-quart)",
                  }}
                />
              </div>
            </div>

            {/* Avatar roster — locked in vs still thinking. ids-only, no leak. */}
            <AvatarCheckRow
              players={players}
              doneIds={detail.answered_user_ids ?? []}
              meUserId={meUserId}
              reduced={!!reduced}
              doneTitle="locked in"
              pendingTitle="still thinking"
            />
          </motion.div>
        )}

        {/* ── REVEAL PHASE ── */}
        {phase === "reveal" && (
          <motion.div
            key="reveal"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Dedicated SR live region — announces the result exactly once per
                round (revealAnnounce only changes once, keyed on round id). The
                reveal grid itself carries NO aria-live so polls don't spam. */}
            <span role="status" aria-live="assertive" className="sr-only">
              {revealAnnounce}
            </span>

            {/* Confetti on a correct + fast answer. */}
            {iWasCorrect && (myBreakdown?.speed ?? 0) > 0 && (
              <Confetti
                trigger={!reduced}
                count={50}
                origin="top"
                duration={1800}
                palette={["#FF6B35", "#22C55E", "#FDE68A", "#A855F7"]}
              />
            )}

            {/* The 4 tiles re-rendered with reveal states. Correct tile turns
                green at flip; my wrong pick gets a subtle red X; others dim. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {options.map((opt, i) => {
                const pal = TILE_PALETTE[i] ?? TILE_PALETTE[0];
                const isCorrect = opt.id === correctId;
                const isMyPick = myAnswerId === opt.id;
                const myWrong = isMyPick && !isCorrect;
                const flipped = revealStage !== "lock";
                const showGreen = isCorrect && flipped;
                const showWrong = myWrong && flipped;
                const dim = flipped && !isCorrect && !isMyPick;
                const tally = tallies[opt.id] ?? 0;
                return (
                  <div
                    key={opt.id}
                    className={`relative rounded-xl px-4 py-3 min-h-[64px] flex items-center gap-3 ${
                      showGreen && !reduced ? "pa-pop-in" : ""
                    }`}
                    style={{
                      background: showGreen
                        ? "linear-gradient(135deg, rgba(34,197,94,0.22) 0%, rgba(34,197,94,0.06) 100%)"
                        : `linear-gradient(135deg, ${pal.color}16 0%, rgba(8,6,16,0.4) 100%)`,
                      border: showGreen
                        ? `2px solid ${GREEN}`
                        : showWrong
                          ? `1px solid ${DANGER}66`
                          : `1px solid ${pal.color}40`,
                      opacity: dim ? 0.4 : 1,
                      boxShadow: showGreen ? `0 0 22px ${GREEN}44` : "none",
                      transition: reduced ? "none" : "all 0.4s var(--ease-out-quart)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg text-sm"
                      style={{
                        background: showGreen
                          ? `linear-gradient(135deg, ${GREEN} 0%, #15803D 100%)`
                          : `linear-gradient(135deg, ${pal.color} 0%, ${pal.color}aa 100%)`,
                        color: "#04080F",
                      }}
                    >
                      {pal.glyph}
                    </span>
                    <span className="font-syne text-base text-cream/92 flex-1 min-w-0">
                      {opt.text}
                    </span>
                    {/* Non-visual correctness signal (the ✓/✗ glyphs are
                        aria-hidden, so SR users get these instead). */}
                    {showGreen && <span className="sr-only">Correct answer</span>}
                    {showWrong && <span className="sr-only">Your answer, incorrect</span>}
                    {/* Per-tile "N picked" tally. */}
                    <span className="font-bebas text-[11px] tracking-wider text-cream/45 flex-shrink-0">
                      {tally} picked
                    </span>
                    {/* Green check on correct; subtle red X on my wrong pick. */}
                    {showGreen && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-2 -right-2 inline-flex items-center justify-center w-5 h-5 rounded-full"
                        style={{ background: GREEN, border: "1px solid rgba(4,8,15,0.6)" }}
                      >
                        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="#04080F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1.5 5.5 4 8l4.5-6" />
                        </svg>
                      </span>
                    )}
                    {showWrong && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-2 -right-2 inline-flex items-center justify-center w-5 h-5 rounded-full"
                        style={{ background: `${DANGER}cc`, border: "1px solid rgba(4,8,15,0.6)" }}
                      >
                        <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="#04080F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 2l6 6M8 2l-6 6" />
                        </svg>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Personal result banner (lands at the points stage). */}
            {(revealStage === "points" || revealStage === "board") && (
              <div
                className={`rounded-xl px-4 py-3 text-center ${reduced ? "" : "pa-pop-in"}`}
                style={{
                  background: iWasCorrect
                    ? "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.05) 100%)"
                    : `linear-gradient(135deg, ${DANGER}1a 0%, rgba(8,6,16,0.4) 100%)`,
                  border: iWasCorrect ? `1px solid ${GREEN}66` : `1px solid ${DANGER}40`,
                }}
              >
                {iWasCorrect ? (
                  <>
                    <p className="font-bebas text-3xl tracking-wider" style={{ color: "#86EFAC" }}>
                      +<CountUp value={myRoundPoints} duration={800} />
                    </p>
                    <p className="font-syne text-xs text-cream/65 mt-0.5">
                      {REVEAL_CORRECT_LINES[copyIdx % REVEAL_CORRECT_LINES.length]}
                    </p>
                    {/* Sub-chips: BASE blue, SPEED gold, STREAK purple. */}
                    {myBreakdown && (
                      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                        <span
                          className="font-bebas text-[10px] tracking-wider px-2 py-0.5 rounded-full"
                          style={{ background: "#4A90D922", border: "1px solid #4A90D966", color: "#93C5FD" }}
                        >
                          BASE +{myBreakdown.base}
                        </span>
                        {myBreakdown.speed > 0 && (
                          <span
                            className="font-bebas text-[10px] tracking-wider px-2 py-0.5 rounded-full"
                            style={{ background: "#FFD70022", border: "1px solid #FFD70066", color: "#FDE68A" }}
                          >
                            SPEED +{myBreakdown.speed}
                          </span>
                        )}
                        {myBreakdown.streak_count >= 2 && myBreakdown.streak > 0 && (
                          <span
                            className="font-bebas text-[10px] tracking-wider px-2 py-0.5 rounded-full"
                            style={{ background: "#A855F722", border: "1px solid #A855F766", color: "#E9D5FF" }}
                          >
                            STREAK ×{myBreakdown.streak_count} +{myBreakdown.streak}
                          </span>
                        )}
                      </div>
                    )}
                    {myBreakdown && streakLine(myBreakdown.streak_count) && (
                      <p className="font-bebas text-xs tracking-wider mt-1.5" style={{ color: "#F97316" }}>
                        {streakLine(myBreakdown.streak_count)}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-bebas text-xl tracking-wider text-cream/60">NO POINTS</p>
                    <p className="font-syne text-xs text-cream/55 mt-0.5">
                      {(myAnswerId == null
                        ? "Out of time. No answer locked."
                        : REVEAL_WRONG_LINES[copyIdx % REVEAL_WRONG_LINES.length]
                      ).replace("{answer}", correctText)}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Per-player points-this-round card (board stage). */}
            {revealStage === "board" && detail.reveal && (() => {
              const bd = detail.reveal.breakdown;
              const rp = detail.reveal.round_points;
              const rows = players
                .map((p) => ({
                  p,
                  pts: rp[p.user_id] ?? 0,
                  b: bd[p.user_id],
                }))
                .sort((a, b) => b.pts - a.pts);
              return (
                <div
                  className={`rounded-2xl p-4 ${reduced ? "" : "pa-pop-in"}`}
                  style={{
                    background: "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <p className="font-bebas text-xs tracking-[0.25em] text-cream/50 mb-2.5">
                    POINTS THIS ROUND
                  </p>
                  <div className="space-y-1.5">
                    {rows.map(({ p, pts, b }) => (
                      <div key={p.user_id} className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-syne text-sm text-cream/85 truncate">
                            {p.username ?? "Player"}
                            {p.user_id === meUserId && (
                              <span className="text-cream/40 text-xs"> (you)</span>
                            )}
                          </span>
                          {b && b.streak_count >= 2 && (
                            <span
                              className="font-bebas text-[10px] tracking-wider px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: "#F9731622", border: "1px solid #F9731666", color: "#FDBA74" }}
                              title={`${b.streak_count} in a row`}
                            >
                              {"\u{1F525}"} ×{b.streak_count}
                            </span>
                          )}
                        </div>
                        <span
                          className="font-dm-mono text-xs flex-shrink-0"
                          style={{ color: pts > 0 ? "#86EFAC" : "rgba(238,244,255,0.35)" }}
                        >
                          {pts > 0 ? `+${pts}` : "+0"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Leaderboard + next-step CTA at the board stage. */}
            {revealStage === "board" && (
              <>
                <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} />

                {isFinalRound ? (
                  <GameOverScreen
                    players={playersForBoard}
                    meUserId={meUserId}
                    accent={ACCENT}
                    isHost={isEffectiveHost}
                    onPlayAgain={handleRematch}
                    onBackToLobby={onReturnToLobby}
                    playAgainPending={rematchPending}
                  />
                ) : (
                  <>
                    <PostRoundVoteCard
                      roundId={round.id}
                      roundKind="trivia"
                      isHost={isEffectiveHost}
                      onAutoPlayAgain={handleAutoPlayAgain}
                      onAutoBackToLobby={handleAutoBackToLobby}
                    />

                    {isEffectiveHost ? (
                      <div className="space-y-2">
                        <div className="flex flex-col sm:flex-row gap-3">
                          <button
                            onClick={startRound}
                            className="flex-1 py-3 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95"
                            style={{
                              background: `linear-gradient(135deg, ${ACCENT} 0%, #C2410C 100%)`,
                              color: "#04080F",
                              boxShadow: `0 4px 18px ${ACCENT}4d`,
                            }}
                          >
                            NEXT QUESTION
                          </button>
                          <button
                            onClick={onReturnToLobby}
                            className="flex-1 py-3 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95"
                            style={{
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "rgba(238,244,255,0.85)",
                            }}
                          >
                            BACK TO LOBBY
                          </button>
                        </div>
                        <button
                          onClick={handleRematch}
                          disabled={rematchPending}
                          className="w-full py-2.5 rounded-xl font-bebas tracking-wider text-sm transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                          style={{
                            background: "linear-gradient(135deg, rgba(168,85,247,0.20) 0%, rgba(99,102,241,0.10) 100%)",
                            border: "1px solid rgba(168,85,247,0.45)",
                            color: "#E9D5FF",
                            boxShadow: "0 0 16px rgba(168,85,247,0.18)",
                          }}
                        >
                          {rematchPending ? "RESETTING..." : "REMATCH (FRESH SCORES, SAME ROSTER)"}
                        </button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bebas tracking-wider text-cream/55 bg-white/[0.04] border border-white/10">
                          Waiting for host
                        </span>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="text-red-400 text-sm font-syne text-center" role="alert">
          {error}
        </p>
      )}

      {/* Compact running scoreboard during the answer phase. */}
      {phase === "answer" && (
        <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} compact />
      )}

      {/* Phase 2 mid-game invite (host only). */}
      {isHost && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-30 inline-flex items-center min-h-[44px] px-3.5 py-2.5 rounded-full font-bebas text-xs tracking-wider transition-all active:scale-95"
          style={{
            background: "rgba(16,12,26,0.9)",
            border: `1px solid ${ACCENT}73`,
            color: ACCENT,
            backdropFilter: "blur(6px)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          }}
          aria-label="Invite a friend mid-game"
        >
          <span aria-hidden="true" className="mr-1">{"\u{1F517}"}</span>
          INVITE
        </button>
      )}
      <MidGameInviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        code={room.code}
      />
    </div>
  );
}
