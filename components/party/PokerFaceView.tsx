"use client";

// PokerFaceView — the per-round screen for Poker Face (Lionade Party).
//
// N-player (3-8) presenter-rotation bluff game. Each round the SERVER picks one
// presenter (rotating through the room) and deals them a secret fact card. The
// presenter locks a strategy ("I'll say TRUE" reads the fact straight, "I'll
// say LIE" twists it out loud), reads/sells the fact to the room, then everyone
// else calls BELIEVE or DOUBT. Reveal + score, then the presenter rotates next
// round. NO ELO, NO Fangs — pure points.
//
// 2026-06-10 round-UX rebuild. Server phases are unchanged
// (present -> interrogate -> vote -> reveal, polled every ~1.5s + broadcast
// nudges); the client maps them to the new beats:
//   "present"     — DECIDE: presenter sees the fact + I'LL SAY TRUE / I'LL SAY
//                   LIE (picking commits server-side via /present, no
//                   takebacks). 30s decide window; on expiry the presenter's
//                   client auto-locks TRUE (the server has NO present-phase
//                   timeout today — noted in the route map).
//   "interrogate" — SELL IT: presenter reads the fact out loud. NO TRUE/LIE
//                   label anywhere on screen (shoulder-surfing protection).
//                   "I've read it" fires /open-vote (extended to authorize the
//                   presenter). Callers see the listening screen.
//   "vote"        — CALL IT: BELIEVE / DOUBT + 15s window. Picking locks in.
//   "reveal"      — staged: 2s dramatic pause -> 3D card flip (TRUE/LIE) ->
//                   who called what + points. Reduced motion = instant.
// Shared party components wired here (Bluff Trivia consumes them next):
//   RoundCountdown (5s between-rounds overlay) + GameOverScreen (podium +
//   Play Again -> /rematch + Back to Lobby -> end-game flow).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api-client";
import PartyScoreboard from "./PartyScoreboard";
import IntermissionCard from "./IntermissionCard";
import NinnyHostBubble from "./NinnyHostBubble";
import JoiningNextRoundBanner from "./JoiningNextRoundBanner";
import RoundCountdown from "./RoundCountdown";
import GameOverScreen from "./GameOverScreen";
import CountUp from "@/components/CountUp";
import dynamic from "next/dynamic";
// Confetti is dynamic-imported — see RoundEndOverlay for the why. Saves
// shipping the canvas particle code on every PokerFaceView mount.
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });
import {
  pokerFaceChannel,
  roomChannel,
  PARTY_EVENTS,
  POKERFACE_EVENTS,
} from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";
import PostRoundVoteCard from "./PostRoundVoteCard";
import MidGameInviteModal from "./MidGameInviteModal";
import type { PartyPlayer, PartyRoom, PokerFaceCall } from "@/lib/party/types";

interface Props {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
  activeRound?: { id: string; phase: string; started_at: string | null } | null;
  onReturnToLobby: () => void;
}

type Phase = "loading" | "present" | "interrogate" | "vote" | "reveal";
type RevealStage = "pause" | "flip" | "open";

const ACCENT = "#00BFFF";
// Between-rounds countdown (shared RoundCountdown overlay).
const COUNTDOWN_SECONDS = 5;
// Presenter's read+decide window. Client-enforced: the server has no
// present-phase timeout, so on expiry the presenter's client auto-locks TRUE.
const DECIDE_SECONDS = 30;
// Caller call window (room settings pf_vote_seconds can override; the lobby
// never writes it today, so 15s is the live default).
const DEFAULT_CALL_SECONDS = 15;
// Backstop for the read/sell beat so a frozen presenter can't stall the room.
const READ_BACKSTOP_SECONDS = 25;
// Dramatic pause before the reveal card flips. "The table holds its breath."
const REVEAL_PAUSE_MS = 2000;
const REVEAL_FLIP_MS = 950;

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
    card_fact?: string | null;   // presenter-only (present + interrogate + vote)
    is_lie?: boolean | null;     // presenter-only — deliberately NEVER rendered pre-reveal
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
  activeRound,
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
  // ONE dedicated live region for the reveal result. Set exactly once per round
  // (keyed on round id via revealAnnounceRef in refreshDetail) so the 1.5s polls
  // never re-announce. Cleared on round adoption.
  const [revealAnnounce, setRevealAnnounce] = useState<string | null>(null);
  const revealAnnounceRef = useRef<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [decideLeft, setDecideLeft] = useState(DECIDE_SECONDS);
  // True when the presenter's decide window expired and the client auto-locked
  // TRUE on their behalf (server has no present-phase timeout).
  const [autoLocked, setAutoLocked] = useState(false);
  // Local immediate lock for the caller's BELIEVE/DOUBT pick (server my_call
  // confirms on the next poll). One pick per round, no takebacks in the UI.
  const [myCallLocal, setMyCallLocal] = useState<PokerFaceCall | null>(null);
  const advanceLock = useRef(false);
  const readLock = useRef(false);
  const autoLockRoundRef = useRef<string | null>(null);
  // Current round id, readable from stable callbacks without re-creating them
  // (mirrors BluffView's wiring — connectivity audit 2026-06-11).
  const roundIdRef = useRef<string | null>(null);
  // Every round id this client has adopted. Guards the ROUND_STARTED
  // broadcast AND the activeRound poll fallback against re-adopting a stale
  // id (e.g. an out-of-order room snapshot arriving after the next round
  // already began).
  const seenRoundIdsRef = useRef<Set<string>>(new Set());
  // The subscribed pokerface channel (owned by the listen effect). All
  // outgoing pokerface broadcasts ride it — the old per-send
  // supabase.channel().send() pattern relied on topic-dedupe landing on the
  // live channel, but during the listen effect's per-round resubscribe
  // windows it minted detached instances instead (leak + HTTP fallback).
  const pfChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Between-rounds countdown (shared RoundCountdown, 5s) ──
  // Fires once per round when the fresh round's detail first lands in
  // phase='present'. Reduced motion: RoundCountdown renders static numbers.
  const [countdownRoundId, setCountdownRoundId] = useState<string | null>(null);
  const countdownSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!detail || detail.phase !== "present") return;
    if (countdownSeenRef.current.has(detail.id)) return;
    countdownSeenRef.current.add(detail.id);
    setCountdownRoundId(detail.id);
  }, [detail]);
  const handleCountdownDone = useCallback(() => setCountdownRoundId(null), []);

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

  // Phase 2 — mid-game invite modal (host surface).
  const [inviteOpen, setInviteOpen] = useState(false);

  // ── Card-flip bookkeeping ──
  // The card-word WORD element flips on the X axis on each phase transition
  // WITHIN a round, so the "card turned over" beat marks actual phase changes.
  const [cardFlipKey, setCardFlipKey] = useState(0);
  const prevPhaseRef = useRef<Phase | null>(null);
  const flipRoundIdRef = useRef<string | null>(null);
  useEffect(() => {
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

  // ── Staged reveal: 2s pause -> 3D flip -> full breakdown ──
  // Keyed on the revealed round id (stable across the 1.5s polls) so the
  // timers aren't cleared by every detail refresh. Reduced motion skips
  // straight to "open" (instant swap, no pause, no flip).
  const revealKey = detail?.phase === "reveal" ? detail.id : null;
  const [revealStage, setRevealStage] = useState<RevealStage>("open");
  useEffect(() => {
    if (!revealKey) return;
    if (reduced) {
      setRevealStage("open");
      return;
    }
    setRevealStage("pause");
    const t1 = setTimeout(() => setRevealStage("flip"), REVEAL_PAUSE_MS);
    const t2 = setTimeout(() => setRevealStage("open"), REVEAL_PAUSE_MS + REVEAL_FLIP_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [revealKey, reduced]);

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

  // ── Round adoption — the ONLY place roundId changes ──
  // Resets all per-round state in one spot. The seen-set lets the three
  // discovery paths (ROUND_STARTED broadcast, activeRound poll fallback,
  // startRound's own response) race safely: first adoption wins, repeats are
  // no-ops, and a stale id can never roll the client back to an old round.
  const adoptRound = useCallback((id: string) => {
    if (seenRoundIdsRef.current.has(id)) return;
    seenRoundIdsRef.current.add(id);
    roundIdRef.current = id;
    setRoundId(id);
    setPhase("present");
    setLieText("");
    setAutoLocked(false);
    setMyCallLocal(null);
    setDetail(null);
    setRevealAnnounce(null);
  }, []);

  // Outgoing pokerface broadcasts ride the SUBSCRIBED channel (fast ws push).
  // The fallback covers the pre-subscribe window via supabase.channel()'s
  // topic-dedupe (live channel if one exists, one unjoined HTTP-fallback
  // instance otherwise). Never removeChannel here — removal detaches by
  // TOPIC and would kill the live subscription.
  const sendPokerEvent = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const ch = pfChRef.current ?? supabase.channel(pokerFaceChannel(room.code));
      try {
        await ch.send({ type: "broadcast", event, payload });
      } catch {
        // Best-effort — every client's 1.5s poll reconciles anyway.
      }
    },
    [room.code],
  );

  // ── Start a fresh round (host) ──
  const startRound = useCallback(async () => {
    setPhase("loading");
    setDetail(null);
    setLieText("");
    setAutoLocked(false);
    setMyCallLocal(null);
    setError(null);
    const res = await apiPost<{ round: { id: string } }>(
      "/api/party/pokerface/rounds",
      { code: room.code },
    );
    if (!res.ok || !res.data) {
      setError("Couldn't deal a round. Try again.");
      return;
    }
    adoptRound(res.data.round.id);
    await sendPokerEvent(POKERFACE_EVENTS.ROUND_STARTED, {
      round_id: res.data.round.id,
    });
  }, [room.code, adoptRound, sendPokerEvent]);

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

  // Round discovery fallback (poll-driven): the page's 3s room snapshot
  // carries the in-flight round (activeRound). Adopting from it covers BOTH
  // the rejoin/mid-phase mount AND any missed ROUND_STARTED broadcast — the
  // old one-shot bootstrap only ran before the first round, so a later
  // round's dropped broadcast left this client polling the previous round
  // forever, frozen on its reveal screen. The seen-set in adoptRound makes
  // this safe against stale snapshots.
  const activeRoundId = activeRound?.id ?? null;
  useEffect(() => {
    if (activeRoundId) adoptRound(activeRoundId);
  }, [activeRoundId, adoptRound]);

  // Host auto-deals the first round — only when there's no in-flight round
  // we should bootstrap into (the rejoin path takes that role above).
  useEffect(() => {
    if (isEffectiveHost && !roundId && phase === "loading" && !activeRound?.id) {
      void startRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEffectiveHost]);

  // Phase transition: clear stale error from the previous phase so e.g. a
  // present-phase submit failure doesn't bleed into vote.
  useEffect(() => {
    setError(null);
  }, [phase]);

  // ── Pokerface channel: subscribe ONCE per room ──
  // Round discovery + phase pokes. Handlers go through the stable adoptRound /
  // refreshDetail callbacks, so this effect no longer depends on roundId (the
  // old version tore the channel down and resubscribed on every round change —
  // a per-round deafness window during which broadcasts were lost).
  useEffect(() => {
    const ch = supabase.channel(pokerFaceChannel(room.code));
    ch.on("broadcast", { event: POKERFACE_EVENTS.ROUND_STARTED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { round_id?: string };
      if (payload.round_id) adoptRound(payload.round_id);
    });
    ch.on("broadcast", { event: POKERFACE_EVENTS.PRESENTED }, () => void refreshDetail());
    ch.on("broadcast", { event: POKERFACE_EVENTS.PHASE_CHANGED }, () => void refreshDetail());
    ch.on("broadcast", { event: POKERFACE_EVENTS.ROUND_ENDED }, () => void refreshDetail());
    // Phase 2: wrap with exponential-backoff resubscribe so a transient WS
    // drop doesn't silently leave the poker face channel dead.
    const handle = subscribeResilient(ch, { label: `pokerface-room:${room.code}` });
    pfChRef.current = ch;
    return () => {
      pfChRef.current = null;
      handle.cancel();
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code, adoptRound]);

  // ── Poll round detail (server is the source of truth) ──
  // Stable callback (reads roundIdRef) so the channel effect above binds once
  // per room instead of resubscribing per round.
  const refreshDetail = useCallback(async () => {
    const rid = roundIdRef.current;
    if (!rid) return;
    const res = await apiGet<RoundDetail>(`/api/party/pokerface/rounds/${rid}`);
    if (!res.ok || !res.data) return;
    // Round changed while this GET was in flight — drop the stale payload.
    if (roundIdRef.current !== rid) return;
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
            ? "Your fact is secret. Lock TRUE to read it straight, or LIE to twist it. No takebacks."
            : "Your card is secret. Tell the truth, or invent a convincing lie."
          : `${r.presenter_username ?? "The presenter"} is picking their angle...`,
      );
    } else if (r.phase === "interrogate") {
      setNinnyMsg(
        r.is_presenter
          ? "Read it out loud. Sell every word. Your face is the only tell."
          : `${r.presenter_username ?? "The presenter"} is reading their fact. Watch the face, not the words.`,
      );
    } else if (r.phase === "vote") {
      setNinnyMsg(
        r.is_presenter
          ? "You've made your claim. Hold your face. Give them nothing."
          : inperson
            ? "You heard it. Did their face give it away?"
            : "Believe the claim, or call the bluff. Read between the lines.",
      );
    } else if (r.phase === "reveal") {
      setNinnyMsg(r.reveal?.is_lie ? "It was a LIE. Who fell for it?" : "It was the TRUTH. The doubters got played by an honest face.");
      // Mirror the outcome into the dedicated SR live region — fires exactly
      // once per round (revealAnnounceRef gate). The verdict card flip, the
      // green "RIGHT" rows and the presenter sweep banner are all visual, so
      // screen-reader users get the equivalent here: verdict, my own result,
      // and how the presenter did.
      if (r.reveal && revealAnnounceRef.current !== r.id) {
        revealAnnounceRef.current = r.id;
        const calls = r.reveal.calls;
        const total = calls.length;
        const fooled = calls.filter((c) => !c.correct).length;
        const verdict = r.reveal.is_lie ? "It was a lie." : "It was true.";
        const presenterWho = r.is_presenter ? "You" : r.presenter_username ?? "The presenter";
        let presenterPart: string;
        if (total === 0) {
          presenterPart = "";
        } else if (fooled === total) {
          presenterPart = ` Clean sweep. ${presenterWho} fooled all ${total}.`;
        } else if (fooled === 0) {
          presenterPart = ` Everyone read ${r.is_presenter ? "you" : presenterWho}.`;
        } else {
          presenterPart = ` ${presenterWho} fooled ${fooled} of ${total}.`;
        }
        let myPart = "";
        if (!r.is_presenter) {
          const myCallRow = calls.find((c) => c.user_id === meUserId);
          if (myCallRow) {
            myPart = myCallRow.correct
              ? " You called it right."
              : " You got fooled.";
          }
        }
        setRevealAnnounce(`${verdict}${myPart}${presenterPart}`.trim());
      }
    }
  }, [inperson, meUserId]);

  useEffect(() => {
    if (!roundId) return;
    void refreshDetail();
    const iv = setInterval(refreshDetail, 1500);
    return () => clearInterval(iv);
  }, [roundId, refreshDetail]);

  // ── Presenter: commit truth or lie (locks the strategy server-side) ──
  const present = useCallback(
    // Returns true only when the lock actually committed — the decide-timer
    // auto-lock uses this so its banner can't claim a lock that failed or
    // lost the race to a manual pick.
    async (isLie: boolean): Promise<boolean> => {
      if (!roundId || submitting) return false;
      // Remote lies need typed text; in-person lies are spoken (no text required).
      if (!inperson && isLie && !lieText.trim()) {
        setError("Write the lie you want to present.");
        return false;
      }
      setSubmitting(true);
      setError(null);
      const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/present`, {
        isLie,
        claimText: !inperson && isLie ? lieText.trim() : undefined,
      });
      setSubmitting(false);
      if (!res.ok) {
        console.error("[party:pokerface-present] failed", res.error);
        setError("Couldn't lock your play. Try again.");
        return false;
      }
      void refreshDetail();
      void sendPokerEvent(POKERFACE_EVENTS.PRESENTED, { round_id: roundId });
      return true;
    },
    [roundId, submitting, inperson, lieText, sendPokerEvent, refreshDetail],
  );

  // ── Decide timer (present phase) ──
  // Window = round.started_at + countdown overlay + 30s. All clients compute
  // from the same server timestamp. On expiry, the PRESENTER's client
  // auto-locks TRUE (present(false)) exactly once — the server has no
  // present-phase timeout today, so this is the client-side backstop.
  useEffect(() => {
    if (!detail || detail.phase !== "present") return;
    const targetMs =
      new Date(detail.started_at).getTime() + (COUNTDOWN_SECONDS + DECIDE_SECONDS) * 1000;
    const rid = detail.id;
    const amPresenter = detail.is_presenter;
    function tick() {
      const remain = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setDecideLeft(remain);
      if (remain === 0 && amPresenter && autoLockRoundRef.current !== rid) {
        autoLockRoundRef.current = rid;
        // Banner only after the lock actually commits — a failed POST or a
        // manual pick winning the race must not show the auto-lock note.
        void present(false).then((ok) => {
          if (ok) setAutoLocked(true);
        });
      }
    }
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [detail, present]);

  // ── Read-beat backstop (interrogate phase) ──
  // The presenter's "I've read it" is the primary advance; if they stall, the
  // presenter's, effective host's, or interrogator's client auto-fires
  // open-vote after READ_BACKSTOP_SECONDS (the server authorizes all three).
  useEffect(() => {
    if (!detail || detail.phase !== "interrogate" || !detail.presented_at) {
      return;
    }
    const targetMs = new Date(detail.presented_at).getTime() + READ_BACKSTOP_SECONDS * 1000;
    const rid = detail.id;
    const canAdvance =
      isEffectiveHost || detail.is_presenter || detail.interrogator_user_id === meUserId;
    function tick() {
      const remain = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setTimeLeft(remain);
      if (remain === 0 && canAdvance && !readLock.current) {
        readLock.current = true;
        void apiPost(`/api/party/pokerface/rounds/${rid}/open-vote`, {}).then(() => {
          readLock.current = false;
          void refreshDetail();
          void sendPokerEvent(POKERFACE_EVENTS.PHASE_CHANGED, { round_id: rid });
        });
      }
    }
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [detail, isEffectiveHost, meUserId, sendPokerEvent, refreshDetail]);

  // ── Call timer (vote phase) + auto-complete (host) ──
  useEffect(() => {
    if (!detail || detail.phase !== "vote" || !detail.presented_at) {
      return;
    }
    const callSeconds = room.settings?.pf_vote_seconds ?? DEFAULT_CALL_SECONDS;
    const targetMs = new Date(detail.presented_at).getTime() + callSeconds * 1000;
    const rid = detail.id;
    function tick() {
      const remain = Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
      setTimeLeft(remain);
      if (remain === 0 && isEffectiveHost && !advanceLock.current) {
        advanceLock.current = true;
        void apiPost(`/api/party/pokerface/rounds/${rid}/complete`, {}).then(() => {
          advanceLock.current = false;
          void refreshDetail();
          void sendPokerEvent(POKERFACE_EVENTS.PHASE_CHANGED, { round_id: rid });
        });
      }
    }
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [detail, isEffectiveHost, sendPokerEvent, room.settings?.pf_vote_seconds, refreshDetail]);

  // ── "I've read it" — presenter opens calling for everyone ──
  async function openVote() {
    if (!roundId) return;
    const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/open-vote`, {});
    if (!res.ok) {
      console.error("[party:pokerface-open-vote] failed", res.error);
      setError("Couldn't open the calls. Try again.");
      return;
    }
    void refreshDetail();
    void sendPokerEvent(POKERFACE_EVENTS.PHASE_CHANGED, { round_id: roundId });
  }

  // ── Caller: call believe / doubt (one pick, locked in) ──
  async function call(c: PokerFaceCall) {
    if (!roundId || myCallLocal || detail?.my_call) return;
    setMyCallLocal(c);  // lock the UI immediately; server confirms on next poll
    const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/call`, { call: c });
    if (!res.ok) {
      console.error("[party:pokerface-call] failed", res.error);
      setMyCallLocal(null);  // unlock so they can retry
      setError("Couldn't submit your call. Try again.");
      return;
    }
    void refreshDetail();
    void sendPokerEvent(POKERFACE_EVENTS.CALL_SUBMITTED, { round_id: roundId });
  }

  // ── Host can force the reveal once everyone has called ──
  async function revealNow() {
    if (!roundId || !isEffectiveHost) return;
    const res = await apiPost(`/api/party/pokerface/rounds/${roundId}/complete`, {});
    if (!res.ok) {
      console.error("[party:pokerface-reveal] failed", res.error);
      setError("Couldn't reveal the round. Try again.");
      return;
    }
    void refreshDetail();
    void sendPokerEvent(POKERFACE_EVENTS.PHASE_CHANGED, { round_id: roundId });
  }

  // ── Rematch (game-over Play Again) — host resets scores + room -> lobby ──
  // Mirrors BluffView's pattern: POST /rematch, then GAME_ENDED on the room
  // channel so every client's page snapshot refreshes into the lobby.
  const [rematchPending, setRematchPending] = useState(false);
  const handleRematch = useCallback(async () => {
    if (!isEffectiveHost || rematchPending) return;
    setRematchPending(true);
    const res = await apiPost(`/api/party/rooms/${room.code}/rematch`, {});
    if (!res.ok) {
      setRematchPending(false);
      return;
    }
    // Topic-dedupe returns the page's SUBSCRIBED room channel (fast ws push).
    // Never removeChannel — removal detaches by topic and would kill it.
    const ch = supabase.channel(roomChannel(room.code));
    await ch
      .send({ type: "broadcast", event: PARTY_EVENTS.GAME_ENDED, payload: {} })
      .catch(() => {});
    setRematchPending(false);
  }, [isEffectiveHost, rematchPending, room.code]);

  const playersForBoard = useMemo(
    () => players.map((p) => ({ user_id: p.user_id, username: p.username, score: p.score })),
    [players],
  );

  // Presenter avatar for the caller listening screen. Dicebear seeded on
  // username so it's stable per-user across surfaces (engineering
  // non-negotiable: avatar stability via useMemo).
  const presenterAvatarSrc = useMemo(() => {
    const seed = detail?.presenter_username ?? detail?.presenter_user_id ?? "presenter";
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=4A90D9`;
  }, [detail?.presenter_username, detail?.presenter_user_id]);

  // Phase 2 vote auto-decide callbacks (75% threshold). Only fire on the
  // post-round reveal screen when the game isn't already game-over. Effective
  // host so a host-disconnect can't stall the post-round transition.
  const handleAutoPlayAgain = useCallback(() => {
    if (isEffectiveHost) void startRound();
  }, [isEffectiveHost, startRound]);
  const handleAutoBackToLobby = useCallback(() => {
    if (isEffectiveHost) onReturnToLobby();
  }, [isEffectiveHost, onReturnToLobby]);

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
            className={`w-12 h-12 rounded-full border-2 relative z-10 ${reduced ? "" : "animate-spin"}`}
            // Reduced motion: full solid accent ring (no spinning "gap" to imply motion).
            style={
              reduced
                ? { borderColor: ACCENT }
                : { borderColor: `${ACCENT}40`, borderTopColor: ACCENT }
            }
          />
        </div>
        <p className="font-bebas text-2xl text-cream/70 tracking-[0.3em]">DEALING THE CARD</p>
        <p className="text-cream/40 text-xs font-syne italic">picking a presenter, shuffling the deck</p>
      </div>
    );
  }

  const round = detail;
  const isPresenter = round.is_presenter;
  const presenterName = round.presenter_username ?? "Presenter";
  const callsIn = round.call_count ?? 0;
  const callerCount = round.caller_count ?? Math.max(0, players.length - 1);
  const everyoneCalled = callerCount > 0 && callsIn >= callerCount;
  const myCall = myCallLocal ?? round.my_call ?? null;
  const isFinalRound = round.round_num >= totalRounds;
  // Time-pressure vignette during the active call window under 5s.
  const showPanicVignette = phase === "vote" && timeLeft > 0 && timeLeft < 5 && !reduced;

  const mePlayer = players.find((p) => p.user_id === meUserId);
  const isPendingJoiner = !!mePlayer?.is_pending_round;

  // ── Caller listening screen (present + interrogate beats) ──
  // Pulsing rings around the presenter's avatar. GPU-only (pa-listen-ring is
  // transform + opacity); reduced motion renders one static ring.
  const listeningScreen = (
    <div className="flex flex-col items-center py-10 gap-5">
      <div className="relative w-32 h-32 flex items-center justify-center">
        {reduced ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full"
            style={{ border: `1.5px solid ${ACCENT}40` }}
          />
        ) : (
          [0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute inset-0 rounded-full pa-listen-ring"
              style={{
                border: `1.5px solid ${ACCENT}73`,
                animationDelay: `${i * 0.7}s`,
              }}
            />
          ))
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={presenterAvatarSrc}
          alt={`${presenterName} avatar`}
          className="w-20 h-20 rounded-full object-cover bg-navy relative z-10"
          style={{ border: `2px solid ${ACCENT}59`, boxShadow: `0 0 20px ${ACCENT}33` }}
        />
      </div>
      <p className="font-bebas text-2xl sm:text-3xl text-cream tracking-wider text-center px-4">
        WAITING FOR {presenterName.toUpperCase()} TO READ THEIR FACT
      </p>
      <span aria-hidden="true" className="inline-flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${reduced ? "opacity-70" : "pa-ink-dot"}`}
            style={{ background: ACCENT, animationDelay: `${i * 200}ms` }}
          />
        ))}
      </span>
      <p className="text-cream/45 text-xs font-syne text-center max-w-xs italic">
        {phase === "present"
          ? inperson
            ? "they're picking their angle. truth or lie."
            : "they're composing their claim. get ready to call it."
          : "listen close. watch the face, not the words."}
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      {isPendingJoiner && <JoiningNextRoundBanner variant="pokerface" />}
      {showPanicVignette && <div aria-hidden="true" className="pa-panic-vignette" />}

      {/* ── Between-rounds countdown (shared RoundCountdown, 5s) ── */}
      <AnimatePresence>
        {countdownRoundId === round.id && phase === "present" && (
          <RoundCountdown
            key={`countdown-${round.id}`}
            roundNum={round.round_num}
            totalRounds={totalRounds}
            seconds={COUNTDOWN_SECONDS}
            accent={ACCENT}
            headline={
              isPresenter ? (
                <>your turn to <span style={{ color: ACCENT }}>present</span></>
              ) : (
                <>{presenterName} <span className="text-cream/45">is presenting</span></>
              )
            }
            subline={isPresenter ? "truth or lie. your call." : "read the face. call it."}
            onComplete={handleCountdownDone}
          />
        )}
      </AnimatePresence>

      <NinnyHostBubble message={ninnyMsg} />

      {/* ── Turn-rotation header: "Round 2/6 · Name is presenting" ── */}
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="font-bebas text-sm sm:text-base tracking-[0.2em] text-cream/70">
          ROUND {round.round_num}/{totalRounds}
          {" · "}
          {isPresenter ? (
            <span style={{ color: ACCENT }}>YOU ARE PRESENTING</span>
          ) : (
            <>
              <span style={{ color: ACCENT }}>{presenterName.toUpperCase()}</span>
              <span className="text-cream/55"> IS PRESENTING</span>
            </>
          )}
        </p>
        {phase === "vote" && (
          <span
            className={`font-bebas text-2xl tabular-nums ${timeLeft <= 5 ? "text-red-400" : "text-cream/80"}`}
            aria-label={`${timeLeft} seconds left to call`}
          >
            {timeLeft}s
          </span>
        )}
      </div>

      {/* Card header — the WORD everyone can see. Flips on the X axis on every
          phase transition within a round ("card turned over" beat). */}
      <div
        className="rounded-2xl p-4 pa-card-flip-3d-perspective"
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
      </div>

      <AnimatePresence mode="wait">
        {/* ── DECIDE BEAT (server phase: present) ── */}
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
                {/* The secret fact, large and centered. */}
                <div
                  className="rounded-2xl p-6 sm:p-8 text-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <p className="font-bebas text-xs text-cream/45 tracking-[0.3em] mb-3">YOUR SECRET FACT</p>
                  <p className="font-syne text-lg sm:text-xl text-cream/95 leading-relaxed max-w-md mx-auto">
                    {round.card_fact}
                  </p>
                </div>

                {/* Decide timer — 30s after the countdown clears. On expiry the
                    client auto-locks TRUE (no server timeout exists). No
                    aria-live: at 500ms ticks a polite region re-announces the
                    countdown every second (chatter). The value rides aria-label
                    so it's queryable without spamming. */}
                <p
                  className={`font-bebas text-sm tracking-[0.3em] text-center ${decideLeft <= 5 ? "text-red-400" : "text-cream/55"}`}
                  aria-label={`Lock your play. ${decideLeft} seconds left.`}
                >
                  LOCK YOUR PLAY · {decideLeft}s
                </p>

                {inperson ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => present(false)}
                        disabled={submitting}
                        className="py-5 rounded-xl font-bebas tracking-wider transition-all active:scale-95 disabled:opacity-40"
                        style={{
                          background: "linear-gradient(135deg, rgba(34,197,94,0.9) 0%, rgba(22,163,74,0.8) 100%)",
                          color: "#04140a",
                          boxShadow: "0 4px 18px rgba(34,197,94,0.3)",
                        }}
                      >
                        <span className="block text-xl">I&apos;LL SAY TRUE</span>
                        <span className="block text-[10px] tracking-[0.2em] mt-0.5 opacity-80">
                          READ IT EXACTLY AS WRITTEN
                        </span>
                      </button>
                      <button
                        onClick={() => present(true)}
                        disabled={submitting}
                        className="py-5 rounded-xl font-bebas tracking-wider transition-all active:scale-95 disabled:opacity-40"
                        style={{
                          background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                          color: "#04080F",
                          boxShadow: `0 4px 18px ${ACCENT}4d`,
                        }}
                      >
                        <span className="block text-xl">I&apos;LL SAY LIE</span>
                        <span className="block text-[10px] tracking-[0.2em] mt-0.5 opacity-80">
                          TWIST IT AND SELL THE FAKE
                        </span>
                      </button>
                    </div>
                    <p className="text-cream/40 text-xs font-syne text-center">
                      Picking locks it in. No changing mid-round.
                    </p>
                  </>
                ) : (
                  <>
                    {/* Remote mode keeps the typed-claim flow: a lie needs text. */}
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
                      To bluff, write your lie above, then tap Present the Lie. Picking locks it in.
                    </p>
                  </>
                )}
              </>
            ) : (
              listeningScreen
            )}
          </motion.div>
        )}

        {/* ── SELL-IT BEAT (server phase: interrogate, live mode only) ──
            Presenter reads the fact out loud. NO TRUE/LIE label anywhere on
            this screen: a shoulder-surfer learns nothing. The auto-lock
            banner below is worded to instruct without printing the verdict,
            preserving the invariant even in the timeout case. */}
        {phase === "interrogate" && (
          <motion.div
            key="interrogate"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-3"
          >
            {isPresenter ? (
              <>
                <div
                  className="rounded-2xl p-6 sm:p-8 text-center"
                  style={{
                    background: `linear-gradient(135deg, ${ACCENT}1f 0%, rgba(168,85,247,0.06) 100%)`,
                    border: `1px solid ${ACCENT}59`,
                  }}
                >
                  <p className="font-bebas text-sm tracking-[0.3em] mb-3" style={{ color: ACCENT }}>
                    READ THE FACT OUT LOUD. SELL IT.
                  </p>
                  <p className="font-syne text-lg sm:text-xl text-cream/95 leading-relaxed max-w-md mx-auto">
                    {round.card_fact}
                  </p>
                  <p className="text-cream/40 text-xs font-syne mt-4 italic">
                    Straight or twisted. Only you know which. Hold your face.
                  </p>
                </div>

                {autoLocked && (
                  <p
                    className="rounded-xl px-4 py-2 text-center text-xs font-syne"
                    style={{
                      background: "rgba(251,191,36,0.1)",
                      border: "1px solid rgba(251,191,36,0.35)",
                      color: "#FDE68A",
                    }}
                  >
                    Time ran out. Read the fact exactly as written. Play it straight.
                  </p>
                )}

                <button
                  onClick={openVote}
                  className="w-full py-4 rounded-xl font-bebas text-lg tracking-wider transition-all active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, ${ACCENT} 0%, #0090d0 100%)`,
                    color: "#04080F",
                    boxShadow: `0 4px 20px ${ACCENT}4d`,
                  }}
                >
                  I&apos;VE READ IT
                </button>
                <p className="text-cream/40 text-xs font-syne text-center">
                  Calls open for everyone automatically in {timeLeft}s.
                </p>
              </>
            ) : (
              <>
                {listeningScreen}
                <p className="text-cream/40 text-xs font-syne text-center">
                  Calls open when {presenterName} is done reading, or in {timeLeft}s.
                </p>
              </>
            )}
          </motion.div>
        )}

        {/* ── CALL BEAT (server phase: vote) ── */}
        {phase === "vote" && (
          <motion.div
            key="vote"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-3"
          >
            {!inperson && round.claim_text && (
              <div
                className="rounded-2xl p-5"
                style={{
                  background: "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <p className="font-bebas text-xs text-cream/45 tracking-[0.25em] mb-1">THE CLAIM</p>
                <p className="font-syne text-base sm:text-lg text-cream/95 leading-relaxed">
                  &ldquo;{round.claim_text}&rdquo;
                </p>
              </div>
            )}

            {isPresenter ? (
              <div
                className="rounded-xl px-4 py-5 text-center"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <p className="font-bebas text-xl text-cream/70 tracking-wider">HOLD YOUR FACE</p>
                <p className="text-cream/45 text-xs font-syne mt-1.5">
                  {callsIn} of {callerCount} have called. Give them nothing.
                </p>
              </div>
            ) : (
              <>
                <p className="font-bebas text-sm text-cream/60 tracking-[0.25em] text-center">
                  {myCall ? "LOCKED IN" : "DO YOU BELIEVE IT?"}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {(["believe", "doubt"] as const).map((c) => {
                    const mine = myCall === c;
                    const dimmed = myCall !== null && !mine;
                    const isBelieve = c === "believe";
                    const col = isBelieve ? "#22C55E" : "#EF4444";
                    return (
                      <button
                        key={c}
                        onClick={() => call(c)}
                        disabled={myCall !== null}
                        className="py-6 rounded-xl font-bebas text-2xl tracking-wider transition-all active:scale-95 disabled:active:scale-100"
                        style={{
                          background: mine
                            ? `linear-gradient(135deg, ${col}cc 0%, ${col}99 100%)`
                            : "rgba(255,255,255,0.04)",
                          border: mine ? `1px solid ${col}` : "1px solid rgba(255,255,255,0.1)",
                          color: mine ? "#04080F" : dimmed ? "rgba(238,244,255,0.3)" : "rgba(238,244,255,0.85)",
                          boxShadow: mine ? `0 4px 18px ${col}40` : "none",
                          opacity: dimmed ? 0.5 : 1,
                          cursor: myCall !== null ? "default" : "pointer",
                        }}
                      >
                        {isBelieve ? "BELIEVE" : "DOUBT"}
                        {mine && <span className="block text-[10px] tracking-[0.2em] mt-0.5">YOUR CALL</span>}
                      </button>
                    );
                  })}
                </div>
                <p className="text-cream/40 text-xs font-syne text-center">
                  {myCall
                    ? `Locked in. No takebacks. ${callsIn} of ${callerCount} have called.`
                    : "Tap to call. Trust the face, not the words."}
                </p>
              </>
            )}

            {isEffectiveHost && everyoneCalled && (
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

        {/* ── REVEAL: 2s held breath -> 3D card flip -> full breakdown ── */}
        {phase === "reveal" && round.reveal && (
          <motion.div
            key="reveal"
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduced ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            {/* Dedicated SR live region — announces the outcome exactly once per
                round (revealAnnounce only changes once, keyed on round id). The
                verdict card below carries NO aria-live: it re-renders on the
                1.5s poll AND mutates across the pause/flip/open stages, so a
                live region there would re-fire the result repeatedly. */}
            <span role="status" aria-live="assertive" className="sr-only">
              {revealAnnounce}
            </span>

            {/* The verdict card. Back face = face-down card; front face = TRUE
                or LIE. rotateY transform only (GPU); reduced = instant swap.
                aria-hidden: the verdict glyph is decorative — the SR live
                region above carries the spoken outcome. */}
            <div className="flex flex-col items-center gap-4 py-4" aria-hidden="true">
              <div style={{ perspective: 900 }}>
                {reduced ? (
                  <div
                    className="w-44 h-60 rounded-2xl flex flex-col items-center justify-center gap-2"
                    style={{
                      background: round.reveal.is_lie
                        ? "linear-gradient(135deg, rgba(239,68,68,0.25) 0%, rgba(8,6,16,0.9) 100%)"
                        : "linear-gradient(135deg, rgba(34,197,94,0.22) 0%, rgba(8,6,16,0.9) 100%)",
                      border: round.reveal.is_lie
                        ? "1px solid rgba(239,68,68,0.55)"
                        : "1px solid rgba(34,197,94,0.5)",
                    }}
                  >
                    <span className="font-bebas text-[10px] tracking-[0.3em] text-cream/55">THE VERDICT</span>
                    <span
                      className="font-bebas text-6xl tracking-wider"
                      style={{ color: round.reveal.is_lie ? "#FCA5A5" : "#86EFAC" }}
                    >
                      {round.reveal.is_lie ? "LIE" : "TRUE"}
                    </span>
                  </div>
                ) : (
                  <motion.div
                    animate={{ rotateY: revealStage === "pause" ? 0 : 180 }}
                    transition={{ duration: REVEAL_FLIP_MS / 1000, ease: [0.16, 1, 0.3, 1] }}
                    className="relative w-44 h-60"
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    {/* Back face — face-down card. */}
                    <div
                      className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-2"
                      style={{
                        backfaceVisibility: "hidden",
                        background: `linear-gradient(135deg, ${ACCENT}26 0%, rgba(8,6,16,0.92) 100%)`,
                        border: `1px solid ${ACCENT}59`,
                        boxShadow: `0 0 24px ${ACCENT}26`,
                      }}
                    >
                      <span className="font-bebas text-6xl" style={{ color: `${ACCENT}cc` }}>?</span>
                      <span className="font-bebas text-[10px] tracking-[0.3em] text-cream/45">TRUTH OR LIE</span>
                    </div>
                    {/* Front face — the verdict. */}
                    <div
                      className="absolute inset-0 rounded-2xl flex flex-col items-center justify-center gap-2"
                      style={{
                        backfaceVisibility: "hidden",
                        transform: "rotateY(180deg)",
                        background: round.reveal.is_lie
                          ? "linear-gradient(135deg, rgba(239,68,68,0.25) 0%, rgba(8,6,16,0.92) 100%)"
                          : "linear-gradient(135deg, rgba(34,197,94,0.22) 0%, rgba(8,6,16,0.92) 100%)",
                        border: round.reveal.is_lie
                          ? "1px solid rgba(239,68,68,0.55)"
                          : "1px solid rgba(34,197,94,0.5)",
                        boxShadow: round.reveal.is_lie
                          ? "0 0 28px rgba(239,68,68,0.3)"
                          : "0 0 28px rgba(34,197,94,0.28)",
                      }}
                    >
                      <span className="font-bebas text-[10px] tracking-[0.3em] text-cream/55">THE VERDICT</span>
                      <span
                        className="font-bebas text-6xl tracking-wider"
                        style={{
                          color: round.reveal.is_lie ? "#FCA5A5" : "#86EFAC",
                          textShadow: round.reveal.is_lie
                            ? "0 0 18px rgba(239,68,68,0.5)"
                            : "0 0 18px rgba(34,197,94,0.5)",
                        }}
                      >
                        {round.reveal.is_lie ? "LIE" : "TRUE"}
                      </span>
                    </div>
                  </motion.div>
                )}
              </div>

              {revealStage === "pause" && (
                <div className="flex flex-col items-center gap-2">
                  <p className="font-bebas text-lg tracking-[0.3em] text-cream/65">
                    THE TABLE HOLDS ITS BREATH
                  </p>
                  <span aria-hidden="true" className="inline-flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full pa-ink-dot"
                        style={{ background: ACCENT, animationDelay: `${i * 200}ms` }}
                      />
                    ))}
                  </span>
                </div>
              )}
            </div>

            {/* Full breakdown lands after the flip settles. */}
            {revealStage === "open" && (
              <motion.div
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-4"
              >
                {/* The educational payoff — the real fact, every round. */}
                <div
                  className="rounded-2xl p-4 text-center"
                  style={{
                    background: "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  <p className="text-cream/70 text-sm font-syne max-w-md mx-auto">
                    The real fact: <span className="text-cream/95">{round.reveal.card_fact}</span>
                  </p>
                  {!inperson && round.reveal.is_lie && round.reveal.claim_text && (
                    <p className="text-cream/45 text-xs font-syne mt-2 max-w-md mx-auto">
                      The lie they sold: &ldquo;{round.reveal.claim_text}&rdquo;
                    </p>
                  )}
                </div>

                {/* Presenter verdict line — visible to the whole room, with the
                    presenter's banked points. Gold confetti on CLEAN SWEEP. */}
                {(() => {
                  const total = round.reveal.calls.length;
                  const fooled = round.reveal.calls.filter((c) => !c.correct).length;
                  if (total === 0) return null;
                  const allFooled = fooled === total;
                  const noneFooled = fooled === 0;
                  const presenterPts = round.reveal.round_points[round.presenter_user_id] ?? 0;
                  const who = isPresenter ? "YOU" : presenterName.toUpperCase();
                  return (
                    <>
                      {allFooled && isPresenter && (
                        <Confetti
                          trigger={!reduced}
                          count={70}
                          origin="top"
                          duration={2000}
                          palette={["#FFD700", "#FDE68A", "#00BFFF", "#A855F7"]}
                        />
                      )}
                      <div
                        className={`rounded-xl px-4 py-3 text-center ${reduced ? "" : "pa-pop-in"}`}
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
                            ? `CLEAN SWEEP · ${who} FOOLED ALL ${total}`
                            : noneFooled
                              ? `EVERYONE READ ${who}`
                              : <>{who} FOOLED <CountUp value={fooled} duration={700} /> OF {total}</>}
                        </span>
                        <p className="font-bebas text-xs tracking-[0.2em] mt-1" style={{ color: presenterPts >= 0 ? "#FFD700" : "#FCA5A5" }}>
                          {presenterPts >= 0 ? `+${presenterPts}` : presenterPts} POINTS
                        </p>
                      </div>
                    </>
                  );
                })()}

                {/* Who called what + points — rows deal in staggered; correct
                    reads flash green. */}
                <div className="space-y-2">
                  {round.reveal.calls.map((c, i) => {
                    const pts = round.reveal!.round_points[c.user_id] ?? 0;
                    return (
                      <div
                        key={c.user_id}
                        className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 ${reduced ? "" : "pa-deal-in"} ${c.correct && !reduced ? "pa-correct-flash" : ""}`}
                        style={{
                          background: c.correct
                            ? "linear-gradient(135deg, rgba(34,197,94,0.14) 0%, rgba(34,197,94,0.04) 100%)"
                            : "rgba(255,255,255,0.03)",
                          border: c.correct ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.08)",
                          ...(reduced ? {} : { animationDelay: `${i * 80}ms` }),
                        }}
                      >
                        <p className="font-syne text-sm text-cream/90 min-w-0 truncate">
                          {c.username ?? "Player"}
                          {c.user_id === meUserId && <span className="text-cream/40 text-xs"> (you)</span>}
                        </p>
                        <span className="flex items-center gap-2 shrink-0">
                          <span
                            className="font-bebas text-sm tracking-wider"
                            style={{ color: c.correct ? "#86EFAC" : "rgba(238,244,255,0.45)" }}
                          >
                            {c.call.toUpperCase()} · {c.correct ? "RIGHT" : "FOOLED"}
                          </span>
                          {pts > 0 && (
                            <span className="font-bebas text-sm tracking-wider text-[#FFD700]">
                              +{pts}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} />

                {/* ── Final round: shared GameOverScreen (podium + Play Again ->
                    rematch + Back to Lobby -> end-game). Awards ride along as
                    the game-specific children slot. Fang payout slot stays
                    empty: Party V1 is zero-Fang. ── */}
                {isFinalRound ? (
                  <GameOverScreen
                    players={playersForBoard}
                    meUserId={meUserId}
                    accent={ACCENT}
                    isHost={isEffectiveHost}
                    onPlayAgain={handleRematch}
                    onBackToLobby={onReturnToLobby}
                    playAgainPending={rematchPending}
                  >
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
                  </GameOverScreen>
                ) : (
                  <>
                    {/* Phase 2 — real post-round vote (auto-decides at 75%). */}
                    <PostRoundVoteCard
                      roundId={round.id}
                      roundKind="pokerface"
                      isHost={isEffectiveHost}
                      onAutoPlayAgain={handleAutoPlayAgain}
                      onAutoBackToLobby={handleAutoBackToLobby}
                    />
                    {isEffectiveHost && (
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
                    )}
                  </>
                )}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="text-red-400 text-sm font-syne text-center" role="alert">
          {error}
        </p>
      )}

      {/* Score ticker — visible at all times. The reveal's "open" stage swaps
          in the full scoreboard above, so the compact ticker yields there. */}
      {!(phase === "reveal" && revealStage === "open") && (
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
