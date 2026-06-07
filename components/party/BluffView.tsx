"use client";

// BluffView — the per-round screen for Bluff Trivia.
//
// Three phases:
//   1. "write" (45s default): all players type a fake answer.
//   2. "vote"  (30s default): server shuffles real + fakes; players vote.
//   3. "reveal": truth revealed + scoreboard + Next Round CTA.
//
// The server's phase value drives this component; we poll the round detail
// endpoint every ~1.5s and also subscribe to phase_changed broadcasts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api-client";
import PartyScoreboard from "./PartyScoreboard";
import IntermissionCard from "./IntermissionCard";
import NinnyHostBubble from "./NinnyHostBubble";
import JoiningNextRoundBanner from "./JoiningNextRoundBanner";
import CountUp from "@/components/CountUp";
import dynamic from "next/dynamic";
import RevealText from "@/components/RevealText";
// Confetti is dynamic-imported — see RoundEndOverlay for the why. Saves
// shipping the canvas particle code on every BluffView mount.
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });
import { bluffChannel, BLUFF_EVENTS, roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";
import PostRoundVoteCard from "./PostRoundVoteCard";
import MidGameInviteModal from "./MidGameInviteModal";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";

interface Props {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
  activeRound?: { id: string; phase: string; started_at: string | null } | null;
  onReturnToLobby: () => void;
}

type Phase = "loading" | "write" | "vote" | "reveal";

interface RoundDetail {
  round: {
    id: string;
    room_id: string;
    round_num: number;
    question: string;
    category: string | null;
    phase: "write" | "vote" | "reveal";
    write_ends_at: string | null;
    vote_ends_at: string | null;
    correct_answer?: string;
  };
  answers?: {
    id: string;
    text: string;
    author_user_id?: string | null;
    is_truth?: boolean;
    vote_count?: number;
    /** Player ids who voted for this answer. Drives the per-card "fell for it"
     *  voter chips at reveal. Only populated during reveal phase. */
    voters?: string[];
  }[];
  has_submitted?: boolean;
  my_submission?: string | null;
  submitted_count?: number;
  /** Player ids who have already submitted a fake. Live ticker during write
   *  phase. Refreshed on every poll. */
  submitted_user_ids?: string[];
  my_vote_answer_id?: string | null;
}

export default function BluffView({
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
  const [fakeInput, setFakeInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ninnyMsg, setNinnyMsg] = useState<string | null>("Get ready to bluff.");
  const [timeLeft, setTimeLeft] = useState(0);
  const advanceLock = useRef(false);

  // 3-2-1 pre-round countdown — fires on loading → write transition only
  // (mirrors Sketchy's approach). Reduced-motion users skip the intro.
  const [countdownTicks, setCountdownTicks] = useState(0);
  const prevPhaseRef = useRef<Phase>("loading");
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === "loading" && phase === "write" && !reduced) {
      setCountdownTicks(3);
    }
  }, [phase, reduced]);
  useEffect(() => {
    if (countdownTicks <= 0) return;
    const t = setTimeout(() => setCountdownTicks(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdownTicks]);

  // ── juice-only transient state (no gameplay effect, derived from `detail`
  //    already in client state — nothing extra is fetched) ──
  const [confirmKey, setConfirmKey] = useState(0); // bumps on a successful submit -> button pop

  // Phase 2 — mid-game invite modal (host surface).
  const [inviteOpen, setInviteOpen] = useState(false);
  // Forfeit-this-round: local-only flag so the button replaces itself with a
  // "forfeited" pill immediately. The server records the sentinel answer via
  // the existing /answer endpoint; the vote step will naturally exclude it.
  const [forfeited, setForfeited] = useState(false);

  // ── Start a fresh round (host) ──
  const startRound = useCallback(async () => {
    setPhase("loading");
    setDetail(null);
    setFakeInput("");
    setForfeited(false);
    setError(null);
    const res = await apiPost<{ round: RoundDetail["round"] }>(
      "/api/party/bluff/rounds",
      { code: room.code },
    );
    if (!res.ok || !res.data) {
      setError("Couldn't fetch a question. Try again.");
      return;
    }
    setRoundId(res.data.round.id);
    setPhase("write");
    setNinnyMsg("Write a fake answer that sounds real. Lie convincingly!");
    const ch = supabase.channel(bluffChannel(room.code));
    await ch.send({
      type: "broadcast",
      event: BLUFF_EVENTS.ROUND_STARTED,
      payload: { round_id: res.data.round.id },
    });
  }, [room.code]);

  // ── Effective-host derivation (deadlock fallback) ──
  // If the real host disconnects mid-round, host_user_id can keep pointing at
  // a player who is no longer in the active set, which would freeze auto-
  // advance for everyone. We promote the longest-connected active player as
  // the effective host for control-flow purposes. Every client derives this
  // from the same sorted players list (joined_at ASC, user_id tiebreak) so
  // they all agree without an extra round-trip.
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

  // Reconnect bootstrap: if the page snapshot includes an in-flight round,
  // hydrate the roundId immediately so the rejoiner's first poll lands on the
  // live round instead of sitting on "loading" until a broadcast arrives.
  const bootstrappedActiveRef = useRef(false);
  useEffect(() => {
    if (bootstrappedActiveRef.current) return;
    if (roundId) return;
    if (!activeRound?.id) return;
    bootstrappedActiveRef.current = true;
    setRoundId(activeRound.id);
  }, [activeRound, roundId]);

  // Host auto-starts the first round — only when there's no in-flight round
  // we should bootstrap into (the rejoin path takes that role above).
  useEffect(() => {
    if (isEffectiveHost && !roundId && phase === "loading" && !activeRound?.id) {
      void startRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEffectiveHost]);

  // ── Listen for round_started ──
  useEffect(() => {
    const ch = supabase.channel(bluffChannel(room.code));
    ch.on("broadcast", { event: BLUFF_EVENTS.ROUND_STARTED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { round_id?: string };
      if (payload.round_id && payload.round_id !== roundId) {
        setRoundId(payload.round_id);
        setPhase("write");
        setFakeInput("");
        setForfeited(false);
        setDetail(null);
        setNinnyMsg("Write a fake answer that sounds real. Lie convincingly!");
      }
    });
    ch.on("broadcast", { event: BLUFF_EVENTS.PHASE_CHANGED }, () => {
      void refreshDetail();
    });
    ch.on("broadcast", { event: BLUFF_EVENTS.ROUND_ENDED }, () => {
      void refreshDetail();
    });
    // Phase 2: wrap with exponential-backoff resubscribe so a transient WS
    // drop doesn't silently leave the bluff channel dead.
    const handle = subscribeResilient(ch, { label: `bluff-room:${room.code}` });
    return () => {
      handle.cancel();
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code, roundId]);

  // ── Poll round detail (server is source of truth) ──
  const refreshDetail = useCallback(async () => {
    if (!roundId) return;
    const res = await apiGet<RoundDetail>(`/api/party/bluff/rounds/${roundId}`);
    if (!res.ok || !res.data) return;
    setDetail(res.data);
    const p = res.data.round.phase;
    setPhase(p);
    if (p === "vote") setNinnyMsg("Vote for the answer you think is real.");
    if (p === "reveal") setNinnyMsg(`The truth: ${res.data.round.correct_answer}`);
  }, [roundId]);

  useEffect(() => {
    if (!roundId) return;
    void refreshDetail();
    const iv = setInterval(refreshDetail, 1500);
    return () => clearInterval(iv);
  }, [roundId, refreshDetail]);

  // ── Phase timer + auto-advance (host) ──
  useEffect(() => {
    if (!detail) return;
    const round = detail.round;
    const target =
      round.phase === "write"
        ? round.write_ends_at
        : round.phase === "vote"
          ? round.vote_ends_at
          : null;
    if (!target) {
      setTimeLeft(0);
      return;
    }
    const targetMs = new Date(target).getTime();
    function tick() {
      const remain = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setTimeLeft(remain);
      if (remain === 0 && isEffectiveHost && !advanceLock.current && (round.phase === "write" || round.phase === "vote")) {
        advanceLock.current = true;
        void apiPost(`/api/party/bluff/rounds/${round.id}/complete`, { action: "advance" }).then(() => {
          advanceLock.current = false;
          void refreshDetail();
          void supabase.channel(bluffChannel(room.code)).send({
            type: "broadcast",
            event: BLUFF_EVENTS.PHASE_CHANGED,
            payload: { round_id: round.id },
          });
        });
      }
    }
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [detail, isEffectiveHost, room.code, refreshDetail]);

  // ── Submit fake ──
  async function submitFake(e: React.FormEvent) {
    e.preventDefault();
    if (!roundId || !fakeInput.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await apiPost(`/api/party/bluff/rounds/${roundId}/answer`, {
      text: fakeInput.trim(),
    });
    setSubmitting(false);
    if (!res.ok) {
      console.error("[party:bluff-submit] failed", res.error);
      setError("Couldn't save your fake. Try again.");
      return;
    }
    setConfirmKey((k) => k + 1); // juice-only: submit confirmation pop
    void refreshDetail();
  }

  // ── Forfeit-this-round (Phase 2) ──
  // Submits a sentinel "__forfeit__" answer via the existing endpoint so the
  // server-side dedup + truth-check logic still applies; the vote step shows
  // the sentinel like any other fake, and the player just doesn't earn fooling
  // points from it. Lightweight V1 — a cleaner approach (separate /forfeit
  // route + hidden flag) is V3 work.
  async function forfeitRound() {
    if (!roundId || forfeited || submitting) return;
    setSubmitting(true);
    setError(null);
    setForfeited(true);
    const res = await apiPost(`/api/party/bluff/rounds/${roundId}/answer`, {
      text: "__forfeit__",
    });
    setSubmitting(false);
    if (!res.ok) {
      setForfeited(false);
      console.error("[party:bluff-forfeit] failed", res.error);
      setError("Couldn't forfeit. Try again.");
      return;
    }
    void refreshDetail();
  }

  // Phase 2 vote auto-decide callbacks (75% threshold). Use effective host
  // so a host-disconnect can't stall the post-round transition.
  const handleAutoPlayAgain = useCallback(() => {
    if (isEffectiveHost) void startRound();
  }, [isEffectiveHost, startRound]);
  const handleAutoBackToLobby = useCallback(() => {
    if (isEffectiveHost) onReturnToLobby();
  }, [isEffectiveHost, onReturnToLobby]);

  // ── Rematch CTA (Bucket C 2026-06-05) ──
  // Host-only fresh-start: scores cleared, ready flags cleared, room → lobby.
  // Non-host clients see a quiet "waiting for host" pill so the screen never
  // feels abandoned post-reveal.
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
    await ch.send({ type: "broadcast", event: PARTY_EVENTS.GAME_ENDED, payload: {} });
    setRematchPending(false);
  }, [isEffectiveHost, rematchPending, room.code]);

  // ── Vote ──
  const [voting, setVoting] = useState(false);
  async function castVote(answerId: string) {
    if (!roundId || voting) return;
    setVoting(true);
    setError(null);
    const res = await apiPost(`/api/party/bluff/rounds/${roundId}/vote`, { answer_id: answerId });
    setVoting(false);
    if (!res.ok) {
      console.error("[party:bluff-vote] failed", res.error);
      setError("Couldn't cast your vote. Try again.");
      return;
    }
    void refreshDetail();
  }

  // Phase transition: clear stale error from the previous phase so e.g. a
  // write-phase submit failure doesn't bleed into vote.
  useEffect(() => {
    setError(null);
  }, [phase]);

  // ── Render ──
  const playersForBoard = useMemo(() => players.map((p) => ({
    user_id: p.user_id,
    username: p.username,
    score: p.score,
  })), [players]);

  if (phase === "loading" || !detail) {
    // Intermission flavor when any player has scored — running scoreboard +
    // intermission framing. Falls back to the first-round cinematic loader.
    if (players.some((p) => (p.score ?? 0) > 0)) {
      return (
        <IntermissionCard
          players={players}
          meUserId={meUserId}
          accent="#FFD700"
          headline="NEXT ROUND IS LOADING"
          sub="queueing trivia, brewing fakes"
        />
      );
    }
    // Cinematic loading — same shape as the Sketchy intro, gold-flavored to
    // match Bluff's accent. Two pulsing radial glows (gold primary + purple
    // accent) staggered behind the spinner.
    return (
      <div className="flex flex-col items-center py-20 gap-5 relative">
        <div className="relative w-28 h-28 flex items-center justify-center">
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
            style={{
              background: "radial-gradient(circle, rgba(255,215,0,0.45) 0%, transparent 70%)",
            }}
          />
          <span
            aria-hidden="true"
            className={`absolute inset-3 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
            style={{
              background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 70%)",
              animationDelay: "0.6s",
            }}
          />
          <div className="w-12 h-12 rounded-full border-2 border-[#FFD700]/40 border-t-[#FFD700] animate-spin relative z-10" />
        </div>
        <p className="font-bebas text-2xl text-cream/70 tracking-[0.3em]">DEALING ROUND</p>
        <p className="text-cream/40 text-xs font-syne italic">queueing trivia, brewing fakes</p>
      </div>
    );
  }

  const round = detail.round;
  // Time-pressure vignette — active write or vote phase under 5s, drawer-style
  // pulse on the screen edges. pa-panic-vignette + pointer-events: none from
  // the CSS class so it never blocks the fake input / vote tap.
  const showPanicVignette =
    (phase === "write" || phase === "vote") && timeLeft > 0 && timeLeft < 5 && !reduced;
  const showCountdown = countdownTicks > 0 && phase === "write";

  const mePlayer = players.find((p) => p.user_id === meUserId);
  const isPendingJoiner = !!mePlayer?.is_pending_round;

  return (
    <div className="space-y-4">
      {isPendingJoiner && <JoiningNextRoundBanner variant="bluff" />}
      {showPanicVignette && <div aria-hidden="true" className="pa-panic-vignette" />}
      {showCountdown && (
        <motion.div
          key={`countdown-${countdownTicks}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          aria-hidden="true"
          className="fixed inset-0 z-40 flex flex-col items-center justify-center pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(8,6,16,0.78) 0%, rgba(8,6,16,0.92) 100%)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div className="flex flex-col items-center gap-2 mb-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-cream/50">
              round {round.round_num}
            </p>
            <p className="font-bebas text-3xl sm:text-4xl tracking-wider text-cream">
              get ready to <span className="text-[#FFD700]">bluff</span>
            </p>
            {round.category && (
              <span
                className="mt-1 inline-flex items-center font-bebas text-xs tracking-[0.25em] px-3 py-1 rounded-full"
                style={{
                  background: "rgba(255,215,0,0.18)",
                  border: "1px solid rgba(255,215,0,0.45)",
                  color: "#FDE68A",
                }}
              >
                {round.category}
              </span>
            )}
          </div>
          <motion.p
            key={`tick-${countdownTicks}`}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.6, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 18 }}
            className="font-bebas text-[10rem] sm:text-[14rem] leading-none tracking-wider text-[#FFD700]"
            style={{ textShadow: "0 0 64px rgba(255,215,0,0.5)" }}
          >
            {countdownTicks}
          </motion.p>
          <p className="font-bebas text-sm tracking-[0.4em] text-cream/55 mt-6">
            write a fake. fool the room.
          </p>
        </motion.div>
      )}
      <NinnyHostBubble message={ninnyMsg} />

      {/* Question card */}
      <div
        key={round.id}
        className={`rounded-2xl p-5 ${reduced ? "" : "ca-pop-in"}`}
        style={{
          background: "linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(168,85,247,0.05) 100%)",
          border: "1px solid rgba(255,215,0,0.35)",
          boxShadow: "0 0 24px rgba(255,215,0,0.1)",
        }}
      >
        {round.category && (() => {
          // Category icon — pulls from public/bluff/<slug>.jpg. Falls back to
          // no-icon (just the label) when the file doesn't exist for a newly-
          // added category. Slug = lowercase of the category name.
          const slug = round.category.toLowerCase();
          return (
            <div className="flex items-center gap-2 mb-2">
              <img
                src={`/bluff/${slug}.jpg`}
                alt=""
                aria-hidden="true"
                className="w-7 h-7 rounded-md object-cover flex-shrink-0"
                style={{
                  border: "1px solid rgba(255,215,0,0.35)",
                  boxShadow: "0 0 10px rgba(255,215,0,0.18)",
                }}
                onError={(e) => {
                  // Hide image on 404 so unknown categories degrade cleanly.
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
              <p className="font-bebas text-xs text-cream/50 tracking-[0.25em]">
                {round.category.toUpperCase()}
              </p>
            </div>
          );
        })()}
        <p className="font-syne text-lg sm:text-xl text-cream/95 leading-relaxed">
          {round.question}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-bebas text-[10px] tracking-[0.3em] text-cream/40">
            ROUND {round.round_num} · {phase.toUpperCase()}
          </span>
          {phase !== "reveal" && (
            <span
              className={`font-bebas text-2xl ${timeLeft <= 5 ? "text-red-400" : "text-cream/80"} ${
                timeLeft <= 5 && !reduced ? "ca-urgent inline-block" : ""
              }`}
            >
              {timeLeft}s
            </span>
          )}
        </div>
      </div>

      {/* Phase content */}
      <AnimatePresence mode="wait">
        {phase === "write" && (
          <motion.form
            key="write"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            onSubmit={submitFake}
            className="space-y-3"
          >
            <input
              type="text"
              value={fakeInput}
              onChange={(e) => setFakeInput(e.target.value)}
              placeholder={detail.has_submitted ? "Edit your fake..." : "Write your fake answer..."}
              maxLength={80}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl px-4 py-3.5 text-base font-syne text-cream outline-none"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-cream/50 text-xs font-syne">
                {detail.has_submitted ? "Submitted. You can edit until time's up." : "80 chars max."}
              </p>
              <p className="text-cream/40 text-xs font-syne">
                <span className="font-bebas text-sm text-cream/85 tabular-nums">
                  <CountUp value={detail.submitted_count ?? 0} duration={500} />
                </span>{" "}
                / {players.length} submitted
              </p>
            </div>
            {/* Live "N of M answered" progress — fills as players submit */}
            <div className="h-1.5 rounded-full bg-cream/[0.07] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${players.length > 0 ? ((detail.submitted_count ?? 0) / players.length) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #FFD700, #B8960C)",
                  transition: reduced ? "none" : "width 0.5s var(--ease-out-quart)",
                }}
              />
            </div>
            {/* Player-roster chip strip — one chip per active player. Dim gray
                + initial when pending, gold + ring when their fake has landed
                server-side. Kahoot-lobby vibe; gives the room "everyone but
                Jordan is in" social pressure without naming holdouts loudly. */}
            {players.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {players.map((p) => {
                  const submitted = (detail.submitted_user_ids ?? []).includes(p.user_id);
                  const isMe = p.user_id === meUserId;
                  const initial = (p.username ?? "?").slice(0, 1).toUpperCase();
                  return (
                    <span
                      key={p.user_id}
                      title={`${p.username ?? "Player"}${submitted ? " · submitted" : " · still writing"}`}
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-bebas text-xs transition-all ${submitted && !reduced ? "pa-pop-in" : ""}`}
                      style={{
                        background: submitted
                          ? "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)"
                          : "rgba(255,255,255,0.06)",
                        border: submitted
                          ? "1.5px solid rgba(255,215,0,0.7)"
                          : isMe
                            ? "1.5px solid rgba(168,85,247,0.55)"
                            : "1px solid rgba(255,255,255,0.14)",
                        color: submitted ? "#04080F" : "rgba(238,244,255,0.7)",
                        boxShadow: submitted ? "0 0 8px rgba(255,215,0,0.45)" : "none",
                      }}
                    >
                      {initial}
                    </span>
                  );
                })}
              </div>
            )}
            <button
              key={confirmKey}
              type="submit"
              disabled={!fakeInput.trim() || submitting || forfeited}
              className={`w-full py-3 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95 disabled:opacity-30 ${
                confirmKey > 0 && !reduced ? "pa-confirm-pop" : ""
              }`}
              style={{
                background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                color: "#04080F",
                boxShadow: "0 4px 18px rgba(255,215,0,0.3)",
              }}
            >
              {forfeited ? "FORFEITED THIS ROUND" : detail.has_submitted ? "UPDATE FAKE" : "SUBMIT FAKE"}
            </button>
            {/* Phase 2 forfeit — for stuck players who can't think of a fake.
                Submits a sentinel answer; the existing vote logic excludes it
                from fooling-points naturally. */}
            {!forfeited && !detail.has_submitted && (
              <button
                type="button"
                onClick={forfeitRound}
                disabled={submitting}
                className="w-full py-2 rounded-xl font-syne text-xs text-cream/55 hover:text-cream/85 transition-colors disabled:opacity-40"
              >
                I&apos;m out — skip me this round
              </button>
            )}
          </motion.form>
        )}

        {phase === "vote" && detail.answers && (
          <motion.div
            key="vote"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-2"
          >
            <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">PICK THE REAL ANSWER</p>
            {detail.answers.map((a, i) => {
              const isMine = detail.my_vote_answer_id === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => castVote(a.id)}
                  disabled={voting}
                  className={`w-full text-left rounded-xl px-4 py-3 transition-all active:scale-[0.98] hover:-translate-y-0.5 disabled:opacity-60 ${reduced ? "" : "pa-deal-in"}`}
                  style={{
                    background: isMine
                      ? "linear-gradient(135deg, rgba(168,85,247,0.22) 0%, rgba(124,58,237,0.1) 100%)"
                      : "rgba(255,255,255,0.04)",
                    border: isMine
                      ? "1px solid rgba(168,85,247,0.55)"
                      : "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(238,244,255,0.92)",
                    ...(reduced ? {} : { animationDelay: `${i * 80}ms` }),
                  }}
                >
                  <span className="font-syne text-base">{a.text}</span>
                  {isMine && (
                    <span className="ml-2 font-bebas text-[10px] tracking-wider text-purple-200">
                      YOUR VOTE
                    </span>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}

        {phase === "reveal" && detail.answers && (
          <motion.div
            key="reveal"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-4"
          >
            <div
              className={`rounded-2xl p-5 text-center ${reduced ? "" : "pa-pop-in"}`}
              style={{
                background: "linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(255,215,0,0.1) 100%)",
                border: "1px solid rgba(34,197,94,0.45)",
              }}
            >
              <p className="font-bebas text-xs tracking-[0.3em] text-cream/55 mb-1">THE TRUTH</p>
              <p className="font-bebas text-3xl tracking-wider">
                <RevealText
                  text={String(round.correct_answer ?? "")}
                  color="#86EFAC"
                  glow="0 0 8px rgba(34,197,94,0.45)"
                />
              </p>
            </div>

            {/* "You fooled N people" — sum of votes on the fakes I authored.
                Derived from the reveal payload already in client state.
                Per-fooler confetti burst when N >= 1. */}
            {(() => {
              const myFooledVotes = detail.answers!
                .filter((a) => !a.is_truth && a.author_user_id === meUserId)
                .reduce((sum, a) => sum + (a.vote_count ?? 0), 0);
              if (myFooledVotes <= 0) return null;
              return (
                <>
                  <Confetti
                    trigger={!reduced}
                    count={50}
                    origin="top"
                    duration={1800}
                    palette={["#FFD700", "#A855F7", "#FDE68A", "#E9D5FF"]}
                  />
                  <div
                    className={`rounded-xl px-4 py-2.5 text-center ${reduced ? "" : "pa-pop-in"}`}
                    style={{
                      background: "linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(99,102,241,0.08) 100%)",
                      border: "1px solid rgba(168,85,247,0.4)",
                    }}
                  >
                    <span className="font-bebas text-base tracking-wider text-purple-200">
                      YOU FOOLED <CountUp value={myFooledVotes} duration={800} />{" "}
                      {myFooledVotes === 1 ? "PLAYER" : "PLAYERS"}!
                    </span>
                  </div>
                </>
              );
            })()}

            <div className="space-y-2">
              {detail.answers
                .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
                .map((a, i) => {
                  const author = players.find((p) => p.user_id === a.author_user_id);
                  return (
                    <div
                      key={a.id}
                      className={`rounded-xl px-4 py-3 flex items-center justify-between ${
                        reduced ? "" : "pa-deal-in"
                      } ${a.is_truth && !reduced ? "pa-truth-glow" : ""}`}
                      style={{
                        background: a.is_truth
                          ? "linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%)"
                          : "rgba(255,255,255,0.03)",
                        border: a.is_truth
                          ? "1px solid rgba(34,197,94,0.4)"
                          : "1px solid rgba(255,255,255,0.08)",
                        ...(reduced ? {} : { animationDelay: `${i * 90}ms` }),
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-syne text-sm text-cream/90">{a.text}</p>
                        <p className="text-cream/40 text-[11px] font-syne mt-0.5">
                          {a.is_truth ? "TRUTH" : `by ${author?.username ?? "Someone"}`}
                        </p>
                        {/* Voter chips — small avatar circles showing exactly
                            who fell for this answer (or for the truth, who got
                            it right). Stagger-deals in. ICE COLD badge when
                            nobody picked the truth, gold-flash on the worst
                            (most-fooling) fake. */}
                        {(a.voters ?? []).length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            {(a.voters ?? []).map((vId, vi) => {
                              const voter = players.find((p) => p.user_id === vId);
                              const initial = (voter?.username ?? "?").slice(0, 1).toUpperCase();
                              return (
                                <span
                                  key={`${a.id}-v-${vId}`}
                                  title={voter?.username ?? "Player"}
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-bebas text-[10px] ${reduced ? "" : "pa-pop-in"}`}
                                  style={{
                                    background: a.is_truth
                                      ? "linear-gradient(135deg, #22C55E 0%, #15803D 100%)"
                                      : "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                                    color: "#04080F",
                                    border: "1px solid rgba(0,0,0,0.15)",
                                    ...(reduced ? {} : { animationDelay: `${i * 90 + vi * 60}ms` }),
                                  }}
                                >
                                  {initial}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {a.is_truth && (a.voters ?? []).length === 0 && (
                          <span className="mt-2 inline-flex items-center font-bebas text-[10px] tracking-[0.25em] px-2 py-0.5 rounded-full text-sky-200"
                            style={{
                              background: "rgba(125,211,252,0.12)",
                              border: "1px solid rgba(125,211,252,0.4)",
                            }}
                          >
                            ICE COLD · nobody believed it
                          </span>
                        )}
                      </div>
                      <span className="font-bebas text-lg text-cream/80 ml-3 flex-shrink-0">
                        <CountUp value={a.vote_count ?? 0} duration={700} />{" "}
                        {(a.vote_count ?? 0) === 1 ? "vote" : "votes"}
                      </span>
                    </div>
                  );
                })}
            </div>

            <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} />

            {/* Phase 2 — real post-round vote (auto-decides at 75%). */}
            <PostRoundVoteCard
              roundId={round.id}
              roundKind="bluff"
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
                      background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                      color: "#04080F",
                      boxShadow: "0 4px 18px rgba(255,215,0,0.3)",
                    }}
                  >
                    NEXT ROUND
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
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="text-red-400 text-sm font-syne text-center" role="alert">
          {error}
        </p>
      )}

      {phase !== "reveal" && (
        <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} compact />
      )}

      {/* Phase 2 mid-game invite (host only). Floating in the upper right so
          it doesn't disrupt the question card flow. */}
      {isHost && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-30 px-3.5 py-2 rounded-full font-bebas text-xs tracking-wider transition-all active:scale-95"
          style={{
            background: "rgba(16,12,26,0.9)",
            border: "1px solid rgba(255,215,0,0.45)",
            color: "#FFD700",
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
