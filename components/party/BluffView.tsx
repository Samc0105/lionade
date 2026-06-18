"use client";

// BluffView — the per-round screen for Bluff Trivia.
//
// Three phases:
//   1. "write" (45s default): all players type a fake answer.
//   2. "vote"  (30s default): server shuffles real + fakes; players vote.
//   3. "reveal": one-by-one dramatic reveal (fakes first, truth last) +
//      per-player points breakdown + scoreboard + Next Round CTA. On the
//      final round (settings.bluff_round_count, default 5) the shared
//      GameOverScreen takes over with podium + Play Again / Back to Lobby.
//
// The server's phase value drives this component; we poll the round detail
// endpoint every ~1.5s and also subscribe to phase_changed broadcasts.
//
// Timeout handling (write phase): a player who never submits is simply
// SKIPPED — no client auto-submits a "..." placeholder. The host's timer
// advance doesn't require all answers, the vote list is just truth + the
// fakes that exist, and scoring iterates actual votes only, so an absent
// fake can't corrupt anything. (Auto-POSTing "..." would race the phase
// flip, collide with the duplicate-answer 409 when two players time out,
// and create a votable junk card worth unearned trick points.) The reveal
// breakdown shows a "no fake this round" line for skipped players instead.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api-client";
import PartyScoreboard from "./PartyScoreboard";
import AvatarCheckRow from "./AvatarCheckRow";
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
import RoundCountdown from "./RoundCountdown";
import GameOverScreen from "./GameOverScreen";
import { BLUFF_TRUTH_POINTS, BLUFF_FAKE_TRICK_POINTS } from "@/lib/party/scoring";
import { FORFEIT_SENTINEL, isForfeitText } from "@/lib/party/bluff-constants";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";

// Bluff's accent (gold) — matches the question card + CTA treatment.
const ACCENT = "#FFD700";
const COUNTDOWN_SECONDS = 5;

// Same dicebear style Poker Face uses for the presenter; seed = username so
// the avatar is stable across rounds without any profile fetch.
function avatarSrcFor(username: string | null | undefined): string {
  const seed = username && username.length > 0 ? username : "player";
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

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
  /** Vote phase only: the id of MY OWN fake so the client can gray it out.
   *  The server's own-fake vote rejection remains the backstop. */
  my_answer_id?: string | null;
  /** Vote phase only: player ids who have locked a vote in (ids only — the
   *  vote TARGETS stay hidden until reveal). */
  voted_user_ids?: string[];
}

// ── Redundant-poll guard ──
// The 1.5s safety poll re-fetches the round every cycle. Writing a fresh object
// into `detail` each time tears down + re-creates the 500ms phase-timer interval
// (its effect depends on [detail]) and re-renders this large component twice a
// second even when nothing changed. We compare the fields the render + timers
// actually read and bail out of the state write when they're equivalent.
// Legitimate phase / round / submission / vote / reveal changes are all inside
// the compared subset, so transitions still flow through. The answers + id
// arrays are small, so a scoped JSON compare is cheap.
function bluffDetailEqual(a: RoundDetail | null, b: RoundDetail): boolean {
  if (!a) return false;
  const ar = a.round;
  const br = b.round;
  if (
    ar.id !== br.id ||
    ar.phase !== br.phase ||
    ar.round_num !== br.round_num ||
    ar.question !== br.question ||
    (ar.category ?? null) !== (br.category ?? null) ||
    (ar.write_ends_at ?? null) !== (br.write_ends_at ?? null) ||
    (ar.vote_ends_at ?? null) !== (br.vote_ends_at ?? null) ||
    (ar.correct_answer ?? null) !== (br.correct_answer ?? null)
  ) {
    return false;
  }
  if (
    (a.has_submitted ?? null) !== (b.has_submitted ?? null) ||
    (a.my_submission ?? null) !== (b.my_submission ?? null) ||
    (a.submitted_count ?? null) !== (b.submitted_count ?? null) ||
    (a.my_vote_answer_id ?? null) !== (b.my_vote_answer_id ?? null) ||
    (a.my_answer_id ?? null) !== (b.my_answer_id ?? null)
  ) {
    return false;
  }
  return (
    JSON.stringify(a.answers ?? null) === JSON.stringify(b.answers ?? null) &&
    JSON.stringify(a.submitted_user_ids ?? null) === JSON.stringify(b.submitted_user_ids ?? null) &&
    JSON.stringify(a.voted_user_ids ?? null) === JSON.stringify(b.voted_user_ids ?? null)
  );
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
  // ONE dedicated live region for the reveal result. Set exactly once per round
  // (keyed on round id via revealAnnounceRef in the sequence-done effect) so the
  // 1.5s polls never re-announce. Cleared on round adoption.
  const [revealAnnounce, setRevealAnnounce] = useState<string | null>(null);
  const revealAnnounceRef = useRef<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  // One advance attempt per (round id, phase), with a 4s retry window for
  // failed POSTs. Replaces the old boolean advanceLock, which released the
  // moment the POST resolved — the still-running 500ms tick (closing over the
  // STALE phase) could re-POST "advance" before the poll flipped the local
  // phase, and the server (re-reading the round) advanced vote→reveal
  // instantly: the vote phase was skipped outright whenever the second tick
  // beat the detail refresh.
  const advanceAttemptRef = useRef<{ key: string; at: number } | null>(null);
  // Current round id, readable from stable callbacks without re-creating them.
  const roundIdRef = useRef<string | null>(null);
  // Every round id this client has adopted. Guards the ROUND_STARTED broadcast
  // AND the activeRound poll fallback against re-adopting a stale id (e.g. an
  // out-of-order room snapshot arriving after the next round already began).
  const seenRoundIdsRef = useRef<Set<string>>(new Set());
  // The subscribed bluff channel (owned by the listen effect). All outgoing
  // bluff broadcasts ride it — minting a throwaway same-topic channel per send
  // leaked one channel instance per round and risks supabase-js same-topic
  // subscription conflicts (see lib/party/realtime-channels.ts).
  const bluffChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── Between-rounds countdown (shared RoundCountdown, 5s) ──
  // Fires once per round when the fresh round's detail first lands in
  // phase='write' (mirrors PokerFaceView's wiring). RoundCountdown handles
  // reduced motion internally (static ticking numbers, no spring).
  const [countdownRoundId, setCountdownRoundId] = useState<string | null>(null);
  const countdownSeenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!detail || detail.round.phase !== "write") return;
    if (countdownSeenRef.current.has(detail.round.id)) return;
    countdownSeenRef.current.add(detail.round.id);
    setCountdownRoundId(detail.round.id);
  }, [detail]);
  const handleCountdownDone = useCallback(() => setCountdownRoundId(null), []);

  // ── Game length (from room settings; default 5 rounds) ──
  // The reveal of round N >= total swaps the Next Round CTA for the shared
  // GameOverScreen (podium + Play Again -> rematch + Back to Lobby).
  const totalRounds = Math.max(1, room.settings?.bluff_round_count ?? 5);

  // ── juice-only transient state (no gameplay effect, derived from `detail`
  //    already in client state — nothing extra is fetched) ──
  const [confirmKey, setConfirmKey] = useState(0); // bumps on a successful submit -> button pop

  // Phase 2 — mid-game invite modal (host surface).
  const [inviteOpen, setInviteOpen] = useState(false);
  // Forfeit-this-round: optimistic flag so the button replaces itself with a
  // "forfeited" pill immediately; the server filters the sentinel from vote +
  // reveal payloads. Re-derived from the poll's my_submission so a refresh
  // mid-write doesn't show the normal edit UI to a forfeited player.
  const [forfeitedLocal, setForfeitedLocal] = useState(false);
  const setForfeited = setForfeitedLocal;
  // Survives refresh: the write-phase GET returns the caller's own submission
  // text, so a sentinel row marks them forfeited even with fresh local state.
  const forfeited = forfeitedLocal || isForfeitText(detail?.my_submission);

  // ── One-by-one reveal sequencing (state/refs only — effects live below) ──
  // Step counter ticks ~1.2s per answer: fakes first (least-fooling to most),
  // truth LAST. Keyed per round id so the 1.5s polls don't restart the show.
  const [revealStep, setRevealStep] = useState(0);
  const revealRoundRef = useRef<string | null>(null);
  const revealDoneRef = useRef<Set<string>>(new Set());

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
    setPhase("write");
    setFakeInput("");
    setForfeitedLocal(false);
    setDetail(null);
    setError(null);
    setRevealAnnounce(null);
    setNinnyMsg("Write a fake answer that sounds real. Lie convincingly!");
  }, []);

  // ── Poll round detail (server is source of truth) ──
  // Stable callback (reads roundIdRef) so the channel effect can subscribe
  // ONCE per room instead of tearing down + resubscribing on every round
  // change — each resubscribe was a brief deafness window for PHASE_CHANGED /
  // ROUND_STARTED broadcasts.
  const refreshDetail = useCallback(async () => {
    const rid = roundIdRef.current;
    if (!rid) return;
    const res = await apiGet<RoundDetail>(`/api/party/bluff/rounds/${rid}`);
    if (!res.ok || !res.data) return;
    // Round changed while this GET was in flight — drop the stale payload.
    if (roundIdRef.current !== rid) return;
    // Functional updater + equality gate: skip the state write (and the
    // re-render + phase-timer teardown) when this poll's payload matches
    // what's already in state. setPhase below already no-ops an unchanged
    // primitive phase.
    const next = res.data;
    setDetail((prev) => (bluffDetailEqual(prev, next) ? prev : next));
    const p = res.data.round.phase;
    setPhase(p);
    if (p === "vote") setNinnyMsg("Vote for the answer you think is real.");
    // No truth spoiler mid-sequence: only name the answer once the one-by-one
    // reveal has finished (the sequence-done effect below sets it too).
    if (p === "reveal") {
      setNinnyMsg(
        revealDoneRef.current.has(res.data.round.id)
          ? `The truth: ${res.data.round.correct_answer}`
          : "Drumroll. Let's see who fooled who.",
      );
    }
  }, []);

  // Outgoing bluff broadcasts ride the SUBSCRIBED channel (fast WS push). The
  // fallback covers the pre-subscribe window: supabase.channel() dedupes by
  // topic, so it returns the live channel if one exists or mints ONE unjoined
  // instance whose send() rides the HTTP broadcast endpoint. We deliberately
  // never removeChannel here — RealtimeClient._remove() detaches by TOPIC, so
  // the old `finally { removeChannel }` could race the listen effect (which
  // dedupes onto the SAME instance) and unsubscribe the just-armed bluff
  // channel, leaving this client deaf (poll-only) for the whole game.
  const sendBluffEvent = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const ch = bluffChRef.current ?? supabase.channel(bluffChannel(room.code));
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
    setError(null);
    const res = await apiPost<{ round: RoundDetail["round"] }>(
      "/api/party/bluff/rounds",
      { code: room.code },
    );
    if (!res.ok || !res.data) {
      setError("Couldn't fetch a question. Try again.");
      return;
    }
    // The create route is idempotent: if a round was already in flight it
    // returns THAT round, so racing creators converge on one id. adoptRound
    // no-ops if we've already adopted it; refreshDetail re-hydrates either way.
    adoptRound(res.data.round.id);
    void refreshDetail();
    void sendBluffEvent(BLUFF_EVENTS.ROUND_STARTED, { round_id: res.data.round.id });
  }, [room.code, adoptRound, refreshDetail, sendBluffEvent]);

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
  //   - the rejoin/mid-phase mount (hydrate immediately instead of sitting on
  //     "loading" until a broadcast arrives), and
  //   - ANY missed ROUND_STARTED broadcast. The old one-shot bootstrap only
  //     ran before the first round; if a LATER round's broadcast dropped, the
  //     client kept polling the previous round forever and froze on its
  //     reveal screen. The seen-set in adoptRound makes this safe against
  //     stale snapshots.
  const activeRoundId = activeRound?.id ?? null;
  useEffect(() => {
    if (activeRoundId) adoptRound(activeRoundId);
  }, [activeRoundId, adoptRound]);

  // Host auto-starts the first round — only when there's no in-flight round
  // we should bootstrap into (the rejoin path takes that role above).
  useEffect(() => {
    if (isEffectiveHost && !roundId && phase === "loading" && !activeRound?.id) {
      void startRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEffectiveHost]);

  // ── Bluff channel: subscribe ONCE per room ──
  // Round discovery + phase pokes. Handlers go through the stable adoptRound /
  // refreshDetail callbacks, so this effect no longer depends on roundId (the
  // old version tore the channel down and resubscribed on every round change —
  // a per-round deafness window during which broadcasts were lost).
  useEffect(() => {
    const ch = supabase.channel(bluffChannel(room.code));
    ch.on("broadcast", { event: BLUFF_EVENTS.ROUND_STARTED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { round_id?: string };
      if (payload.round_id) adoptRound(payload.round_id);
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
    bluffChRef.current = ch;
    return () => {
      bluffChRef.current = null;
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
  // fire on the exact same tick. (The server CAS makes a stampede safe anyway —
  // this just avoids a burst of redundant POSTs.)
  const advanceJitterMs = useMemo(() => {
    let h = 0;
    for (let i = 0; i < meUserId.length; i++) h = (h * 31 + meUserId.charCodeAt(i)) >>> 0;
    return h % 1500;
  }, [meUserId]);

  // ── Phase timer + auto-advance ──
  // The effective host advances the moment the server deadline passes. EVERY
  // other client is a fallback: if nothing advanced by deadline + 5s (+ their
  // jitter) — host tab backgrounded with throttled timers, host mid-reconnect —
  // they attempt the advance themselves. The server only accepts non-host
  // advances after the deadline + grace, CASes the phase transition, and
  // no-ops on a stale from_phase, so racing/duplicate advancers are safe and
  // scores can't double-apply.
  useEffect(() => {
    if (!detail) return;
    const round = detail.round;
    if (round.phase !== "write" && round.phase !== "vote") {
      setTimeLeft(0);
      return;
    }
    const target = round.phase === "write" ? round.write_ends_at : round.vote_ends_at;
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
      // One attempt per (round, phase); a failed POST may retry after 4s. The
      // key never resets on success, so the stale 500ms tick can't re-advance
      // the round out of the NEXT phase while the poll catches up.
      const key = `${round.id}:${round.phase}`;
      const prev = advanceAttemptRef.current;
      if (prev && prev.key === key && now - prev.at < 4_000) return;
      advanceAttemptRef.current = { key, at: now };
      void apiPost(`/api/party/bluff/rounds/${round.id}/complete`, {
        action: "advance",
        // Stale-intent guard: the server no-ops if the round already moved on.
        from_phase: round.phase,
      }).then((res) => {
        if (!res.ok) return; // 403 pre-grace / transient failure — retry in 4s
        void refreshDetail();
        void sendBluffEvent(BLUFF_EVENTS.PHASE_CHANGED, { round_id: round.id });
      });
    }
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [detail, isEffectiveHost, advanceJitterMs, refreshDetail, sendBluffEvent]);

  // ── Reveal order: fakes (ascending fool-count, biggest liar builds the
  //    drama) then the truth last. Stable id tiebreak so every client and
  //    every poll agrees on the order. ──
  const orderedReveal = useMemo(() => {
    if (phase !== "reveal" || !detail?.answers) return [];
    const fakes = detail.answers
      .filter((a) => !a.is_truth)
      .sort((a, b) => (a.vote_count ?? 0) - (b.vote_count ?? 0) || a.id.localeCompare(b.id));
    const truth = detail.answers.filter((a) => a.is_truth);
    return [...fakes, ...truth];
  }, [phase, detail]);

  // Kick the sequence once per round. Reduced motion (or a rejoin into an
  // already-revealed round we played through) shows everything immediately.
  useEffect(() => {
    if (phase !== "reveal" || !detail) return;
    const rid = detail.round.id;
    if (revealRoundRef.current === rid) return;
    revealRoundRef.current = rid;
    if (reduced || revealDoneRef.current.has(rid)) {
      revealDoneRef.current.add(rid);
      setRevealStep(Number.MAX_SAFE_INTEGER);
      return;
    }
    setRevealStep(0);
  }, [phase, detail, reduced]);

  // Tick the steps: short 0.6s beat before the first card, then ~1.2s per
  // answer, plus one final beat before the breakdown/scoreboard block.
  useEffect(() => {
    if (phase !== "reveal" || orderedReveal.length === 0) return;
    const totalSteps = orderedReveal.length + 1;
    if (revealStep >= totalSteps) return;
    const t = setTimeout(
      () => setRevealStep((s) => s + 1),
      revealStep === 0 ? 600 : 1200,
    );
    return () => clearTimeout(t);
  }, [phase, revealStep, orderedReveal.length]);

  const revealSequenceDone =
    phase === "reveal" && orderedReveal.length > 0 && revealStep >= orderedReveal.length + 1;

  // Sequence finished: remember it (poll-proof) and let Ninny say the truth.
  useEffect(() => {
    if (!revealSequenceDone || !detail) return;
    revealDoneRef.current.add(detail.round.id);
    setNinnyMsg(`The truth: ${detail.round.correct_answer}`);
    // Mirror the outcome into the dedicated SR live region — fires exactly once
    // per round (revealAnnounceRef gate). The card sequence carries NO aria-live
    // so the 1.5s polls never spam. The visual signals (gold TRUTH badge, "fooled
    // N", voter chips) are conveyed here for screen-reader users.
    if (revealAnnounceRef.current !== detail.round.id) {
      revealAnnounceRef.current = detail.round.id;
      const answers = detail.answers ?? [];
      const truth = answers.find((a) => a.is_truth);
      const truthText = String(detail.round.correct_answer ?? truth?.text ?? "");
      const iFoundTruth = (truth?.voters ?? []).includes(meUserId);
      const myFooledVotes = answers
        .filter((a) => !a.is_truth && a.author_user_id === meUserId)
        .reduce((sum, a) => sum + (a.vote_count ?? 0), 0);
      const truthPart = `The real answer was ${truthText}.`;
      const guessPart = iFoundTruth
        ? "You found the truth."
        : "You did not find the truth.";
      const fooledPart =
        myFooledVotes > 0
          ? ` Your fake fooled ${myFooledVotes} ${myFooledVotes === 1 ? "player" : "players"}.`
          : " Your fake fooled nobody.";
      setRevealAnnounce(`${truthPart} ${guessPart}${fooledPart}`);
    }
  }, [revealSequenceDone, detail, meUserId]);

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
      // Surface the server's specific reason (e.g. "That answer matches the
      // real answer — try a different bluff") so the player knows WHY their
      // fake was rejected; the api-client already lifts the route's JSON
      // `error` field into res.error. Fall back to the generic copy only when
      // the server gave us nothing (network error with no body, etc.).
      setError(res.error || "Couldn't save your fake. Try again.");
      return;
    }
    setConfirmKey((k) => k + 1); // juice-only: submit confirmation pop
    void refreshDetail();
  }

  // ── Forfeit-this-round (Phase 2) ──
  // Submits the FORFEIT_SENTINEL answer via the existing endpoint so the
  // server-side dedup + truth-check logic still applies; the server filters
  // the sentinel out of vote + reveal payloads so it never renders as a
  // votable card. Lightweight V1 — a cleaner approach (separate /forfeit
  // route + hidden flag) is V3 work.
  async function forfeitRound() {
    if (!roundId || forfeited || submitting) return;
    setSubmitting(true);
    setError(null);
    setForfeited(true);
    const res = await apiPost(`/api/party/bluff/rounds/${roundId}/answer`, {
      text: FORFEIT_SENTINEL,
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
    // Room-channel send: supabase.channel() dedupes by topic, so this returns
    // the page's SUBSCRIBED room channel (fast ws push). Never removeChannel —
    // removal detaches by topic, so the old `finally { removeChannel }` was
    // unsubscribing the page's live room channel at the exact moment every
    // client needed it to hear GAME_ENDED.
    const ch = supabase.channel(roomChannel(room.code));
    await ch
      .send({ type: "broadcast", event: PARTY_EVENTS.GAME_ENDED, payload: {} })
      .catch(() => {});
    setRematchPending(false);
  }, [isEffectiveHost, rematchPending, room.code]);

  // ── Vote ──
  const [voting, setVoting] = useState(false);
  // Instant lock-in feedback; the server's my_vote_answer_id reconciles on
  // the next poll. Cleared whenever a fresh round starts.
  const [voteLocalId, setVoteLocalId] = useState<string | null>(null);
  useEffect(() => {
    setVoteLocalId(null);
    // Also rewind the reveal sequence early (during write) so a stale MAX
    // step from the previous round can't flash every card on the first
    // paint of the next reveal before the kick effect runs.
    setRevealStep(0);
  }, [roundId]);
  async function castVote(answerId: string) {
    if (!roundId || voting) return;
    if (answerId === detail?.my_answer_id) return; // own fake — server rejects too
    setVoting(true);
    setError(null);
    const res = await apiPost(`/api/party/bluff/rounds/${roundId}/vote`, { answer_id: answerId });
    setVoting(false);
    if (!res.ok) {
      console.error("[party:bluff-vote] failed", res.error);
      setError("Couldn't cast your vote. Try again.");
      return;
    }
    setVoteLocalId(answerId);
    void refreshDetail();
  }

  // Phase transition: clear stale error from the previous phase so e.g. a
  // write-phase submit failure doesn't bleed into vote.
  useEffect(() => {
    setError(null);
  }, [phase]);

  // ── Loading-rescue ──
  // If we sit on the spinner too long (round creation failed, or we mounted
  // mid-reveal where there is no in-flight round to adopt), give the effective
  // host a manual start/retry CTA instead of an infinite spinner — the old
  // startRound failure path set an error string that the loading branch never
  // rendered, so a failed create looked like a permanent hang. Safe to mash:
  // the create route returns the existing in-flight round when there is one.
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

  // ── Render ──
  const playersForBoard = useMemo(() => players.map((p) => ({
    user_id: p.user_id,
    username: p.username,
    score: p.score,
    avatar_url: p.avatar_url,
    equipped_username_effect: p.equipped_username_effect,
    equipped_name_color: p.equipped_name_color,
    equipped_frame: p.equipped_frame,
    equipped_avatar_aura: p.equipped_avatar_aura,
  })), [players]);

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
                background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                color: "#04080F",
                boxShadow: "0 4px 18px rgba(255,215,0,0.3)",
              }}
            >
              {error ? "TRY AGAIN" : "START THE NEXT ROUND"}
            </button>
          ) : (
            <p className="text-cream/40 text-xs font-syne">
              Syncing with the room. The next round starts when the host kicks it off.
            </p>
          )}
        </div>
      ) : null;
    // Intermission flavor when any player has scored — running scoreboard +
    // intermission framing. Falls back to the first-round cinematic loader.
    if (players.some((p) => (p.score ?? 0) > 0)) {
      return (
        <div className="space-y-2">
          <IntermissionCard
            players={players}
            meUserId={meUserId}
            accent="#FFD700"
            headline="NEXT ROUND IS LOADING"
            sub="queueing trivia, brewing fakes"
          />
          {rescue}
        </div>
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
          <div
            className={`w-12 h-12 rounded-full border-2 relative z-10 ${reduced ? "" : "animate-spin"}`}
            // Reduced motion: full solid gold ring (no spinning "gap" to imply motion).
            style={
              reduced
                ? { borderColor: "#FFD700" }
                : { borderColor: "rgba(255,215,0,0.4)", borderTopColor: "#FFD700" }
            }
          />
        </div>
        <p className="font-bebas text-2xl text-cream/70 tracking-[0.3em]">DEALING ROUND</p>
        <p className="text-cream/40 text-xs font-syne italic">queueing trivia, brewing fakes</p>
        {rescue}
      </div>
    );
  }

  const round = detail.round;
  // Time-pressure vignette — active write or vote phase under 5s, drawer-style
  // pulse on the screen edges. pa-panic-vignette + pointer-events: none from
  // the CSS class so it never blocks the fake input / vote tap.
  const showPanicVignette =
    (phase === "write" || phase === "vote") && timeLeft > 0 && timeLeft < 5 && !reduced;
  const isFinalRound = round.round_num >= totalRounds;

  const mePlayer = players.find((p) => p.user_id === meUserId);
  const isPendingJoiner = !!mePlayer?.is_pending_round;

  return (
    <div className="space-y-4">
      {isPendingJoiner && <JoiningNextRoundBanner variant="bluff" />}
      {showPanicVignette && <div aria-hidden="true" className="pa-panic-vignette" />}

      {/* ── Between-rounds countdown (shared RoundCountdown, 5s) ── */}
      <AnimatePresence>
        {countdownRoundId === round.id && phase === "write" && (
          <RoundCountdown
            key={`countdown-${round.id}`}
            roundNum={round.round_num}
            totalRounds={totalRounds}
            seconds={COUNTDOWN_SECONDS}
            accent={ACCENT}
            headline={
              <>get ready to <span style={{ color: ACCENT }}>bluff</span></>
            }
            subline="write a fake. fool the room."
            onComplete={handleCountdownDone}
          />
        )}
      </AnimatePresence>

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
            ROUND {round.round_num}/{totalRounds} · {phase.toUpperCase()}
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
            <label
              htmlFor="bluff-fake-input"
              className="block font-bebas text-sm tracking-[0.2em] text-cream/75"
            >
              WRITE A FAKE ANSWER THAT SOUNDS REAL.
            </label>
            <input
              id="bluff-fake-input"
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
            {/* Avatar roster — dim while a player is still writing, gold ring
                + checkmark badge once their fake lands server-side (ids-only
                from the GET; nobody's content leaks). Kahoot-lobby vibe;
                gives the room "everyone but Jordan is in" social pressure. */}
            <AvatarCheckRow
              players={players}
              doneIds={detail.submitted_user_ids ?? []}
              meUserId={meUserId}
              reduced={!!reduced}
              doneTitle="submitted"
              pendingTitle="still writing"
            />
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
                className="w-full min-h-[44px] flex items-center justify-center py-2 rounded-xl font-syne text-xs text-cream/55 hover:text-cream/85 transition-colors disabled:opacity-40"
              >
                I&apos;m out. Skip me this round
              </button>
            )}
          </motion.form>
        )}

        {phase === "vote" && detail.answers && (() => {
          const myVoteId = voteLocalId ?? detail.my_vote_answer_id ?? null;
          const hasVoted = !!myVoteId;
          return (
            <motion.div
              key="vote"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              className="space-y-2"
            >
              <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">PICK THE REAL ANSWER</p>
              {detail.answers.map((a, i) => {
                const isMyVote = myVoteId === a.id;
                const isOwnFake = detail.my_answer_id === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => castVote(a.id)}
                    disabled={voting || isOwnFake}
                    aria-disabled={isOwnFake || undefined}
                    className={`w-full text-left rounded-xl px-4 py-3 transition-all ${
                      isOwnFake
                        ? "cursor-not-allowed"
                        : "active:scale-[0.98] hover:-translate-y-0.5 disabled:opacity-60"
                    } ${reduced ? "" : "pa-deal-in"}`}
                    style={{
                      background: isMyVote
                        ? "linear-gradient(135deg, rgba(168,85,247,0.22) 0%, rgba(124,58,237,0.1) 100%)"
                        : isOwnFake
                          ? "rgba(255,255,255,0.02)"
                          : "rgba(255,255,255,0.04)",
                      border: isMyVote
                        ? "1px solid rgba(168,85,247,0.55)"
                        : isOwnFake
                          ? "1px dashed rgba(255,255,255,0.12)"
                          : "1px solid rgba(255,255,255,0.08)",
                      color: isOwnFake ? "rgba(238,244,255,0.4)" : "rgba(238,244,255,0.92)",
                      opacity: isOwnFake ? 0.55 : undefined,
                      ...(reduced ? {} : { animationDelay: `${i * 80}ms` }),
                    }}
                  >
                    <span className="font-syne text-base">{a.text}</span>
                    {isOwnFake && (
                      <span className="ml-2 font-bebas text-[10px] tracking-wider text-cream/40">
                        YOUR FAKE
                      </span>
                    )}
                    {isMyVote && (
                      <span className="ml-2 font-bebas text-[10px] tracking-wider text-purple-200">
                        YOUR VOTE
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Locked-in confirmation. Re-voting stays allowed server-side
                  until the timer runs out, so say so. */}
              {hasVoted && (
                <div
                  className={`rounded-xl px-4 py-2.5 text-center ${reduced ? "" : "pa-pop-in"}`}
                  style={{
                    background: "linear-gradient(135deg, rgba(168,85,247,0.16) 0%, rgba(99,102,241,0.08) 100%)",
                    border: "1px solid rgba(168,85,247,0.4)",
                  }}
                >
                  <p className="font-bebas text-sm tracking-wider text-purple-200">
                    VOTE LOCKED IN
                  </p>
                  <p className="text-cream/45 text-[11px] font-syne">
                    Tap a different answer to switch before time runs out.
                  </p>
                </div>
              )}

              {/* Who has voted — same ids-only pattern as the write roster.
                  Targets stay secret until reveal. */}
              <AvatarCheckRow
                players={players}
                doneIds={detail.voted_user_ids ?? []}
                meUserId={meUserId}
                reduced={!!reduced}
                doneTitle="voted"
                pendingTitle="still deciding"
              />
            </motion.div>
          );
        })()}

        {phase === "reveal" && detail.answers && (
          <motion.div
            key="reveal"
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Dedicated SR live region — announces the outcome exactly once per
                round (revealAnnounce only changes once, keyed on round id). The
                reveal sequence itself carries NO aria-live so the polls + the
                per-card mounts don't spam the screen reader. */}
            <span role="status" aria-live="assertive" className="sr-only">
              {revealAnnounce}
            </span>

            {/* ── One-by-one dramatic reveal: fakes first (least fooling to
                most), the REAL answer last with a gold TRUTH badge. Cards
                mount as revealStep advances (~1.2s apart), so the pa-deal-in
                CSS animation fires on mount — no per-card delay math.
                Reduced motion: revealStep is maxed, everything is static. ── */}
            <div className="space-y-2">
              {orderedReveal.map((a, i) => {
                if (revealStep <= i) return null;
                const author = players.find((p) => p.user_id === a.author_user_id);
                const fooled = a.vote_count ?? 0;
                const voterChips = (a.voters ?? []).length > 0 && (
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
                            ...(reduced ? {} : { animationDelay: `${300 + vi * 60}ms` }),
                          }}
                        >
                          {initial}
                        </span>
                      );
                    })}
                  </div>
                );

                if (a.is_truth) {
                  // The truth: gold badge + typewriter reveal, lands LAST.
                  return (
                    <div
                      key={a.id}
                      className={`rounded-xl px-4 py-4 ${reduced ? "" : "pa-deal-in pa-leader-glow"}`}
                      style={{
                        background: "linear-gradient(135deg, rgba(255,215,0,0.16) 0%, rgba(255,215,0,0.04) 100%)",
                        border: "1px solid rgba(255,215,0,0.55)",
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className="inline-flex items-center font-bebas text-[10px] tracking-[0.3em] px-2.5 py-0.5 rounded-full"
                          style={{
                            background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                            color: "#04080F",
                            boxShadow: "0 0 12px rgba(255,215,0,0.45)",
                          }}
                        >
                          TRUTH
                        </span>
                        <span className="font-bebas text-lg text-cream/80 flex-shrink-0">
                          <CountUp value={fooled} duration={700} />{" "}
                          {fooled === 1 ? "vote" : "votes"}
                        </span>
                      </div>
                      <p className="font-bebas text-2xl sm:text-3xl tracking-wider mt-1.5">
                        <RevealText
                          text={String(round.correct_answer ?? a.text)}
                          color="#FFD700"
                          glow="0 0 10px rgba(255,215,0,0.5)"
                        />
                      </p>
                      {voterChips}
                      {(a.voters ?? []).length === 0 && (
                        <span
                          className="mt-2 inline-flex items-center font-bebas text-[10px] tracking-[0.25em] px-2 py-0.5 rounded-full text-sky-200"
                          style={{
                            background: "rgba(125,211,252,0.12)",
                            border: "1px solid rgba(125,211,252,0.4)",
                          }}
                        >
                          ICE COLD · nobody believed it
                        </span>
                      )}
                    </div>
                  );
                }

                // A fake: author avatar pops in next to it + "fooled N players".
                return (
                  <div
                    key={a.id}
                    className={`rounded-xl px-4 py-3 flex items-center justify-between ${reduced ? "" : "pa-deal-in"}`}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-syne text-sm text-cream/90">{a.text}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={avatarSrcFor(author?.username)}
                          alt=""
                          aria-hidden="true"
                          className={`w-6 h-6 rounded-full bg-navy object-cover flex-shrink-0 ${reduced ? "" : "pa-pop-in"}`}
                          style={{
                            border: "1px solid rgba(255,215,0,0.4)",
                            ...(reduced ? {} : { animationDelay: "220ms" }),
                          }}
                        />
                        <p className="text-cream/50 text-[11px] font-syne truncate">
                          <span className="text-cream/85">{author?.username ?? "Someone"}</span>{" "}
                          {fooled === 0
                            ? "fooled nobody"
                            : `fooled ${fooled} ${fooled === 1 ? "player" : "players"}`}
                        </p>
                      </div>
                      {voterChips}
                    </div>
                    <span className="font-bebas text-lg text-cream/80 ml-3 flex-shrink-0">
                      <CountUp value={fooled} duration={700} />{" "}
                      {fooled === 1 ? "vote" : "votes"}
                    </span>
                  </div>
                );
              })}

              {/* Suspense dots while the sequence is still dealing. */}
              {!revealSequenceDone && (
                <div className="flex items-center justify-center gap-1.5 py-3" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full ${reduced ? "opacity-70" : "pa-ink-dot"}`}
                      style={{ background: ACCENT, animationDelay: `${i * 200}ms` }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* "You fooled N people" — sum of votes on the fakes I authored.
                Derived from the reveal payload already in client state.
                Per-fooler confetti burst when N >= 1. */}
            {(() => {
              if (!revealSequenceDone) return null;
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

            {/* ── Points breakdown — everyone sees everyone's lines once the
                sequence lands. Display-only mirror of the server's scoring
                (BLUFF_TRUTH_POINTS / BLUFF_FAKE_TRICK_POINTS); the banked
                scores stay server-authoritative. Players with no fake on the
                board (timed out or sat out) get a quiet zero line. ── */}
            {revealSequenceDone && (() => {
              const truthAnswer = detail.answers!.find((x) => x.is_truth);
              const rows = players
                .map((p) => {
                  const foundTruth = (truthAnswer?.voters ?? []).includes(p.user_id);
                  const tricked = detail.answers!
                    .filter((x) => !x.is_truth && x.author_user_id === p.user_id)
                    .reduce((sum, x) => sum + (x.vote_count ?? 0), 0);
                  const wroteFake = detail.answers!.some(
                    (x) => !x.is_truth && x.author_user_id === p.user_id,
                  );
                  const total =
                    (foundTruth ? BLUFF_TRUTH_POINTS : 0) + tricked * BLUFF_FAKE_TRICK_POINTS;
                  return { p, foundTruth, tricked, wroteFake, total };
                })
                .sort((a, b) => b.total - a.total);
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
                    {rows.map(({ p, foundTruth, tricked, wroteFake, total }) => (
                      <div key={p.user_id} className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={avatarSrcFor(p.username)}
                            alt=""
                            aria-hidden="true"
                            className="w-5 h-5 rounded-full bg-navy object-cover flex-shrink-0"
                            style={{ border: "1px solid rgba(255,255,255,0.15)" }}
                          />
                          <span className="font-syne text-sm text-cream/85 truncate">
                            {p.username ?? "Player"}
                            {p.user_id === meUserId && (
                              <span className="text-cream/40 text-xs"> (you)</span>
                            )}
                          </span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {foundTruth && (
                            <p className="font-dm-mono text-xs text-emerald-300">
                              +{BLUFF_TRUTH_POINTS} found the truth
                            </p>
                          )}
                          {tricked > 0 && (
                            <p className="font-dm-mono text-xs" style={{ color: "#FDE68A" }}>
                              +{tricked * BLUFF_FAKE_TRICK_POINTS} tricked {tricked}{" "}
                              {tricked === 1 ? "player" : "players"}
                            </p>
                          )}
                          {total === 0 && (
                            <p className="font-dm-mono text-xs text-cream/35">
                              {wroteFake ? "+0 this round" : "no fake this round · +0"}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {revealSequenceDone && (
              <>
                <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} />

                {/* ── Final round: shared GameOverScreen (podium + Play Again ->
                    rematch + Back to Lobby), mirroring PokerFaceView. The
                    Fang payout slot stays empty: Party V1 is zero-Fang. ── */}
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

      {phase !== "reveal" && (
        <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} compact />
      )}

      {/* Phase 2 mid-game invite (host only). Floating in the upper right so
          it doesn't disrupt the question card flow. */}
      {isHost && (
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-30 inline-flex items-center min-h-[44px] px-3.5 py-2.5 rounded-full font-bebas text-xs tracking-wider transition-all active:scale-95"
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
