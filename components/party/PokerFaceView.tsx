"use client";

// PokerFaceView — the per-round screen for Poker Face (Lionade Party).
//
// N-player (3-8) presenter-rotation bluff game. Each round the SERVER picks one
// presenter (rotating through the room) and deals them a secret fact card. The
// presenter chooses to present the TRUE fact or invent a LIE, then presents the
// claim to the room. Everyone else calls BELIEVE or DOUBT. Reveal + score, then
// the presenter rotates next round. NO ELO, NO Fangs — pure points.
//
// "Best in person": the presenter's FACE is the tell, so there is no
// confidence-wager mechanic. We surface a small "gather your crew" banner.
//
// Three phases, server-driven (we poll the round detail every ~1.5s and also
// subscribe to phase_changed broadcasts, mirroring BluffView):
//   1. "present" — presenter decides truth/lie + writes the claim. Others wait.
//   2. "vote"    — callers call believe/doubt. Presenter watches the count.
//   3. "reveal"  — truth shown, who was fooled, scoreboard, Next Round CTA.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api-client";
import PartyScoreboard from "./PartyScoreboard";
import IntermissionCard from "./IntermissionCard";
import NinnyHostBubble from "./NinnyHostBubble";
import CountUp from "@/components/CountUp";
import { pokerFaceChannel, POKERFACE_EVENTS } from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";
import PostRoundVoteCard from "./PostRoundVoteCard";
import MidGameInviteModal from "./MidGameInviteModal";
import type { PartyPlayer, PartyRoom, PokerFaceCall } from "@/lib/party/types";

interface Props {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
  onReturnToLobby: () => void;
}

type Phase = "loading" | "present" | "interrogate" | "vote" | "reveal";

const ACCENT = "#00BFFF";
const DEFAULT_CALL_SECONDS = 30;
const INTERROGATE_SECONDS = 25;

interface RoundDetail {
  round: {
    id: string;
    room_id: string;
    round_num: number;
    presenter_user_id: string;
    presenter_username: string | null;
    card_word: string;
    phase: "present" | "interrogate" | "vote" | "reveal";
    started_at: string;
    presented_at: string | null;
    ended_at: string | null;
    is_presenter: boolean;
    interrogator_user_id?: string | null;
    interrogator_username?: string | null;
    my_call?: PokerFaceCall | null;
    caller_count?: number;
    call_count?: number;
    claim_text?: string | null;
    card_fact?: string | null;   // presenter-only (present + vote)
    is_lie?: boolean | null;     // presenter-only (vote)
    reveal?: {
      is_lie: boolean;
      card_fact: string;
      claim_text: string;
      calls: { user_id: string; username: string | null; call: PokerFaceCall; correct: boolean }[];
      round_points: Record<string, number>;
    };
  };
}

export default function PokerFaceView({
  room,
  players,
  isHost,
  meUserId,
  onReturnToLobby,
}: Props) {
  const reduced = useReducedMotion();
  const [roundId, setRoundId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RoundDetail["round"] | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [lieText, setLieText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ninnyMsg, setNinnyMsg] = useState<string | null>("Read the room. Trust no face.");
  const [timeLeft, setTimeLeft] = useState(0);
  const advanceLock = useRef(false);
  const interrogateLock = useRef(false);

  // 3-2-1 pre-round countdown — fires on loading → present transition only
  // (each new round). Same mechanism as Sketchy + Bluff. Distinct ref from
  // the card-flip prevPhaseRef below so the two phase-watchers don't fight.
  const [countdownTicks, setCountdownTicks] = useState(0);
  const countdownPrevPhaseRef = useRef<Phase>("loading");
  useEffect(() => {
    const prev = countdownPrevPhaseRef.current;
    countdownPrevPhaseRef.current = phase;
    if (prev === "loading" && phase === "present" && !reduced) {
      setCountdownTicks(3);
    }
  }, [phase, reduced]);
  useEffect(() => {
    if (countdownTicks <= 0) return;
    const t = setTimeout(() => setCountdownTicks(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdownTicks]);

  // ── Mode + game length (from room settings; default in-person, 2 rotations) ──
  // In-person: the claim is spoken out loud, so no claim text is shown and the
  // presenter only privately picks truth/lie. Remote: the typed-claim flow.
  const inperson = (room.settings?.pf_mode ?? "inperson") !== "remote";
  const rotations = Math.min(3, Math.max(1, room.settings?.pf_rotations ?? 2));
  // Player count is frozen at game start (room.settings.pf_player_count) so a
  // mid-game leaver can't shrink the game length; fall back to live count for
  // any pre-existing room that started before this was recorded.
  const presenterCount = room.settings?.pf_player_count ?? players.length;
  const totalRounds = rotations * Math.max(1, presenterCount);

  // Presenter's private truth/lie pick for in-person (a beat to compose before
  // opening the table — nothing is typed).
  const [intent, setIntent] = useState<"truth" | "lie" | null>(null);

  // Phase 2 — mid-game invite modal (host surface).
  const [inviteOpen, setInviteOpen] = useState(false);

  // ── Card-flip bookkeeping ──
  // The card-word WORD element flips on the X axis on each phase transition
  // WITHIN a round (present -> interrogate -> vote -> reveal). The initial
  // mount of the round does not flip — only subsequent transitions do, so the
  // "card lands on the table" beat is reserved for actual phase changes.
  // cardFlipKey bumps on every transition so the keyed React element remounts
  // and the CSS animation re-fires cleanly. Resets per round.
  const [cardFlipKey, setCardFlipKey] = useState(0);
  const prevPhaseRef = useRef<Phase | null>(null);
  const flipRoundIdRef = useRef<string | null>(null);
  useEffect(() => {
    // New round? Reset the prevPhase tracker so the first phase of the new round
    // counts as the baseline (no flip on initial render of a fresh round).
    if (detail && detail.id !== flipRoundIdRef.current) {
      flipRoundIdRef.current = detail.id;
      prevPhaseRef.current = phase;
      return;
    }
    if (prevPhaseRef.current !== null && prevPhaseRef.current !== phase) {
      setCardFlipKey((k) => k + 1);
    }
    prevPhaseRef.current = phase;
  }, [phase, detail]);

  // Per-GAME tally accumulated across rounds, for the end-game awards. Resets
  // naturally on remount (= a fresh game); countedRoundsRef gates double-count.
  const [tally, setTally] = useState<{ fooled: Record<string, number>; correct: Record<string, number> }>({
    fooled: {},
    correct: {},
  });
  const countedRoundsRef = useRef<Set<string>>(new Set());

  // End-game awards (most callers fooled = Bluff Master; most correct reads =
  // Human Lie Detector). First-max wins ties — fine for a party game.
  const awards = useMemo(() => {
    const top = (rec: Record<string, number>) => {
      let best: { user_id: string; count: number } | null = null;
      for (const [uid, n] of Object.entries(rec)) {
        if (n > 0 && (!best || n > best.count)) best = { user_id: uid, count: n };
      }
      return best;
    };
    const nameOf = (uid: string) => players.find((p) => p.user_id === uid)?.username ?? "Player";
    const bm = top(tally.fooled);
    const ld = top(tally.correct);
    return {
      bluffMaster: bm ? { name: nameOf(bm.user_id), count: bm.count } : null,
      lieDetector: ld ? { name: nameOf(ld.user_id), count: ld.count } : null,
    };
  }, [tally, players]);

  // ── Start a fresh round (host) ──
  const startRound = useCallback(async () => {
    setPhase("loading");
    setDetail(null);
    setLieText("");
    setIntent(null);
    setError(null);
    const res = await apiPost<{ round: { id: string } }>(
      "/api/party/pokerface/rounds",
      { code: room.code },
    );
    if (!res.ok || !res.data) {
      setError("Couldn't deal a round. Try again.");
      return;
    }
    setRoundId(res.data.round.id);
    setPhase("present");
    const ch = supabase.channel(pokerFaceChannel(room.code));
    await ch.send({
      type: "broadcast",
      event: POKERFACE_EVENTS.ROUND_STARTED,
      payload: { round_id: res.data.round.id },
    });
  }, [room.code]);

  // Host auto-deals the first round.
  useEffect(() => {
    if (isHost && !roundId && phase === "loading") {
      void startRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // ── Listen for round + phase broadcasts ──
  useEffect(() => {
    const ch = supabase.channel(pokerFaceChannel(room.code));
    ch.on("broadcast", { event: POKERFACE_EVENTS.ROUND_STARTED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { round_id?: string };
      if (payload.round_id && payload.round_id !== roundId) {
        setRoundId(payload.round_id);
        setPhase("present");
        setLieText("");
        setIntent(null);
        setDetail(null);
      }
    });
    ch.on("broadcast", { event: POKERFACE_EVENTS.PRESENTED }, () => void refreshDetail());
    ch.on("broadcast", { event: POKERFACE_EVENTS.PHASE_CHANGED }, () => void refreshDetail());
    ch.on("broadcast", { event: POKERFACE_EVENTS.ROUND_ENDED }, () => void refreshDetail());
    // Phase 2: wrap with exponential-backoff resubscribe so a transient WS
    // drop doesn't silently leave the poker face channel dead.
    const handle = subscribeResilient(ch, { label: `pokerface-room:${room.code}` });
    return () => {
      handle.cancel();
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code, roundId]);

  // ── Poll round detail (server is the source of truth) ──
  const refreshDetail = useCallback(async () => {
    if (!roundId) return;
    const res = await apiGet<RoundDetail>(`/api/party/pokerface/rounds/${roundId}`);
    if (!res.ok || !res.data) return;
    const r = res.data.round;
    setDetail(r);
    setPhase(r.phase);

    // Accumulate the per-game tally exactly once per round when its reveal lands
    // (drives the end-game awards). Correct readers count toward Lie Detector;
    // each fooled caller counts toward the presenter's Bluff Master tally.
    if (r.phase === "reveal" && r.reveal && !countedRoundsRef.current.has(r.id)) {
      countedRoundsRef.current.add(r.id);
      const calls = r.reveal.calls;
      const presenterId = r.presenter_user_id;
      setTally((prev) => {
        const fooled = { ...prev.fooled };
        const correct = { ...prev.correct };
        for (const c of calls) {
          if (c.correct) correct[c.user_id] = (correct[c.user_id] ?? 0) + 1;
          else fooled[presenterId] = (fooled[presenterId] ?? 0) + 1;
        }
        return { fooled, correct };
      });
    }

    if (r.phase === "present") {
      setNinnyMsg(
        r.is_presenter
          ? inperson
            ? "Your fact is secret. Tell it straight, or twist it. The room only has your face to read."
            : "Your card is secret. Tell the truth, or invent a convincing lie."
          : `${r.presenter_username ?? "The presenter"} is studying their card...`,
      );
    } else if (r.phase === "interrogate") {
      const grillName = r.interrogator_username ?? "Someone";
      setNinnyMsg(
        r.interrogator_user_id === meUserId
          ? "Your turn to grill. Ask them one question out loud, then open the vote."
          : r.is_presenter
            ? `${grillName} gets to ask you one question. Answer out loud and hold your face.`
            : `${grillName} is grilling the presenter. Listen for the crack.`,
      );
    } else if (r.phase === "vote") {
      setNinnyMsg(
        r.is_presenter
          ? "You've presented. Hold your face. Give them nothing."
          : inperson
            ? "They made their claim out loud. Did their face give it away?"
            : "Believe the claim, or call the bluff. Read between the lines.",
      );
    } else if (r.phase === "reveal") {
      setNinnyMsg(r.reveal?.is_lie ? "It was a LIE. Who fell for it?" : "It was the TRUTH. The doubters got played by an honest face.");
    }
  }, [roundId, inperson, meUserId]);

  useEffect(() => {
    if (!roundId) return;
    void refreshDetail();
    const iv = setInterval(refreshDetail, 1500);
    return () => clearInterval(iv);
  }, [roundId, refreshDetail]);

  // ── Vote-phase timer + auto-complete (host) ──
  useEffect(() => {
    if (!detail || detail.phase !== "vote" || !detail.presented_at) {
      setTimeLeft(0);
      return;
    }
    const callSeconds = room.settings?.pf_vote_seconds ?? DEFAULT_CALL_SECONDS;
    const targetMs = new Date(detail.presented_at).getTime() + callSeconds * 1000;
    const rid = detail.id;
    function tick() {
      const remain = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setTimeLeft(remain);
      if (remain === 0 && isHost && !advanceLock.current) {
        advanceLock.current = true;
        void apiPost(`/api/party/pokerface/rounds/${rid}/complete`, {}).then(() => {
          advanceLock.current = false;
          void refreshDetail();
          void supabase.channel(pokerFaceChannel(room.code)).send({
            type: "broadcast",
            event: POKERFACE_EVENTS.PHASE_CHANGED,
            payload: { round_id: rid },
          });
        });
      }
    }
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [detail, isHost, room.code, room.settings?.pf_vote_seconds, refreshDetail]);

  // ── Interrogation timer + auto-open-vote (host backstop) ──
  // The grill is spoken; this just bounds the beat so it can't stall. The host
  // (or the interrogator, via the button) opens the vote; here the host's client
  // auto-fires when the window elapses.
  useEffect(() => {
    if (!detail || detail.phase !== "interrogate" || !detail.presented_at) {
      return;
    }
    const targetMs = new Date(detail.presented_at).getTime() + INTERROGATE_SECONDS * 1000;
    const rid = detail.id;
    // Either the host OR the interrogator's client may fire the backstop (the
    // server authorizes both), so a host-drop mid-grill can't stall the round.
    const canAdvance = isHost || detail.interrogator_user_id === meUserId;
    function tick() {
      const remain = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setTimeLeft(remain);
      if (remain === 0 && canAdvance && !interrogateLock.current) {
        interrogateLock.current = true;
        void apiPost(`/api/party/pokerface/rounds/${rid}/open-vote`, {}).then(() => {
          interrogateLock.current = false;
          void refreshDetail();
          void supabase.channel(pokerFaceChannel(room.code)).send({
            type: "broadcast",
            event: POKERFACE_EVENTS.PHASE_CHANGED,
            payload: { round_id: rid },
          });
        });
      }
    }
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [detail, isHost, meUserId, room.code, refreshDetail]);

  // ── Open the vote (end the Interrogation) — host or interrogator ──
  async function openVote() {
    if (!roundId) return;
    const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/open-vote`, {});
    if (!res.ok) {
      setError(res.error ?? "Couldn't open the vote.");
      return;
    }
    void refreshDetail();
    void supabase.channel(pokerFaceChannel(room.code)).send({
      type: "broadcast",
      event: POKERFACE_EVENTS.PHASE_CHANGED,
      payload: { round_id: roundId },
    });
  }

  // ── Presenter: commit truth or lie ──
  async function present(isLie: boolean) {
    if (!roundId || submitting) return;
    // Remote lies need typed text; in-person lies are spoken (no text required).
    if (!inperson && isLie && !lieText.trim()) {
      setError("Write the lie you want to present.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/present`, {
      isLie,
      claimText: !inperson && isLie ? lieText.trim() : undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't present the hand.");
      return;
    }
    void refreshDetail();
    void supabase.channel(pokerFaceChannel(room.code)).send({
      type: "broadcast",
      event: POKERFACE_EVENTS.PRESENTED,
      payload: { round_id: roundId },
    });
  }

  // ── Caller: call believe / doubt ──
  async function call(c: PokerFaceCall) {
    if (!roundId) return;
    const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/call`, { call: c });
    if (!res.ok) {
      setError(res.error ?? "Couldn't submit your call.");
      return;
    }
    void refreshDetail();
    void supabase.channel(pokerFaceChannel(room.code)).send({
      type: "broadcast",
      event: POKERFACE_EVENTS.CALL_SUBMITTED,
      payload: { round_id: roundId },
    });
  }

  // ── Host can force the reveal once everyone has called ──
  async function revealNow() {
    if (!roundId || !isHost) return;
    const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/complete`, {});
    if (!res.ok) {
      setError(res.error ?? "Couldn't reveal the round.");
      return;
    }
    void refreshDetail();
    void supabase.channel(pokerFaceChannel(room.code)).send({
      type: "broadcast",
      event: POKERFACE_EVENTS.PHASE_CHANGED,
      payload: { round_id: roundId },
    });
  }

  const playersForBoard = useMemo(
    () => players.map((p) => ({ user_id: p.user_id, username: p.username, score: p.score })),
    [players],
  );

  // Phase 2 vote auto-decide callbacks (75% threshold). Only fire on the
  // post-round reveal screen when the game isn't already game-over.
  const handleAutoPlayAgain = useCallback(() => {
    if (isHost) void startRound();
  }, [isHost, startRound]);
  const handleAutoBackToLobby = useCallback(() => {
    if (isHost) onReturnToLobby();
  }, [isHost, onReturnToLobby]);

  if (phase === "loading" || !detail) {
    // Intermission flavor when any player has scored — running scoreboard +
    // intermission framing. Falls back to the first-round cinematic loader.
    if (players.some((p) => (p.score ?? 0) > 0)) {
      return (
        <IntermissionCard
          players={players}
          meUserId={meUserId}
          accent={ACCENT}
          headline="NEXT ROUND IS LOADING"
          sub="picking a presenter, shuffling the deck"
        />
      );
    }
    // Cinematic loading — same template as Sketchy / Bluff, electric-blue
    // flavored to match Poker Face's ACCENT.
    return (
      <div className="flex flex-col items-center py-20 gap-5 relative">
        <div className="relative w-28 h-28 flex items-center justify-center">
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
            style={{
              background: `radial-gradient(circle, ${ACCENT}73 0%, transparent 70%)`,
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
          <div
            className="w-12 h-12 rounded-full border-2 animate-spin relative z-10"
            style={{ borderColor: `${ACCENT}40`, borderTopColor: ACCENT }}
          />
        </div>
        <p className="font-bebas text-2xl text-cream/70 tracking-[0.3em]">DEALING THE CARD</p>
        <p className="text-cream/40 text-xs font-syne italic">picking a presenter, shuffling the deck</p>
      </div>
    );
  }

  const round = detail;
  const isPresenter = round.is_presenter;
  const callsIn = round.call_count ?? 0;
  const callerCount = round.caller_count ?? Math.max(0, players.length - 1);
  const everyoneCalled = callerCount > 0 && callsIn >= callerCount;
  // Time-pressure vignette during active vote or interrogate phases under 5s.
  // Reuses pa-panic-vignette from Sketchy.
  const showPanicVignette =
    (phase === "vote" || phase === "interrogate") && timeLeft > 0 && timeLeft < 5 && !reduced;
  const showCountdown = countdownTicks > 0 && phase === "present";

  return (
    <div className="space-y-4">
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
              round {round.round_num} of {totalRounds}
            </p>
            <p className="font-bebas text-3xl sm:text-4xl tracking-wider text-cream">
              {isPresenter
                ? <>your turn to <span style={{ color: ACCENT }}>present</span></>
                : <>{round.presenter_username ?? "presenter"} <span className="text-cream/45">is presenting</span></>}
            </p>
            {round.card_word && (
              <span
                className="mt-1 inline-flex items-center font-bebas text-xs tracking-[0.25em] px-3 py-1 rounded-full"
                style={{
                  background: `${ACCENT}2e`,
                  border: `1px solid ${ACCENT}73`,
                  color: ACCENT,
                }}
              >
                {round.card_word.toUpperCase()}
              </span>
            )}
          </div>
          <motion.p
            key={`tick-${countdownTicks}`}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.6, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 18 }}
            className="font-bebas text-[10rem] sm:text-[14rem] leading-none tracking-wider"
            style={{ color: ACCENT, textShadow: `0 0 64px ${ACCENT}80` }}
          >
            {countdownTicks}
          </motion.p>
          <p className="font-bebas text-sm tracking-[0.4em] text-cream/55 mt-6">
            {isPresenter ? "truth or lie — your call" : "read the face. call it."}
          </p>
        </motion.div>
      )}
      <NinnyHostBubble message={ninnyMsg} />

      {/* Best-played banner — the face is the tell. */}
      <div
        className="rounded-xl px-4 py-2.5 flex items-center gap-2.5"
        style={{
          background: `linear-gradient(135deg, ${ACCENT}14 0%, rgba(168,85,247,0.06) 100%)`,
          border: `1px solid ${ACCENT}33`,
        }}
      >
        <span className="text-lg" aria-hidden="true">{inperson ? "👀" : "🎭"}</span>
        <p className="text-cream/70 text-xs sm:text-sm font-syne leading-snug">
          {inperson
            ? "Same room or on a call. Claims are spoken out loud. The face is the tell."
            : "Text only. Read the words and the timing. Trust your gut."}
        </p>
      </div>

      {/* Card header — the WORD everyone can see + presenter + round/phase.
          The WORD itself flips on the X axis on every phase transition within a
          round (present -> interrogate -> vote -> reveal), giving the card a
          "being turned over" feel between beats. perspective lives on the
          container so the rotation reads in 3D, not a flat scaleY. */}
      <div
        className="rounded-2xl p-5 pa-card-flip-3d-perspective"
        style={{
          background: `linear-gradient(135deg, ${ACCENT}1f 0%, rgba(168,85,247,0.06) 100%)`,
          border: `1px solid ${ACCENT}59`,
          boxShadow: `0 0 24px ${ACCENT}1a`,
        }}
      >
        <p className="font-bebas text-xs text-cream/50 tracking-[0.25em] mb-1">THE CARD</p>
        <p
          key={cardFlipKey}
          className={`font-bebas text-3xl sm:text-4xl tracking-wider inline-block ${cardFlipKey > 0 && !reduced ? "pa-card-flip-3d" : ""}`}
          style={{ color: ACCENT, textShadow: `0 0 18px ${ACCENT}55` }}
        >
          {round.card_word.toUpperCase()}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-bebas text-[10px] tracking-[0.3em] text-cream/40">
            ROUND {round.round_num} OF {totalRounds} · {isPresenter ? "YOU PRESENT" : `${round.presenter_username ?? "PRESENTER"} PRESENTS`}
          </span>
          {(phase === "vote" || phase === "interrogate") && (
            <span className={`font-bebas text-2xl ${timeLeft <= 5 ? "text-red-400" : "text-cream/80"}`}>
              {timeLeft}s
            </span>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* ── PRESENT PHASE ── */}
        {phase === "present" && (
          <motion.div
            key="present"
            initial={reduced ? false : { opacity: 0, rotateY: -12, y: 8 }}
            animate={{ opacity: 1, rotateY: 0, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3"
          >
            {isPresenter ? (
              <>
                <div
                  className="rounded-2xl p-5"
                  style={{
                    background: "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <p className="font-bebas text-xs text-cream/45 tracking-[0.25em] mb-1">YOUR SECRET FACT</p>
                  <p className="font-syne text-base sm:text-lg text-cream/95 leading-relaxed">
                    {round.card_fact}
                  </p>
                  <p className="text-cream/40 text-xs font-syne mt-3 italic">
                    {inperson
                      ? "Say it out loud. Tell it straight, or twist it and sell the lie with your face."
                      : "Present this truth, or write a lie and sell it with a straight face."}
                  </p>
                </div>

                {inperson ? (
                  intent === null ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => setIntent("truth")}
                        className="py-4 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95"
                        style={{
                          background: "linear-gradient(135deg, rgba(34,197,94,0.9) 0%, rgba(22,163,74,0.8) 100%)",
                          color: "#04140a",
                          boxShadow: "0 4px 18px rgba(34,197,94,0.3)",
                        }}
                      >
                        TELL THE TRUTH
                      </button>
                      <button
                        onClick={() => setIntent("lie")}
                        className="py-4 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95"
                        style={{
                          background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                          color: "#04080F",
                          boxShadow: `0 4px 18px ${ACCENT}4d`,
                        }}
                      >
                        TELL A LIE
                      </button>
                    </div>
                  ) : (
                    <motion.div
                      initial={reduced ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="space-y-3"
                    >
                      <div
                        className="rounded-xl px-4 py-4 text-center"
                        style={{
                          background: intent === "lie" ? `${ACCENT}14` : "rgba(34,197,94,0.1)",
                          border: intent === "lie" ? `1px solid ${ACCENT}40` : "1px solid rgba(34,197,94,0.35)",
                        }}
                      >
                        <p className="font-bebas text-lg tracking-wider" style={{ color: intent === "lie" ? "#7DD3FC" : "#86EFAC" }}>
                          {intent === "lie" ? "YOU'RE BLUFFING" : "YOU'RE BEING HONEST"}
                        </p>
                        <p className="text-cream/55 text-xs font-syne mt-1 max-w-sm mx-auto leading-snug">
                          {intent === "lie"
                            ? "Make up your lie in your head. Don't type it. Say it out loud and hold your face."
                            : "Read the real fact out loud, word for word. Sound just as shifty as a liar would."}
                        </p>
                      </div>
                      <button
                        onClick={() => present(intent === "lie")}
                        disabled={submitting}
                        className="w-full py-4 rounded-xl font-bebas text-lg tracking-wider transition-all active:scale-95 disabled:opacity-40"
                        style={{
                          background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                          color: "#04080F",
                          boxShadow: `0 4px 20px ${ACCENT}4d`,
                        }}
                      >
                        {submitting ? "OPENING..." : "OPEN THE TABLE"}
                      </button>
                      <button
                        onClick={() => setIntent(null)}
                        disabled={submitting}
                        className="w-full py-2 rounded-xl font-syne text-xs text-cream/45 hover:text-cream/70 transition-colors disabled:opacity-40"
                      >
                        change my mind
                      </button>
                    </motion.div>
                  )
                ) : (
                  <>
                    <input
                      type="text"
                      value={lieText}
                      onChange={(e) => setLieText(e.target.value)}
                      placeholder="Optional: write your lie about this card..."
                      maxLength={280}
                      className="w-full rounded-xl px-4 py-3.5 text-base font-syne text-cream outline-none"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => present(false)}
                        disabled={submitting}
                        className="py-3.5 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95 disabled:opacity-40"
                        style={{
                          background: "linear-gradient(135deg, rgba(34,197,94,0.9) 0%, rgba(22,163,74,0.8) 100%)",
                          color: "#04140a",
                          boxShadow: "0 4px 18px rgba(34,197,94,0.3)",
                        }}
                      >
                        PRESENT THE TRUTH
                      </button>
                      <button
                        onClick={() => present(true)}
                        disabled={submitting || !lieText.trim()}
                        className="py-3.5 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95 disabled:opacity-40"
                        style={{
                          background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                          color: "#04080F",
                          boxShadow: `0 4px 18px ${ACCENT}4d`,
                        }}
                      >
                        PRESENT THE LIE
                      </button>
                    </div>
                    <p className="text-cream/40 text-xs font-syne text-center">
                      To bluff, write your lie above, then tap Present the Lie.
                    </p>
                  </>
                )}
              </>
            ) : (
              // Cinematic "presenter is composing" state — matches the Sketchy
              // "{drawer} is thinking" pattern with the dealing glow rings.
              // Subtle pulse on the verb so the wait beat feels alive.
              <div className="flex flex-col items-center py-10 gap-4 relative">
                <div className="relative w-20 h-20 flex items-center justify-center">
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
                    style={{
                      background: `radial-gradient(circle, ${ACCENT}73 0%, transparent 70%)`,
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className={`absolute inset-2 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
                    style={{
                      background: "radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 70%)",
                      animationDelay: "0.6s",
                    }}
                  />
                  <div
                    className="w-9 h-9 rounded-full border-2 animate-spin relative z-10"
                    style={{ borderColor: `${ACCENT}40`, borderTopColor: ACCENT }}
                  />
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/45">
                  presenting next
                </p>
                <p className="font-bebas text-2xl text-cream tracking-wider text-center">
                  {round.presenter_username ?? "the presenter"}{" "}
                  <span className="text-cream/45">is composing a claim</span>
                </p>
                <span aria-hidden="true" className="inline-flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full ${reduced ? "opacity-70" : "pa-ink-dot"}`}
                      style={{
                        background: ACCENT,
                        animationDelay: `${i * 200}ms`,
                      }}
                    />
                  ))}
                </span>
                <p className="text-cream/45 text-xs font-syne text-center max-w-xs italic">
                  {inperson
                    ? "they're about to make their claim out loud. watch the face."
                    : "truth or lie — you'll have to call it. get ready."}
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* ── INTERROGATION PHASE (live mode only) ── */}
        {phase === "interrogate" && (
          <motion.div
            key="interrogate"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-3"
          >
            <div
              className="rounded-2xl p-6 text-center"
              style={{
                background: `linear-gradient(135deg, ${ACCENT}1f 0%, rgba(168,85,247,0.06) 100%)`,
                border: `1px solid ${ACCENT}59`,
              }}
            >
              <p className="text-3xl mb-2" aria-hidden="true">🔎</p>
              <p className="font-bebas text-xs tracking-[0.3em] text-cream/55 mb-1">THE INTERROGATION</p>
              {round.interrogator_user_id === meUserId ? (
                <>
                  <p className="font-bebas text-2xl tracking-wider text-cream">YOUR TURN TO GRILL</p>
                  <p className="text-cream/60 text-sm font-syne mt-2 max-w-sm mx-auto">
                    Ask {round.presenter_username ?? "the presenter"} one question, out loud. Read how they answer, then open the vote.
                  </p>
                </>
              ) : isPresenter ? (
                <>
                  <p className="font-bebas text-2xl tracking-wider text-cream">
                    {(round.interrogator_username ?? "SOMEONE").toUpperCase()} IS GRILLING YOU
                  </p>
                  <p className="text-cream/60 text-sm font-syne mt-2 max-w-sm mx-auto">
                    Answer their one question out loud. Hold your face. Give nothing away.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bebas text-2xl tracking-wider text-cream">
                    {(round.interrogator_username ?? "SOMEONE").toUpperCase()} IS GRILLING {(round.presenter_username ?? "THE PRESENTER").toUpperCase()}
                  </p>
                  <p className="text-cream/60 text-sm font-syne mt-2 max-w-sm mx-auto">
                    Listen for the crack. The tell is in how they handle the question.
                  </p>
                </>
              )}
            </div>

            {(round.interrogator_user_id === meUserId || isHost) && (
              <button
                onClick={openVote}
                className="w-full py-3.5 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95"
                style={{
                  background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                  color: "#04080F",
                  boxShadow: `0 4px 18px ${ACCENT}4d`,
                }}
              >
                OPEN THE VOTE
              </button>
            )}
            {round.interrogator_user_id !== meUserId && !isHost && (
              <p className="text-cream/40 text-xs font-syne text-center">
                Voting opens when {round.interrogator_username ?? "the interrogator"} is done, or in {timeLeft}s.
              </p>
            )}
          </motion.div>
        )}

        {/* ── VOTE PHASE ── */}
        {phase === "vote" && (
          <motion.div
            key="vote"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-3"
          >
            <div
              className="rounded-2xl p-5"
              style={{
                background: "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {inperson || !round.claim_text ? (
                <>
                  <p className="font-bebas text-xs text-cream/45 tracking-[0.25em] mb-1">THE CLAIM WAS SPOKEN</p>
                  <p className="font-syne text-base sm:text-lg text-cream/95 leading-relaxed">
                    {round.presenter_username ?? "The presenter"} made their claim about{" "}
                    <span style={{ color: ACCENT }}>{round.card_word}</span> out loud. Did you buy it?
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bebas text-xs text-cream/45 tracking-[0.25em] mb-1">THE CLAIM</p>
                  <p className="font-syne text-base sm:text-lg text-cream/95 leading-relaxed">
                    &ldquo;{round.claim_text}&rdquo;
                  </p>
                </>
              )}
            </div>

            {isPresenter ? (
              <div
                className="rounded-xl px-4 py-4 text-center"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <p className="font-bebas text-lg text-cream/70 tracking-wider">HOLD YOUR FACE</p>
                <p className="text-cream/45 text-xs font-syne mt-1">
                  {callsIn} of {callerCount} have called.
                </p>
              </div>
            ) : (
              <>
                <p className="font-bebas text-sm text-cream/60 tracking-[0.25em] text-center">DO YOU BELIEVE IT?</p>
                <div className="grid grid-cols-2 gap-3">
                  {(["believe", "doubt"] as const).map((c) => {
                    const mine = round.my_call === c;
                    const isBelieve = c === "believe";
                    const col = isBelieve ? "#22C55E" : "#EF4444";
                    return (
                      <button
                        key={c}
                        onClick={() => call(c)}
                        className="py-5 rounded-xl font-bebas text-xl tracking-wider transition-all active:scale-95"
                        style={{
                          background: mine
                            ? `linear-gradient(135deg, ${col}cc 0%, ${col}99 100%)`
                            : "rgba(255,255,255,0.04)",
                          border: mine ? `1px solid ${col}` : "1px solid rgba(255,255,255,0.1)",
                          color: mine ? "#04080F" : "rgba(238,244,255,0.85)",
                          boxShadow: mine ? `0 4px 18px ${col}40` : "none",
                        }}
                      >
                        {isBelieve ? "BELIEVE" : "DOUBT"}
                        {mine && <span className="block text-[10px] tracking-[0.2em] mt-0.5">YOUR CALL</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-cream/40 text-xs font-syne text-center">
                  {round.my_call ? "Locked in. You can change it until the reveal." : "Tap to call. Trust the face, not the words."}
                </p>
              </>
            )}

            {isHost && everyoneCalled && (
              <button
                onClick={revealNow}
                className="w-full py-3 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95"
                style={{
                  background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                  color: "#04080F",
                  boxShadow: `0 4px 18px ${ACCENT}4d`,
                }}
              >
                REVEAL NOW
              </button>
            )}
          </motion.div>
        )}

        {/* ── REVEAL PHASE ── */}
        {phase === "reveal" && round.reveal && (
          <motion.div
            key="reveal"
            initial={reduced ? false : { opacity: 0, rotateX: -14, y: 10 }}
            animate={{ opacity: 1, rotateX: 0, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            <div
              className="rounded-2xl p-5 text-center"
              style={{
                background: round.reveal.is_lie
                  ? "linear-gradient(135deg, rgba(239,68,68,0.22) 0%, rgba(168,85,247,0.08) 100%)"
                  : "linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(0,191,255,0.08) 100%)",
                border: round.reveal.is_lie ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(34,197,94,0.45)",
              }}
            >
              <p className="font-bebas text-xs tracking-[0.3em] text-cream/55 mb-1">
                {round.reveal.is_lie ? "THAT WAS A LIE" : "THAT WAS THE TRUTH"}
              </p>
              <p
                className={`font-bebas text-3xl tracking-wider inline-block ${reduced ? "" : "pa-stamp"}`}
                style={{ color: round.reveal.is_lie ? "#FCA5A5" : "#86EFAC" }}
              >
                {round.reveal.is_lie ? "BLUFFED" : "HONEST"}
              </p>
              {/* Always surface the real fact — the educational payoff lands for
                  the whole room every round, truth or lie. */}
              <p className={`text-cream/70 text-sm font-syne mt-3 max-w-md mx-auto ${reduced ? "" : "pa-factoid-up"}`}>
                The real fact: <span className="text-cream/95">{round.reveal.card_fact}</span>
              </p>
            </div>

            {/* Presenter-only verdict line — "YOU FOOLED N OF M" / "EVERYONE
                READ YOU." Shows above the calls list so the presenter knows
                their result at a glance before scanning the per-caller rows. */}
            {isPresenter && (() => {
              const total = round.reveal.calls.length;
              const fooled = round.reveal.calls.filter((c) => !c.correct).length;
              if (total === 0) return null;
              const allFooled = fooled === total;
              const noneFooled = fooled === 0;
              return (
                <div
                  className={`rounded-xl px-4 py-2.5 text-center ${reduced ? "" : "pa-pop-in"}`}
                  style={{
                    background: allFooled
                      ? "linear-gradient(135deg, rgba(255,215,0,0.22) 0%, rgba(184,150,12,0.08) 100%)"
                      : noneFooled
                        ? "linear-gradient(135deg, rgba(239,68,68,0.18) 0%, rgba(168,85,247,0.06) 100%)"
                        : "linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(99,102,241,0.06) 100%)",
                    border: allFooled
                      ? "1px solid rgba(255,215,0,0.55)"
                      : noneFooled
                        ? "1px solid rgba(239,68,68,0.45)"
                        : "1px solid rgba(168,85,247,0.4)",
                  }}
                >
                  <span
                    className="font-bebas text-base tracking-wider"
                    style={{
                      color: allFooled ? "#FDE68A" : noneFooled ? "#FCA5A5" : "#E9D5FF",
                    }}
                  >
                    {allFooled
                      ? `CLEAN SWEEP · FOOLED ALL ${total}`
                      : noneFooled
                        ? "EVERYONE READ YOU"
                        : <>YOU FOOLED <CountUp value={fooled} duration={700} /> OF {total}</>}
                  </span>
                </div>
              );
            })()}

            {/* Who called what — rows deal in staggered; correct reads flash green */}
            <div className="space-y-2">
              {round.reveal.calls.map((c, i) => (
                <div
                  key={c.user_id}
                  className={`rounded-xl px-4 py-3 flex items-center justify-between ${reduced ? "" : "pa-deal-in"} ${c.correct && !reduced ? "pa-correct-flash" : ""}`}
                  style={{
                    background: c.correct
                      ? "linear-gradient(135deg, rgba(34,197,94,0.14) 0%, rgba(34,197,94,0.04) 100%)"
                      : "rgba(255,255,255,0.03)",
                    border: c.correct ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    ...(reduced ? {} : { animationDelay: `${i * 80}ms` }),
                  }}
                >
                  <p className="font-syne text-sm text-cream/90">
                    {c.username ?? "Player"}
                    {c.user_id === meUserId && <span className="text-cream/40 text-xs"> (you)</span>}
                  </p>
                  <span className="font-bebas text-sm tracking-wider" style={{ color: c.correct ? "#86EFAC" : "rgba(238,244,255,0.45)" }}>
                    {c.call.toUpperCase()} · {c.correct ? "RIGHT" : "FOOLED"}
                  </span>
                </div>
              ))}
            </div>

            <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} />

            {/* ── End-game awards — shown to everyone once all rotations are done ── */}
            {round.round_num >= totalRounds && (
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduced ? 0 : 0.2 }}
                className="space-y-3"
              >
                <p className="font-bebas text-xs tracking-[0.3em] text-cream/45 text-center pt-1">
                  GAME OVER
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { title: "BLUFF MASTER", sub: "most callers fooled", a: awards.bluffMaster, unit: "fooled", accent: "#FFD700" },
                    { title: "HUMAN LIE DETECTOR", sub: "most correct reads", a: awards.lieDetector, unit: "reads", accent: "#22C55E" },
                  ].map((aw) => (
                    <div
                      key={aw.title}
                      className={`rounded-2xl p-4 text-center ${reduced ? "" : "pa-leader-glow"}`}
                      style={{
                        background: `linear-gradient(135deg, ${aw.accent}1f 0%, ${aw.accent}08 100%)`,
                        border: `1px solid ${aw.accent}59`,
                      }}
                    >
                      <p className="font-bebas text-[10px] tracking-[0.25em]" style={{ color: aw.accent }}>
                        {aw.title}
                      </p>
                      <p className="font-bebas text-2xl tracking-wider text-cream mt-1">
                        {aw.a?.name ?? "Nobody"}
                      </p>
                      <p className="text-cream/45 text-[11px] font-syne mt-0.5">
                        {aw.a ? `${aw.a.count} ${aw.unit}` : aw.sub}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Phase 2 — real post-round vote (auto-decides at 75%). Only
                shown mid-game; the final game-over screen has its own
                "BACK TO LOBBY · RUN IT BACK" flow. */}
            {round.round_num < totalRounds && (
              <PostRoundVoteCard
                roundId={round.id}
                roundKind="pokerface"
                isHost={isHost}
                onAutoPlayAgain={handleAutoPlayAgain}
                onAutoBackToLobby={handleAutoBackToLobby}
              />
            )}

            {isHost &&
              (round.round_num >= totalRounds ? (
                <button
                  onClick={onReturnToLobby}
                  className="w-full py-3 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                    color: "#04080F",
                    boxShadow: `0 4px 18px ${ACCENT}4d`,
                  }}
                >
                  BACK TO LOBBY · RUN IT BACK
                </button>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={startRound}
                    className="flex-1 py-3 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95"
                    style={{
                      background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                      color: "#04080F",
                      boxShadow: `0 4px 18px ${ACCENT}4d`,
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
              ))}
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

      {/* Phase 2 mid-game invite (host only). */}
      {isHost && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-30 px-3.5 py-2 rounded-full font-bebas text-xs tracking-wider transition-all active:scale-95"
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
