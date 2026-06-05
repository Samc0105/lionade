"use client";

// SketchView — the per-round screen for Sketchy Subjects.
//
// Renders one of:
//   - "select-word" state: drawer is shown 3 candidate words to pick from.
//   - "drawing" state: drawer sees canvas + toolbar (no chat per anti-cheat).
//                      Guessers see canvas + guess input + chat feed.
//   - "reveal" state: word + factoid + scoreboard. CTA: Next Round (host) or
//                     Back to Lobby.
//
// Subscribes to the per-room sketch channel for round_started / round_ended
// events. The parent room page tells us when current_game flips back to null
// (game-over → lobby).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { apiGet, apiPost } from "@/lib/api-client";
import SketchCanvas from "./SketchCanvas";
import SketchToolbar, { SKETCH_COLORS, SKETCH_SIZES, type SketchTool } from "./SketchToolbar";
import PartyScoreboard from "./PartyScoreboard";
import NinnyHostBubble from "./NinnyHostBubble";
import RoundEndOverlay from "./RoundEndOverlay";
import PostRoundVoteCard from "./PostRoundVoteCard";
import MidGameInviteModal from "./MidGameInviteModal";
import Confetti from "@/components/Confetti";
import FangBurst from "@/components/competitive/FangBurst";
import { sketchChannel, SKETCH_EVENTS, roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";
import { SUBJECT_LABELS, type Subject } from "@/lib/party/word-lists-stub";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";

// How long the celebrating overlay holds on screen (server-pushed phase
// transition timing; all clients agree because they read from the same
// ROUND_ENDED broadcast payload).
const CELEBRATING_HOLD_MS = 2500;

interface Props {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
  onReturnToLobby: () => void;
}

interface RoundSnapshot {
  id: string;
  room_id: string;
  round_num: number;
  drawer_user_id: string;
  subject: string;
  duration_sec: number;
  started_at: string;
}

interface CandidateWord {
  word: string;
  difficulty: string;
  factoid?: string;
}

interface WordInfo {
  loading: boolean;
  definition?: string;
  example?: string;
  /** No dictionary entry found — popover falls back to the factoid alone. */
  notFound?: boolean;
}

const DIFFICULTY_STYLE: Record<
  string,
  {
    label: string;
    bg: string;
    border: string;
    color: string;
    /** Full-card glassmorphism tint (gradient) keyed to the difficulty hue. */
    cardBg: string;
    /** 1.5px card border at ~55% opacity of the difficulty hue. */
    cardBorder: string;
    /** Outer glow at ~18% opacity of the difficulty hue. */
    cardGlow: string;
  }
> = {
  easy: {
    label: "EASY",
    bg: "rgba(34,197,94,0.16)",
    border: "rgba(34,197,94,0.5)",
    color: "#86EFAC",
    cardBg: "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.06) 100%)",
    cardBorder: "rgba(34,197,94,0.55)",
    cardGlow: "0 0 20px rgba(34,197,94,0.18)",
  },
  medium: {
    label: "MEDIUM",
    bg: "rgba(245,158,11,0.16)",
    border: "rgba(245,158,11,0.5)",
    color: "#FCD34D",
    cardBg: "linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.06) 100%)",
    cardBorder: "rgba(245,158,11,0.55)",
    cardGlow: "0 0 20px rgba(245,158,11,0.18)",
  },
  hard: {
    label: "HARD",
    bg: "rgba(244,63,94,0.16)",
    border: "rgba(244,63,94,0.5)",
    color: "#FDA4AF",
    cardBg: "linear-gradient(135deg, rgba(244,63,94,0.18) 0%, rgba(244,63,94,0.06) 100%)",
    cardBorder: "rgba(244,63,94,0.55)",
    cardGlow: "0 0 20px rgba(244,63,94,0.18)",
  },
};

// Stable hardest-first ordering for the picker. Left-to-right reads
// HARD -> MEDIUM -> EASY for a consistent visual rhythm (red, gold, green).
// Unknown / missing difficulties sort last. Secondary sort is by original
// index so cards within the same tier never shuffle between renders.
const DIFFICULTY_RANK: Record<string, number> = { hard: 0, medium: 1, easy: 2 };

const PICK_SECONDS = 10;

interface ChatMsg {
  id: string;
  user_id: string;
  username: string | null;
  body: string;
  variant: "guess" | "close" | "correct" | "system";
  /** Comparable-letter indices of THIS guess that landed green (panel highlight). */
  matched?: number[];
}

// Renders a guess in the shared panel, greening the letters that landed in a
// correct position. `matched` is the set of comparable-letter indices (spaces/
// punctuation ignored) that matched. Highlighting the guesser's OWN typed text
// leaks nothing about the secret beyond which of their letters were right.
function GuessText({ body, matched }: { body: string; matched?: number[] }) {
  if (!matched || matched.length === 0) {
    return <span className="text-cream/80">{body}</span>;
  }
  const green = new Set(matched);
  let comparable = -1;
  return (
    <span>
      {Array.from(body).map((ch, i) => {
        const isLetter = /[a-zA-Z0-9]/.test(ch);
        if (isLetter) comparable += 1;
        const hit = isLetter && green.has(comparable);
        return (
          <span
            key={i}
            className={hit ? "text-emerald-300 font-bold" : "text-cream/80"}
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}

// A single display cell of the word-being-guessed (server-computed structure).
interface MaskCell {
  kind: "letter" | "fixed";
  char?: string;
}

export default function SketchView({
  room,
  players,
  isHost,
  meUserId,
  onReturnToLobby,
}: Props) {
  const reduced = useReducedMotion();
  const [round, setRound] = useState<RoundSnapshot | null>(null);
  const [candidates, setCandidates] = useState<CandidateWord[] | null>(null);
  const [lockedWord, setLockedWord] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(90);
  const [phase, setPhase] = useState<"loading" | "select-word" | "drawing" | "celebrating" | "reveal">("loading");
  // 3-2-1 pre-round countdown. Fires ONLY on the select-word → drawing
  // transition (not on initial load into an active round — those are
  // mid-round joins where the countdown would be wrong). Value goes
  // 3 → 2 → 1 → 0 (overlay hides at 0). Server-side timer still ticks
  // during the intro — drawer loses ~3s of a 90s round, worth the moment.
  const [countdownTicks, setCountdownTicks] = useState(0);
  const prevPhaseRef = useRef<typeof phase>("loading");
  const [reveal, setReveal] = useState<{
    word: string;
    factoid: string | null;
    drawer_user_id: string;
    scoreboard: { user_id: string; username: string | null; score: number }[];
  } | null>(null);

  // ── Celebrating phase state ──
  // Authoritatively populated by the ROUND_ENDED broadcast payload (server-
  // pushed). All clients render their canvas stamp + RoundEndOverlay from
  // these fields so the celebration shows the same winner + word everywhere.
  // `celebratingStartedAt` is sent by the originating client (drawer/host) so
  // every receiving client uses the same reference time for the 2.5s hold.
  // Note: this is a CLIENT-DERIVED celebrating state (not persisted as a DB
  // phase). The ROUND_ENDED broadcast IS the canonical event — every client
  // who receives it enters celebrating in lockstep. See report at end of
  // file for the "client-derived vs DB-persisted" design call.
  const [celebrating, setCelebrating] = useState<{
    winner: { user_id: string; username: string | null; avatar_url: string | null } | null;
    word: string;
    started_at: string;
  } | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [guessInput, setGuessInput] = useState("");
  const [iGotIt, setIGotIt] = useState(false);
  const [ninnyMsg, setNinnyMsg] = useState<string | null>(null);

  // ── Wordle reveal state (guesser-facing; the SECRET word never lives here) ──
  // mask = the word STRUCTURE (length + punctuation); revealed = the room-wide
  // map of matched display-position -> letter (green squares). Both are computed
  // server-side; guesser clients only ever receive matched positions + letters
  // the guesser already typed, never unrevealed letters.
  const [mask, setMask] = useState<MaskCell[]>([]);
  const [revealed, setRevealed] = useState<Record<number, string>>({});

  // ── juice-only transient state (no gameplay effect, derived from events already
  //    in client state — nothing is re-fetched and no secret column is read) ──
  const [fireFirstConfetti, setFireFirstConfetti] = useState(false); // FIRST correct guesser celebration
  const sawFirstCorrectRef = useRef(false); // gate so only the first correct guess fires confetti
  // Identity of the FIRST correct guesser this round — used to attribute the
  // round-end overlay. Captured from the GUESS broadcast (variant === "correct")
  // since we don't otherwise carry it server-side per round. null = nobody won.
  const firstCorrectRef = useRef<{ user_id: string; username: string | null } | null>(null);
  const [fangKey, setFangKey] = useState(0); // bumps on MY correct guess -> Fang burst

  // ── Wordle-flip stagger bookkeeping ──
  // For each letter position, the first render that sees it as `filled` gets a
  // stagger index relative to OTHER cells that flipped in the same render batch.
  // Subsequent renders read the cached index so the animation does not re-trigger
  // (and doesn't re-trigger on unrelated chat updates either). Resets per round.
  // Keyed Map: position -> { batch: number; index: number; classKey: number }
  // batch = which "wave" of reveals (1, 2, 3...); classKey forces the React key
  // to change exactly once when the cell becomes filled, so the CSS animation
  // re-mounts cleanly even if React would otherwise reuse the DOM node.
  const flipBatchRef = useRef<Map<number, { delayMs: number; classKey: number }>>(new Map());
  const flipBatchCounterRef = useRef(0);

  // Toolbar state (drawer only).
  const [tool, setTool] = useState<SketchTool>("brush");
  const [color, setColor] = useState<string>(SKETCH_COLORS[0]);
  const [brushSize, setBrushSize] = useState<number>(SKETCH_SIZES[1]);
  const [eraserSize, setEraserSize] = useState<number>(SKETCH_SIZES[1]);
  // Recents row — last 5 colors the drawer has reached for, deduped,
  // most-recent first. Persists across rounds via localStorage. Loaded once
  // on mount so the very first color tap doesn't get clobbered.
  const [colorRecents, setColorRecents] = useState<string[]>([]);
  const colorRecentsLoadedRef = useRef(false);
  useEffect(() => {
    if (colorRecentsLoadedRef.current) return;
    colorRecentsLoadedRef.current = true;
    try {
      const raw = localStorage.getItem("lionade_sketch_color_recents");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setColorRecents(parsed.filter((c) => typeof c === "string").slice(0, 5));
      }
    } catch { /* localStorage disabled, keep [] */ }
  }, []);
  const handleColorChange = useCallback((c: string) => {
    setColor(c);
    setColorRecents((prev) => {
      const next = [c, ...prev.filter((p) => p.toLowerCase() !== c.toLowerCase())].slice(0, 5);
      try { localStorage.setItem("lionade_sketch_color_recents", JSON.stringify(next)); } catch { /* ignore quota */ }
      return next;
    });
  }, []);
  const [strokeCount, setStrokeCount] = useState(0);
  const undoRef = useRef<(() => void) | null>(null);
  const clearRef = useRef<(() => void) | null>(null);

  // ── Mid-game invite modal (host-only surface) ──
  const [inviteOpen, setInviteOpen] = useState(false);

  // ── Pause / resume (broadcast-only V1, no DB persistence) ──
  // Host taps pause; we freeze the local round timer and disable canvas input
  // for everyone via a `paused` overlay. On resume we account for elapsed
  // pause time by bumping the local "paused for N seconds" offset so the
  // remaining seconds the timer sees are preserved.
  //
  // V1 limitation (acknowledged): a player who refreshes mid-pause won't see
  // the paused overlay until the next PAUSE broadcast lands; their local
  // timer will keep counting against the round's started_at. The next round
  // will reset state cleanly. Persisting paused_at to sketch_rounds is V3
  // work (needs a migration + new endpoints).
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [pausedByName, setPausedByName] = useState<string | null>(null);
  const pausedOffsetMsRef = useRef(0);

  // ── Spectator detection (client-derived) ──
  // A player who joined the room AFTER the current round's started_at is a
  // spectator for THIS round (rotation skips them, guess input replaced with
  // a "you joined mid-round" notice, they'll play the next round).
  // Server-side flag is the V3 path; for V1 we derive it client-side so the
  // feature ships without an extra column. `joined_at` is already on
  // PartyPlayer and the round's started_at is on the round snapshot.
  const me = players.find((p) => p.user_id === meUserId);
  const isSpectator = useMemo(() => {
    if (!round?.started_at || !me?.joined_at) return false;
    // The drawer can never be a spectator — they were already in the room
    // when the round started (the server picked them).
    if (round.drawer_user_id === meUserId) return false;
    // Only spectate during active gameplay phases. After reveal, the next
    // round will reset round.started_at to "now" and the player joins back.
    if (phase !== "drawing" && phase !== "celebrating" && phase !== "reveal") {
      return false;
    }
    return new Date(me.joined_at).getTime() > new Date(round.started_at).getTime();
  }, [round?.started_at, round?.drawer_user_id, me?.joined_at, meUserId, phase]);

  // ── 3-2-1 pre-round countdown trigger ──
  // Fires on select-word → drawing transition only. Reduced-motion users skip
  // the intro entirely (countdownTicks stays 0). Server-side clock still ticks
  // during the intro window — the drawer loses ~3s of a 90s round.
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (prev === "select-word" && phase === "drawing" && !reduced) {
      setCountdownTicks(3);
    }
  }, [phase, reduced]);

  // Tick countdown 3 → 2 → 1 → 0. Cleared on unmount or phase change.
  useEffect(() => {
    if (countdownTicks <= 0) return;
    const t = setTimeout(() => setCountdownTicks(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdownTicks]);

  // ── Single subscribed channel ref + helper ──
  // Every send MUST go through this ref. supabase.channel().send() silently
  // no-ops on an unsubscribed channel handle, which is what caused the missed
  // GUESS-correct broadcast on fresh tabs / slow networks (the drawer never
  // learned the round was won). Populated by the listener useEffect below.
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const roundIdRef = useRef<string | null>(null);
  const completeRoundRef = useRef<() => Promise<void>>(async () => {});

  const sendBroadcast = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const ch = channelRef.current;
      if (!ch || !subscribedRef.current) {
        console.warn("[SketchView] broadcast dropped — channel not ready", event);
        return;
      }
      const status = await ch.send({ type: "broadcast", event, payload });
      if (status !== "ok") {
        await new Promise((r) => setTimeout(r, 150));
        const retry = await ch.send({ type: "broadcast", event, payload });
        if (retry !== "ok") {
          console.warn("[SketchView] broadcast retry failed", event, retry);
        }
      }
    },
    [],
  );

  // ── Word-picker extras (drawer-facing only) ──
  // Countdown to auto-pick, which candidate's info popover is open, and a
  // per-word dictionary cache. pickedRef guards against the manual pick and the
  // auto-pick both firing select-word.
  const [pickSecs, setPickSecs] = useState(PICK_SECONDS);
  const [infoWord, setInfoWord] = useState<string | null>(null);
  const [wordInfo, setWordInfo] = useState<Record<string, WordInfo>>({});
  const pickedRef = useRef(false);

  const isDrawer = round?.drawer_user_id === meUserId;
  const subjectLabel = round ? SUBJECT_LABELS[round.subject as Subject] ?? round.subject : "";

  // ── Keyboard brush/eraser size (+/-) for drawer during drawing ──
  // Cycles through SKETCH_SIZES so a power-user can adjust without leaving the
  // canvas. Routes to the currently-active size state based on tool. Ignored
  // when typing in an input (e.g. chat) or while a modal is open.
  useEffect(() => {
    if (!isDrawer || phase !== "drawing") return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      if (e.key !== "+" && e.key !== "=" && e.key !== "-" && e.key !== "_") return;
      e.preventDefault();
      const up = e.key === "+" || e.key === "=";
      const setter = tool === "eraser" ? setEraserSize : setBrushSize;
      const current = tool === "eraser" ? eraserSize : brushSize;
      const idx = SKETCH_SIZES.indexOf(current as typeof SKETCH_SIZES[number]);
      const next = up
        ? SKETCH_SIZES[Math.min(SKETCH_SIZES.length - 1, idx + 1)]
        : SKETCH_SIZES[Math.max(0, idx - 1)];
      setter(next);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDrawer, phase, tool, brushSize, eraserSize]);

  // ── Round bootstrap ──
  const startRound = useCallback(async () => {
    setPhase("loading");
    setCandidates(null);
    setLockedWord(null);
    setReveal(null);
    setChat([]);
    setIGotIt(false);
    setStrokeCount(0);
    setMask([]);
    setRevealed({});
    flipBatchRef.current = new Map();
    flipBatchCounterRef.current = 0;
    sawFirstCorrectRef.current = false;
    firstCorrectRef.current = null;
    setCelebrating(null);
    setFireFirstConfetti(false);
    pickedRef.current = false;
    setPickSecs(PICK_SECONDS);
    setInfoWord(null);
    setWordInfo({});
    setPausedAt(null);
    setPausedByName(null);
    pausedOffsetMsRef.current = 0;
    const res = await apiPost<{ round: RoundSnapshot; drawer_should_pick: boolean }>(
      "/api/party/sketch/rounds",
      { code: room.code },
    );
    if (!res.ok || !res.data) {
      setNinnyMsg("Hmm, I couldn't deal a new round. Try again?");
      return;
    }
    roundIdRef.current = res.data.round.id;
    setRound(res.data.round);
    setTimeLeft(res.data.round.duration_sec);
    if (res.data.round.drawer_user_id === meUserId) {
      // Drawer fetches candidate words.
      const words = await apiGet<{ candidates: CandidateWord[] }>(
        `/api/party/sketch/rounds/${res.data.round.id}/words`,
      );
      if (words.ok && words.data?.candidates) {
        setCandidates(words.data.candidates);
        setPhase("select-word");
        setNinnyMsg("Your turn! Pick a word to draw.");
      } else {
        setPhase("drawing");
      }
    } else {
      setPhase("drawing");
      setNinnyMsg("Watch carefully and guess what they're drawing.");
    }
    // Tell the room that a new round started so guessers re-fetch state.
    await sendBroadcast(SKETCH_EVENTS.ROUND_STARTED, {
      round_id: res.data.round.id,
      drawer_user_id: res.data.round.drawer_user_id,
    });
  }, [room.code, meUserId, sendBroadcast]);

  // Host kicks off the first round automatically.
  useEffect(() => {
    if (isHost && !round && phase === "loading") {
      void startRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // ── Listen for round_started from the host ──
  useEffect(() => {
    const ch = supabase.channel(sketchChannel(room.code));
    ch.on("broadcast", { event: SKETCH_EVENTS.ROUND_STARTED }, async (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { round_id?: string; drawer_user_id?: string };
      if (!payload.round_id) return;
      // Avoid stomping our own creation. Read from the ref so the host's own
      // ROUND_STARTED echo (which arrives AFTER setRound but before the effect
      // re-binds) sees the freshly-set id, not the null captured at mount.
      if (roundIdRef.current === payload.round_id) return;
      // Fetch the round (guesser view).
      const isMe = payload.drawer_user_id === meUserId;
      roundIdRef.current = payload.round_id;
      setRound({
        id: payload.round_id,
        room_id: room.id,
        round_num: 0,
        drawer_user_id: payload.drawer_user_id ?? "",
        subject: "",
        duration_sec: 90,
        started_at: new Date().toISOString(),
      });
      setTimeLeft(90);
      setReveal(null);
      setIGotIt(false);
      setChat([]);
      setStrokeCount(0);
      setLockedWord(null);
      setCandidates(null);
      setMask([]);
      setRevealed({});
      flipBatchRef.current = new Map();
      flipBatchCounterRef.current = 0;
      sawFirstCorrectRef.current = false;
      firstCorrectRef.current = null;
      setCelebrating(null);
      setFireFirstConfetti(false);
      pickedRef.current = false;
      setPickSecs(PICK_SECONDS);
      setInfoWord(null);
      setWordInfo({});
      setPausedAt(null);
      setPausedByName(null);
      pausedOffsetMsRef.current = 0;
      setPhase(isMe ? "select-word" : "drawing");
      setNinnyMsg(isMe ? "Your turn! Pick a word to draw." : "Watch carefully and guess what they're drawing.");

      // ── Drawer-non-host candidate fetch ──
      // Before the fair-random drawer change, the host was always round 1's
      // drawer and `startRound` (host-only) fetched the candidates. Now the
      // drawer can be any player, so the drawer-non-host learns they're up
      // ONLY via this broadcast and must fetch their own candidates here, or
      // the picker would render blank (the "Your turn! No cards." bug).
      if (isMe) {
        const words = await apiGet<{ candidates: CandidateWord[] }>(
          `/api/party/sketch/rounds/${payload.round_id}/words`,
        );
        if (words.ok && words.data?.candidates) {
          setCandidates(words.data.candidates);
        } else {
          // Fall back to drawing phase so the round isn't stuck on a blank picker.
          setPhase("drawing");
          setNinnyMsg("Couldn't load your words. Someone else's turn might land in a sec.");
        }
      }
    });
    ch.on("broadcast", { event: SKETCH_EVENTS.WORD_SELECTED }, () => {
      setPhase("drawing");
      setNinnyMsg(null);
    });
    // Progressive Wordle reveal — a guess matched new letter positions. Light up
    // the shared green squares for everyone. Payload carries ONLY matched
    // positions + letters (never the secret word).
    ch.on("broadcast", { event: SKETCH_EVENTS.LETTER_REVEAL }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as {
        mask?: MaskCell[];
        revealed?: { position: number; letter: string }[];
      };
      if (Array.isArray(payload.mask) && payload.mask.length > 0) {
        setMask((prev) => (prev.length > 0 ? prev : payload.mask!));
      }
      if (Array.isArray(payload.revealed)) {
        setRevealed((prev) => {
          const next = { ...prev };
          for (const r of payload.revealed!) next[r.position] = r.letter;
          return next;
        });
      }
    });
    ch.on("broadcast", { event: SKETCH_EVENTS.GUESS }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as {
        user_id: string;
        username: string | null;
        body: string;
        variant: ChatMsg["variant"];
        matched?: number[];
      };
      if (!payload.user_id) return;
      // Juice-only: the FIRST correct guess of the round fires a celebratory
      // confetti burst. Derived from the broadcast we already receive — no fetch.
      if (payload.variant === "correct" && !sawFirstCorrectRef.current) {
        sawFirstCorrectRef.current = true;
        // Capture the first correct guesser's identity for round-end attribution.
        // Every client receives this broadcast at the same time, so they all
        // resolve to the same winner without any extra round-trip.
        firstCorrectRef.current = {
          user_id: payload.user_id,
          username: payload.username ?? null,
        };
        setFireFirstConfetti(true);
      }
      setChat((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          user_id: payload.user_id,
          username: payload.username,
          body: payload.body,
          variant: payload.variant,
          matched: Array.isArray(payload.matched) ? payload.matched : undefined,
        },
      ]);
    });
    // Phase 2 pause / resume — V1 broadcast-only (no DB persistence).
    ch.on("broadcast", { event: SKETCH_EVENTS.PAUSED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { paused_by?: string; started_at?: string };
      if (pausedAt) return; // already paused; ignore re-broadcasts
      setPausedAt(Date.now());
      setPausedByName(payload.paused_by ?? "Host");
    });
    ch.on("broadcast", { event: SKETCH_EVENTS.RESUMED }, () => {
      setPausedAt((prevStart) => {
        if (prevStart != null) {
          // Bank the paused duration so the round timer can subtract it from
          // the elapsed-wall-time calculation. Local-only — every client does
          // the same accounting from the same PAUSED/RESUMED broadcasts.
          pausedOffsetMsRef.current += Date.now() - prevStart;
        }
        return null;
      });
      setPausedByName(null);
    });
    ch.on("broadcast", { event: SKETCH_EVENTS.ROUND_ENDED }, (msg: { payload?: unknown }) => {
      // Server-pushed celebrating state — see "Server-pushed celebrating
      // phase" header above. All clients render the same overlay from the
      // same payload (winner / word / started_at), and then transition into
      // the reveal screen after CELEBRATING_HOLD_MS.
      const payload = (msg.payload ?? {}) as {
        reveal?: typeof reveal;
        celebrating?: {
          winner: { user_id: string; username: string | null; avatar_url: string | null } | null;
          word: string;
          started_at: string;
        };
      };
      if (payload.celebrating) {
        setCelebrating(payload.celebrating);
        setPhase("celebrating");
        setNinnyMsg(null);
      }
      if (payload.reveal) {
        // Stash the reveal payload; we only flip phase to "reveal" once the
        // celebrating hold elapses (handled by a separate effect). If the
        // celebrating payload was missing (older clients during rollout) we
        // skip celebrating and flip straight to reveal so the round still
        // completes cleanly.
        const r = payload.reveal;
        setReveal(r);
        if (!payload.celebrating) {
          setPhase("reveal");
          setNinnyMsg(null);
        }
      }
    });
    // Tier 1 lifecycle (2026-06-04): wrap subscribe with exponential-backoff
    // resubscribe so a transient WS drop doesn't silently leave the channel
    // dead. After MAX_ATTEMPTS the wrapper surfaces a single "Connection lost"
    // toast — see lib/realtime-resilient.ts.
    const handle = subscribeResilient(ch, {
      label: `sketch-room:${room.code}`,
      onSubscribed: () => { subscribedRef.current = true; },
      onUnsubscribed: () => { subscribedRef.current = false; },
    });
    channelRef.current = ch;
    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      handle.cancel();
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code, meUserId]);

  // ── Wordle reveal catch-up fetch ──
  // When a guesser enters/refreshes the drawing phase, pull the word STRUCTURE
  // (mask) + any already-revealed positions so late joiners see accumulated
  // green squares. The drawer never needs this (they see the real word); the
  // endpoint returns ONLY the mask + matched positions, never the secret.
  useEffect(() => {
    if (phase !== "drawing" || !round?.id || isDrawer) return;
    let cancelled = false;
    void (async () => {
      const res = await apiGet<{
        mask: MaskCell[];
        revealed: { position: number; letter: string }[];
      }>(`/api/party/sketch/rounds/${round.id}/reveal`);
      if (cancelled || !res.ok || !res.data) return;
      if (Array.isArray(res.data.mask) && res.data.mask.length > 0) {
        setMask(res.data.mask);
      }
      if (Array.isArray(res.data.revealed)) {
        setRevealed((prev) => {
          const next = { ...prev };
          for (const r of res.data!.revealed) next[r.position] = r.letter;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round?.id, isDrawer]);

  // ── Timer ──
  // Reads `completeRound` from a ref so the timer always invokes the LATEST
  // closure (bound to the current round id), even though the effect itself only
  // re-binds on phase/role changes. Avoids the stale-closure risk of POSTing
  // /complete against an old round id mid-transition.
  //
  // When the host pauses (pausedAt non-null) we freeze the visible countdown —
  // the interval keeps running but skips the decrement until resume.
  useEffect(() => {
    if (phase !== "drawing") return;
    const iv = setInterval(() => {
      // Frozen while paused — every client agrees because the PAUSED /
      // RESUMED broadcast lands at ~the same time for everyone.
      if (pausedAt !== null) return;
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(iv);
          if (isDrawer || isHost) {
            void completeRoundRef.current();
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, isDrawer, isHost, pausedAt]);

  // ── Drawer picks a word ──
  // pickedRef gates so the manual pick and the 10s auto-pick can't both fire
  // (the server also rejects a second select-word with 409, so a race is safe).
  const selectWord = useCallback(
    async (word: string) => {
      if (!round || pickedRef.current) return;
      pickedRef.current = true;
      setInfoWord(null);
      const res = await apiPost(`/api/party/sketch/rounds/${round.id}/select-word`, { word });
      if (!res.ok) {
        pickedRef.current = false; // let them try again
        return;
      }
      setLockedWord(word);
      setPhase("drawing");
      setNinnyMsg(null);
      await sendBroadcast(SKETCH_EVENTS.WORD_SELECTED, { round_id: round.id });
    },
    [round, sendBroadcast],
  );

  // ── Word info ("i" popover): real definition + example sentence ──
  // Fetched from the free Dictionary API client-side (drawer-only screen — the
  // candidate words are already on this client, so nothing leaks). The factoid
  // is always shown as the reliable base; the definition/example layer on top
  // when the dictionary has the word, and degrade silently when it doesn't.
  const fetchWordInfo = useCallback(async (word: string) => {
    setWordInfo((prev) => {
      if (prev[word]) return prev; // already fetched/fetching
      return { ...prev, [word]: { loading: true } };
    });
    try {
      const r = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
      );
      if (!r.ok) {
        setWordInfo((prev) => ({ ...prev, [word]: { loading: false, notFound: true } }));
        return;
      }
      const data = await r.json();
      let definition: string | undefined;
      let example: string | undefined;
      for (const entry of Array.isArray(data) ? data : []) {
        for (const m of entry?.meanings ?? []) {
          for (const d of m?.definitions ?? []) {
            if (!definition && d?.definition) definition = d.definition;
            if (!example && d?.example) example = d.example;
          }
        }
      }
      setWordInfo((prev) => ({
        ...prev,
        [word]: { loading: false, definition, example, notFound: !definition },
      }));
    } catch {
      setWordInfo((prev) => ({ ...prev, [word]: { loading: false, notFound: true } }));
    }
  }, []);

  const toggleInfo = useCallback(
    (word: string) => {
      setInfoWord((cur) => {
        const next = cur === word ? null : word;
        if (next) void fetchWordInfo(next);
        return next;
      });
    },
    [fetchWordInfo],
  );

  // ── Auto-pick countdown (drawer) ──
  // The picker can stall a round, so after PICK_SECONDS we pick a random
  // candidate for them. Runs only on the drawer's client while choosing.
  useEffect(() => {
    if (phase !== "select-word" || !candidates || candidates.length === 0) return;
    setPickSecs(PICK_SECONDS);
    const iv = setInterval(() => {
      setPickSecs((t) => {
        if (t <= 1) {
          clearInterval(iv);
          if (!pickedRef.current) {
            const rnd = candidates[Math.floor(Math.random() * candidates.length)];
            void selectWord(rnd.word);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, candidates, selectWord]);

  // ── Guess submit ──
  async function submitGuess(e: React.FormEvent) {
    e.preventDefault();
    if (!round || !guessInput.trim() || iGotIt) return;
    const text = guessInput.trim();
    setGuessInput("");
    const res = await apiPost<{
      verdict: "correct" | "close" | "wrong";
      was_correct: boolean;
      was_close: boolean;
      points_earned: number;
      fangs_earned?: number;
      mask?: MaskCell[];
      matched_positions?: { position: number; comparable: number; letter: string }[];
      newly_revealed?: { position: number; letter: string }[];
    }>(`/api/party/sketch/rounds/${round.id}/guess`, { guess: text });
    if (!res.ok || !res.data) return;
    const data = res.data;
    const me = players.find((p) => p.user_id === meUserId);

    const matched = data.matched_positions ?? [];
    // Comparable-letter indices for the panel green-highlight of THIS guess.
    const matchedComparable = matched.map((m) => m.comparable);
    const serverMask = data.mask;
    const newlyRevealed = data.newly_revealed ?? [];

    // Apply the reveal locally for the submitter (own green squares + mask).
    if (Array.isArray(serverMask) && serverMask.length > 0) {
      setMask((prev) => (prev.length > 0 ? prev : serverMask));
    }
    if (matched.length > 0) {
      setRevealed((prev) => {
        const next = { ...prev };
        for (const m of matched) next[m.position] = m.letter;
        return next;
      });
    }

    // Optimistic local echo so the submitter sees their own guess in the shared
    // panel (Supabase broadcast does not echo to the sender).
    setChat((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        user_id: meUserId,
        username: me?.username ?? "You",
        body: data.verdict === "correct" ? "got it!" : text,
        variant:
          data.verdict === "correct"
            ? "correct"
            : data.was_close
              ? "close"
              : "guess",
        matched: matchedComparable,
      },
    ]);

    // Broadcast the progressive reveal so the WHOLE room lights up the shared
    // green squares. Carries only matched positions + letters (no secret).
    if (newlyRevealed.length > 0 || matched.length > 0) {
      await sendBroadcast(SKETCH_EVENTS.LETTER_REVEAL, {
        mask: serverMask,
        revealed: newlyRevealed.length > 0 ? newlyRevealed : matched,
      });
    }

    if (data.verdict === "correct") {
      setIGotIt(true);
      setFangKey((k) => k + 1); // juice-only: Fang burst on my own correct guess
      // Self-capture: the broadcast doesn't echo back to the sender, so the
      // submitter records their own first-correct identity here for round-end
      // attribution. Every other client captures it via the GUESS handler.
      if (!sawFirstCorrectRef.current) {
        sawFirstCorrectRef.current = true;
        firstCorrectRef.current = {
          user_id: meUserId,
          username: me?.username ?? null,
        };
      }
      await sendBroadcast(SKETCH_EVENTS.GUESS, {
        user_id: meUserId,
        username: me?.username ?? "Someone",
        body: "got it!",
        variant: "correct",
        matched: matchedComparable,
      });
    } else {
      await sendBroadcast(SKETCH_EVENTS.GUESS, {
        user_id: meUserId,
        username: me?.username ?? "Someone",
        // Show the guesser's actual attempt to the room (shared guesses panel).
        body: text,
        variant: data.was_close ? "close" : "guess",
        matched: matchedComparable,
      });
    }
  }

  // ── Round complete ──
  // Two-phase finish: enter "celebrating" with the full-screen RoundEndOverlay
  // for ~2.5s, then advance to "reveal". The ROUND_ENDED broadcast carries
  // BOTH the celebrating payload (winner + word + started_at) and the reveal
  // payload (scoreboard + factoid) so every client agrees on the winner
  // attribution and renders the same overlay in lockstep.
  const completeRound = useCallback(async () => {
    if (!round) return;
    const res = await apiPost<{
      word: string;
      factoid: string | null;
      drawer_user_id: string;
      scoreboard: { user_id: string; username: string | null; score: number }[];
    }>(`/api/party/sketch/rounds/${round.id}/complete`, {});
    if (!res.ok || !res.data) return;
    const startedAt = new Date().toISOString();
    // Resolve winner from the first-correct-guesser ref (captured live during
    // the GUESS broadcast). Pulls avatar_url defensively from the players list
    // if it happens to be there (it isn't on PartyPlayer today, so we send null
    // and the overlay falls back to dicebear seeded on username).
    const fc = firstCorrectRef.current;
    const winner = fc
      ? {
          user_id: fc.user_id,
          username: fc.username,
          avatar_url:
            (players.find((p) => p.user_id === fc.user_id) as { avatar_url?: string | null } | undefined)
              ?.avatar_url ?? null,
        }
      : null;
    const celebratingPayload = {
      winner,
      word: res.data.word,
      started_at: startedAt,
    };
    // Local apply (broadcast doesn't echo to sender).
    setReveal(res.data);
    setCelebrating(celebratingPayload);
    setPhase("celebrating");
    setNinnyMsg(null);
    await sendBroadcast(SKETCH_EVENTS.ROUND_ENDED, {
      reveal: res.data,
      celebrating: celebratingPayload,
    });
  }, [round, players, sendBroadcast]);

  // Keep the timer-readable ref in sync with the latest `completeRound`
  // closure so the timer effect's call always uses the current round id.
  useEffect(() => {
    completeRoundRef.current = completeRound;
  }, [completeRound]);

  // ── Celebrating -> reveal transition ──
  // All clients run the same timeout because they read from the same server-
  // pushed `started_at`. Late joiners (e.g. tab unfocused when the broadcast
  // landed) compute the REMAINING hold from the server `started_at`, not from
  // their local effect mount time — so a viewer who joins 1.8s after the
  // broadcast only sees the overlay for ~0.7s, matching everyone else.
  useEffect(() => {
    if (phase !== "celebrating" || !celebrating) return;
    const elapsed = Math.max(0, Date.now() - new Date(celebrating.started_at).getTime());
    const remaining = Math.max(0, CELEBRATING_HOLD_MS - elapsed);
    const t = setTimeout(() => {
      setPhase("reveal");
      if (reveal) setNinnyMsg(`The word was "${reveal.word}".`);
    }, remaining);
    return () => clearTimeout(t);
  }, [phase, celebrating, reveal]);

  // ── Host pause / resume actions ──
  // V1 ships as broadcast-only (no migration). All clients agree because
  // they react to the same PAUSED / RESUMED broadcast in lockstep.
  const togglePause = useCallback(async () => {
    if (!isHost || !round) return;
    if (pausedAt === null) {
      const meRow = players.find((p) => p.user_id === meUserId);
      const startedAt = new Date().toISOString();
      setPausedAt(Date.now());
      setPausedByName(meRow?.username ?? "Host");
      await sendBroadcast(SKETCH_EVENTS.PAUSED, {
        paused_by: meRow?.username ?? "Host",
        started_at: startedAt,
      });
    } else {
      pausedOffsetMsRef.current += Date.now() - pausedAt;
      setPausedAt(null);
      setPausedByName(null);
      await sendBroadcast(SKETCH_EVENTS.RESUMED, {});
    }
  }, [isHost, round, pausedAt, players, meUserId, sendBroadcast]);

  // ── Vote auto-decide callbacks ──
  // When the room hits the 75% threshold, the host's client advances on
  // behalf of everyone. Non-host clients fire no-ops; the actual transition
  // arrives via the room/sketch channel broadcasts.
  const handleAutoPlayAgain = useCallback(() => {
    if (isHost) void startRound();
  }, [isHost, startRound]);
  const handleAutoBackToLobby = useCallback(() => {
    if (isHost) onReturnToLobby();
  }, [isHost, onReturnToLobby]);

  // ── Rematch CTA (Bucket C 2026-06-05) ──
  // Host-only: hits POST /api/party/rooms/[code]/rematch which resets scores,
  // clears ready flags, and drops the room back to lobby state. Lighter than
  // "back to lobby" semantically because it signals INTENT to play again — the
  // caller's lobby view can render a small "REMATCH" pill (purely informational,
  // not load-bearing). Non-host clients see a disabled "Waiting for host" pill.
  const [rematchPending, setRematchPending] = useState(false);
  const handleRematch = useCallback(async () => {
    if (!isHost || rematchPending) return;
    setRematchPending(true);
    const res = await apiPost(`/api/party/rooms/${room.code}/rematch`, {});
    if (!res.ok) {
      setRematchPending(false);
      return;
    }
    // Broadcast the same GAME_ENDED event the regular end-game flow uses so
    // every client refreshes back to the lobby view at the same moment.
    const ch = supabase.channel(roomChannel(room.code));
    await ch.send({ type: "broadcast", event: PARTY_EVENTS.GAME_ENDED, payload: {} });
    setRematchPending(false);
  }, [isHost, rematchPending, room.code]);

  // ── Render ──
  const playersForBoard = useMemo(() => players.map((p) => ({
    user_id: p.user_id,
    username: p.username,
    score: p.score,
  })), [players]);

  // Spectator set across the room — for the scoreboard badge. Same derivation
  // as `isSpectator` but for everyone: a player who joined after the current
  // round's started_at is spectating this round. Drawer is never a spectator.
  const spectatorUserIds = useMemo(() => {
    const s = new Set<string>();
    if (!round?.started_at) return s;
    const roundStart = new Date(round.started_at).getTime();
    if (phase !== "drawing" && phase !== "celebrating" && phase !== "reveal") {
      return s;
    }
    for (const p of players) {
      if (p.user_id === round.drawer_user_id) continue;
      if (new Date(p.joined_at).getTime() > roundStart) s.add(p.user_id);
    }
    return s;
  }, [players, round?.started_at, round?.drawer_user_id, phase]);

  // Per-cell display for the Wordle blanks row. For the drawer, fill every
  // letter cell from their locked word (they already know it). For guessers,
  // a letter cell shows its character ONLY if the room has revealed that
  // position (green); otherwise it stays a blank box. Fixed cells (space/
  // punctuation) always show their separator char.
  const blankCells = useMemo(() => {
    if (mask.length === 0) return [];
    // Drawer overlay source: their locked word, char by char.
    const drawerChars = isDrawer && lockedWord ? Array.from(lockedWord) : null;
    return mask.map((cell, i) => {
      if (cell.kind === "fixed") {
        return { kind: "fixed" as const, char: cell.char ?? " " };
      }
      if (drawerChars) {
        return { kind: "letter" as const, char: drawerChars[i] ?? "", filled: true, drawer: true };
      }
      const revealedChar = revealed[i];
      return {
        kind: "letter" as const,
        char: revealedChar ?? "",
        filled: revealedChar != null,
        drawer: false,
      };
    });
  }, [mask, revealed, isDrawer, lockedWord]);

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center py-20 gap-5 relative">
        {/* Soft purple glow pulse — replaces the bare spinner with something
            that reads as "the round is dealing in" rather than "API call
            stuck." Layered behind the title so text stays the focus. */}
        <div className="relative w-28 h-28 flex items-center justify-center">
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
            style={{
              background: "radial-gradient(circle, rgba(168,85,247,0.45) 0%, transparent 70%)",
            }}
          />
          <span
            aria-hidden="true"
            className={`absolute inset-3 rounded-full ${reduced ? "" : "pa-deal-glow"}`}
            style={{
              background: "radial-gradient(circle, rgba(255,215,0,0.35) 0%, transparent 70%)",
              animationDelay: "0.6s",
            }}
          />
          <div className="w-12 h-12 rounded-full border-2 border-purple-500/40 border-t-purple-400 animate-spin relative z-10" />
        </div>
        <p className="font-bebas text-2xl text-cream/70 tracking-[0.3em]">DEALING ROUND</p>
        <p className="text-cream/40 text-xs font-syne italic">shuffling subjects, picking a drawer</p>
      </div>
    );
  }

  // Panic vignette — red screen-edge pulse when the drawer's clock drops
  // under 5 seconds. Only renders for the drawer in active drawing phase
  // (spectators + guessers already see their own urgency UI). Pointer-events
  // disabled at the CSS level so it never intercepts canvas strokes.
  const showPanicVignette = isDrawer && phase === "drawing" && timeLeft > 0 && timeLeft < 5 && !reduced;

  // 3-2-1 cinematic intro overlay. Renders during the brief window between
  // select-word lock-in and the first stroke. Pointer-events: none so it never
  // blocks an accidental early canvas tap (drawer's tap-to-draw is queued by
  // SketchCanvas anyway). Full-screen blur backdrop + round-meta header + giant
  // number that scales in per tick.
  const drawerName = round
    ? players.find((p) => p.user_id === round.drawer_user_id)?.username
    : null;
  const showCountdown = countdownTicks > 0 && phase === "drawing";

  return (
    <div className="space-y-4">
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
              round {round?.round_num ?? 1}
            </p>
            <p className="font-bebas text-3xl sm:text-4xl tracking-wider text-cream">
              {drawerName ?? "drawer"} <span className="text-cream/45">is drawing</span>
            </p>
            {subjectLabel && (
              <span
                className="mt-1 inline-flex items-center font-bebas text-xs tracking-[0.25em] px-3 py-1 rounded-full"
                style={{
                  background: "rgba(168,85,247,0.18)",
                  border: "1px solid rgba(168,85,247,0.45)",
                  color: "#E9D5FF",
                }}
              >
                {subjectLabel}
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
            {isDrawer ? "get ready to draw" : "watch the canvas"}
          </p>
        </motion.div>
      )}
      {showPanicVignette && <div aria-hidden="true" className="pa-panic-vignette" />}
      <NinnyHostBubble message={ninnyMsg} />

      {/* Subject + timer + drawer pill */}
      {round && phase === "drawing" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`font-bebas text-xs tracking-wider px-2.5 py-1 rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/40 ${reduced ? "" : "pa-spotlight"}`}
            >
              {subjectLabel || "DRAWING"}
            </span>
            {isDrawer && lockedWord && (
              // Two-layer animation: pa-stamp fires once on lock-in (keyed on
              // the word), then pa-word-breathe takes over as an ambient
              // pulse for the rest of the round so the drawer doesn't lose
              // track of their word mid-canvas. Inner span carries the breath
              // so its scale doesn't fight the stamp on first paint.
              <span
                key={lockedWord}
                className={`inline-block ${reduced ? "" : "pa-stamp"}`}
              >
                <span
                  className={`inline-block font-bebas text-xs tracking-wider px-2.5 py-1 rounded-full bg-[#FFD700]/15 text-[#FFD700] border border-[#FFD700]/40 ${reduced ? "" : "pa-word-breathe"}`}
                >
                  {lockedWord.toUpperCase()}
                </span>
              </span>
            )}
            {!isDrawer && (
              <span className="font-syne text-xs text-cream/60 italic inline-flex items-center gap-1.5">
                {players.find((p) => p.user_id === round.drawer_user_id)?.username ?? "Someone"} is drawing
                {/* Low-frequency ink-dot pulse — pure chrome, never touches the
                    30Hz stroke canvas. Signals "live drawing in progress." */}
                <span aria-hidden="true" className="inline-flex items-center gap-0.5 ml-0.5">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`w-1 h-1 rounded-full bg-purple-300 ${reduced ? "opacity-70" : "pa-ink-dot"}`}
                      style={reduced ? undefined : { animationDelay: `${i * 200}ms` }}
                    />
                  ))}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`font-bebas text-2xl tracking-wider ${
                timeLeft <= 10 ? "text-red-400" : "text-cream/80"
              } ${timeLeft <= 10 && !reduced ? "ca-urgent inline-block" : ""}`}
            >
              {timeLeft}s
            </span>
          </div>
        </div>
      )}

      {/* Non-drawer waiting state during select-word phase. Previously a dead
          screen — the candidate picker only rendered for the drawer and the
          drawing-phase header was gated on phase==="drawing", so everyone else
          just stared at the Ninny bubble. Now they see WHO is picking + a
          calmer animation that reads as "this is a moment, not a hang." */}
      {phase === "select-word" && !candidates && round && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md mx-auto"
        >
          <div
            className="rounded-2xl p-7 text-center relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(168,85,247,0.14) 0%, rgba(99,102,241,0.06) 100%)",
              border: "1px solid rgba(168,85,247,0.35)",
              boxShadow: "0 0 28px rgba(168,85,247,0.12)",
            }}
          >
            <p className="font-bebas text-[11px] text-cream/55 tracking-[0.3em] mb-2">PICKING A WORD</p>
            <p className="font-bebas text-2xl text-cream tracking-wider mb-1">
              {players.find((p) => p.user_id === round.drawer_user_id)?.username ?? "The drawer"}
            </p>
            <p className="text-cream/55 text-xs font-syne italic mb-5">choosing what to sketch</p>
            <div aria-hidden="true" className="inline-flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full bg-purple-300 ${reduced ? "opacity-70" : "pa-ink-dot"}`}
                  style={reduced ? undefined : { animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
            {subjectLabel && (
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/35 mt-5">
                subject · {subjectLabel}
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* Candidate-word picker (drawer only) */}
      {phase === "select-word" && candidates && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-5 max-w-3xl mx-auto"
        >
          {/* Header: title + subject on the left, auto-pick countdown ring on the right */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">PICK A WORD</p>
              {subjectLabel && (
                <p className="font-syne text-xs text-cream/40 mt-0.5">{subjectLabel}</p>
              )}
            </div>
            {(() => {
              const C = 2 * Math.PI * 18;
              const frac = Math.max(0, Math.min(1, pickSecs / PICK_SECONDS));
              const urgent = pickSecs <= 3;
              const ring = urgent ? "#F43F5E" : "#A855F7";
              return (
                <div className="flex items-center gap-2 shrink-0">
                  <div className="relative w-12 h-12">
                    <svg viewBox="0 0 44 44" className="w-12 h-12 -rotate-90">
                      <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                      <circle
                        cx="22" cy="22" r="18" fill="none" stroke={ring} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={C}
                        strokeDashoffset={C * (1 - frac)}
                        style={{ transition: reduced ? "none" : "stroke-dashoffset 1s linear, stroke 0.3s" }}
                      />
                    </svg>
                    <span
                      className={`absolute inset-0 flex items-center justify-center font-bebas text-base ${urgent && !reduced ? "ca-urgent" : ""}`}
                      style={{ color: ring }}
                    >
                      {pickSecs}
                    </span>
                  </div>
                  <span className="font-syne text-[10px] text-cream/35 leading-tight max-w-[72px]">
                    auto-picks a word
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Candidate cards: difficulty badge + word + "i" info popover.
              Sorted HARD -> MEDIUM -> EASY (left-to-right) for consistent
              visual rhythm. Secondary sort by original index keeps cards
              within the same tier stable across renders. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {candidates
              .map((c, originalIndex) => ({ c, originalIndex }))
              .sort((a, b) => {
                const ra = DIFFICULTY_RANK[a.c.difficulty] ?? 99;
                const rb = DIFFICULTY_RANK[b.c.difficulty] ?? 99;
                if (ra !== rb) return ra - rb;
                return a.originalIndex - b.originalIndex;
              })
              .map(({ c }, i) => {
              const diff = DIFFICULTY_STYLE[c.difficulty] ?? DIFFICULTY_STYLE.medium;
              const info = wordInfo[c.word];
              const open = infoWord === c.word;
              return (
                <div
                  key={c.word}
                  className={`relative ${reduced ? "" : "pa-deal-in"}`}
                  style={reduced ? undefined : { animationDelay: `${i * 90}ms` }}
                >
                  <button
                    onClick={() => selectWord(c.word)}
                    className="w-full rounded-2xl p-5 pt-11 text-left transition-all active:scale-95 hover:-translate-y-0.5"
                    style={{
                      background: diff.cardBg,
                      border: `1.5px solid ${diff.cardBorder}`,
                      boxShadow: diff.cardGlow,
                    }}
                  >
                    <p className="font-bebas text-3xl tracking-wider text-cream">
                      {c.word.toUpperCase()}
                    </p>
                    <p className="text-cream/35 text-[11px] font-syne mt-2">Tap to draw this</p>
                  </button>

                  {/* Difficulty badge (top-left, color-coded) */}
                  <span
                    className="absolute top-3 left-3 font-bebas text-[10px] tracking-[0.18em] px-2 py-0.5 rounded-full pointer-events-none"
                    style={{ background: diff.bg, border: `1px solid ${diff.border}`, color: diff.color }}
                  >
                    {diff.label}
                  </span>

                  {/* "i" info toggle (top-right) — sibling button, stops the pick */}
                  <button
                    type="button"
                    aria-label={`What does ${c.word} mean?`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleInfo(c.word);
                    }}
                    className="absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full flex items-center justify-center font-bebas text-sm transition-all active:scale-90"
                    style={{
                      background: open ? "rgba(168,85,247,0.3)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${open ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.14)"}`,
                      color: open ? "#E9D5FF" : "rgba(238,244,255,0.6)",
                    }}
                  >
                    i
                  </button>

                  {/* Info popover: definition + example sentence + factoid */}
                  <AnimatePresence>
                    {open && (
                      <motion.div
                        initial={reduced ? false : { opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduced ? undefined : { opacity: 0, y: -4, scale: 0.98 }}
                        className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl p-3.5 text-left space-y-2"
                        style={{
                          background: "rgba(10,8,18,0.97)",
                          border: "1px solid rgba(168,85,247,0.4)",
                          boxShadow: "0 12px 36px rgba(0,0,0,0.55)",
                          backdropFilter: "blur(6px)",
                        }}
                      >
                        {info?.loading ? (
                          <p className="font-syne text-xs text-cream/50 italic">Looking it up...</p>
                        ) : (
                          <>
                            {info?.definition && (
                              <div>
                                <p className="font-bebas text-[10px] tracking-[0.2em] text-purple-300/80 mb-0.5">
                                  MEANING
                                </p>
                                <p className="font-syne text-xs text-cream/85 leading-relaxed">
                                  {info.definition}
                                </p>
                              </div>
                            )}
                            {info?.example && (
                              <div>
                                <p className="font-bebas text-[10px] tracking-[0.2em] text-purple-300/80 mb-0.5">
                                  IN A SENTENCE
                                </p>
                                <p className="font-syne text-xs text-cream/70 italic leading-relaxed">
                                  &ldquo;{info.example}&rdquo;
                                </p>
                              </div>
                            )}
                            {c.factoid && (
                              <div>
                                <p className="font-bebas text-[10px] tracking-[0.2em] text-[#FFD700]/80 mb-0.5">
                                  DID YOU KNOW
                                </p>
                                <p className="font-syne text-xs text-cream/70 leading-relaxed">
                                  {c.factoid}
                                </p>
                              </div>
                            )}
                            {!info?.definition && !info?.example && !c.factoid && (
                              <p className="font-syne text-xs text-cream/50 italic">
                                No extra info for this one. Just draw it.
                              </p>
                            )}
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          {/* Waiting-to-guess strip — fills the page + shows who's ready to play.
              Each other player gets a "charging" green dot while the drawer picks. */}
          {players.filter((p) => p.user_id !== meUserId).length > 0 && (
            <div
              className="rounded-2xl p-4"
              style={{
                background: "linear-gradient(135deg, rgba(16,12,26,0.6) 0%, rgba(8,6,16,0.6) 100%)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <p className="font-bebas text-[11px] tracking-[0.25em] text-cream/45 mb-3">
                WAITING TO GUESS
              </p>
              <div className="flex flex-wrap gap-2">
                {players
                  .filter((p) => p.user_id !== meUserId)
                  .map((p) => (
                    <div
                      key={p.user_id}
                      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5"
                      style={{
                        background: "rgba(34,197,94,0.06)",
                        border: "1px solid rgba(34,197,94,0.22)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block w-2 h-2 rounded-full ${reduced ? "" : "pa-charge"}`}
                        style={{ background: "#22C55E" }}
                      />
                      <span className="font-syne text-xs text-cream/80 truncate max-w-[120px]">
                        {p.username ?? "Player"}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Drawing surface */}
      {round && (phase === "drawing" || phase === "celebrating" || phase === "reveal") && (
        <div className="space-y-3">
          {/* Canvas + stamp wrapper. The stamp + green-corner overlay are
              siblings of the canvas (NOT children of it) so they never touch
              the 30Hz stroke paint loop in SketchCanvas. They sit inside this
              `relative` wrapper so they can be absolutely positioned over the
              canvas. */}
          <div className="relative">
            <SketchCanvas
              roomCode={room.code}
              roundId={round.id}
              readonly={!isDrawer || phase === "reveal"}
              disabled={phase === "celebrating" || phase === "reveal" || pausedAt !== null}
              color={color}
              size={tool === "eraser" ? eraserSize : brushSize}
              tool={tool}
              onStrokeCountChange={setStrokeCount}
              undoRef={undoRef}
              clearRef={clearRef}
            />

            {/* Host pause button — corner-pinned so it can't be accidentally
                clicked during drawing. Only renders during active drawing for
                the host. */}
            {isHost && phase === "drawing" && (
              <button
                type="button"
                onClick={togglePause}
                className="absolute top-2 right-2 z-20 px-3 py-1.5 rounded-full font-bebas text-[11px] tracking-wider transition-all active:scale-95"
                style={{
                  background: pausedAt !== null
                    ? "linear-gradient(135deg, rgba(34,197,94,0.3) 0%, rgba(22,163,74,0.15) 100%)"
                    : "rgba(16,12,26,0.85)",
                  border: pausedAt !== null
                    ? "1px solid rgba(34,197,94,0.55)"
                    : "1px solid rgba(255,255,255,0.18)",
                  color: pausedAt !== null ? "#86EFAC" : "rgba(238,244,255,0.85)",
                  backdropFilter: "blur(6px)",
                }}
                aria-label={pausedAt !== null ? "Resume the round" : "Pause the round"}
              >
                <span aria-hidden="true" className="mr-1">
                  {pausedAt !== null ? "▶" : "⏸"}
                </span>
                {pausedAt !== null ? "RESUME" : "PAUSE"}
              </button>
            )}

            {/* Mid-game invite (host) — sits next to pause, also corner-pinned. */}
            {isHost && (phase === "drawing" || phase === "celebrating" || phase === "reveal") && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="absolute top-2 left-2 z-20 px-3 py-1.5 rounded-full font-bebas text-[11px] tracking-wider transition-all active:scale-95"
                style={{
                  background: "rgba(16,12,26,0.85)",
                  border: "1px solid rgba(168,85,247,0.45)",
                  color: "#E9D5FF",
                  backdropFilter: "blur(6px)",
                }}
                aria-label="Invite a friend mid-game"
              >
                <span aria-hidden="true" className="mr-1">{"\u{1F517}"}</span>
                INVITE
              </button>
            )}

            {/* Paused overlay — all clients see it. Sits above the canvas with
                pointer-events: none for the body so the host's pause/resume
                button (placed BEFORE this overlay in the DOM and absolutely
                pinned) keeps its click target. */}
            {pausedAt !== null && phase === "drawing" && (
              <div
                aria-hidden="true"
                className="absolute inset-0 z-10 pointer-events-none rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(4,8,15,0.55)", backdropFilter: "blur(2px)" }}
              >
                <div
                  className="px-5 py-3 rounded-xl font-bebas tracking-[0.18em] text-2xl"
                  style={{
                    background: "rgba(16,12,26,0.92)",
                    border: "1px solid rgba(255,215,0,0.5)",
                    color: "#FFD700",
                    boxShadow: "0 0 24px rgba(255,215,0,0.25)",
                  }}
                >
                  <span aria-hidden="true" className="mr-2">{"⏸"}</span>
                  PAUSED by {pausedByName ?? "host"}
                </div>
              </div>
            )}

            {/* Canvas stamp + green corner brackets — only during celebrating.
                The stamp sits centered on top of the canvas; the four corner
                brackets bloom in if a winner was attributed (skip them on
                timeouts, which get the orange stamp on a dimmed canvas).
                pointer-events: none so even if the drawer's pointer were not
                already blocked by SketchCanvas's `disabled`, no input would
                land on the stamp. */}
            {phase === "celebrating" && celebrating && (
              <>
                {/* Dim the canvas slightly so the stamp pops on timeouts. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none rounded-2xl"
                  style={{
                    background: celebrating.winner
                      ? "rgba(4,8,15,0.18)"
                      : "rgba(4,8,15,0.32)",
                  }}
                />

                {/* Green corner brackets — only when there's a winner. */}
                {celebrating.winner && [
                  { top: "8px", left: "8px", borderTop: "3px solid #22C55E", borderLeft: "3px solid #22C55E" },
                  { top: "8px", right: "8px", borderTop: "3px solid #22C55E", borderRight: "3px solid #22C55E" },
                  { bottom: "8px", left: "8px", borderBottom: "3px solid #22C55E", borderLeft: "3px solid #22C55E" },
                  { bottom: "8px", right: "8px", borderBottom: "3px solid #22C55E", borderRight: "3px solid #22C55E" },
                ].map((corner, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`absolute pointer-events-none rounded-sm ${reduced ? "" : "pa-canvas-corner"}`}
                    style={{
                      width: "32px",
                      height: "32px",
                      ...corner,
                      animationDelay: reduced ? undefined : `${i * 60}ms`,
                    }}
                  />
                ))}

                {/* The stamp itself — centered, rotated -8deg, large. */}
                <div
                  aria-hidden="true"
                  className={`absolute pointer-events-none ${reduced ? "" : "pa-canvas-stamp"}`}
                  style={{
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%) rotate(-8deg)",
                  }}
                >
                  <span
                    className="font-bebas tracking-[0.18em] inline-block px-6 py-3 rounded-xl"
                    style={{
                      fontSize: "clamp(2.5rem, 8vw, 5rem)",
                      lineHeight: 1,
                      color: celebrating.winner ? "#22C55E" : "#F97316",
                      background: celebrating.winner
                        ? "rgba(34,197,94,0.12)"
                        : "rgba(249,115,22,0.12)",
                      border: celebrating.winner
                        ? "3px solid rgba(34,197,94,0.85)"
                        : "3px solid rgba(249,115,22,0.85)",
                      boxShadow: celebrating.winner
                        ? "0 0 24px rgba(34,197,94,0.4)"
                        : "0 0 24px rgba(249,115,22,0.4)",
                      textShadow: celebrating.winner
                        ? "0 0 12px rgba(34,197,94,0.55)"
                        : "0 0 12px rgba(249,115,22,0.55)",
                    }}
                  >
                    {celebrating.winner ? "GUESSED!" : "TIME'S UP"}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Wordle blanks — the word being guessed, one box per letter, with
              spaces/punctuation shown. Correct-position letters turn green as
              the room reveals them. The SECRET never reaches guesser clients;
              guessers fill a box only once the server confirms that position. */}
          {phase === "drawing" && blankCells.length > 0 && (() => {
            // ── Wordle flip batching ──
            // Any letter cell that just transitioned to `filled` this render and
            // is NOT yet in flipBatchRef gets registered into a new batch and
            // assigned a stagger delay (~70ms per cell within the batch). The
            // batch counter bumps once per wave so the next reveal's first cell
            // starts at delay 0 (not stacked onto the prior wave). The drawer's
            // word lands all at once on first render -> the whole word ripples
            // letter-by-letter in a single wave, which sells the "locked it in"
            // beat for them too.
            const STAGGER_MS = 70;
            const newlyFilled: number[] = [];
            for (let i = 0; i < blankCells.length; i++) {
              const c = blankCells[i];
              if (c.kind === "letter" && c.filled && !flipBatchRef.current.has(i)) {
                newlyFilled.push(i);
              }
            }
            if (newlyFilled.length > 0) {
              flipBatchCounterRef.current += 1;
              const classKey = flipBatchCounterRef.current;
              newlyFilled.forEach((pos, idx) => {
                flipBatchRef.current.set(pos, {
                  delayMs: idx * STAGGER_MS,
                  classKey,
                });
              });
            }
            return (
              <div className="flex flex-wrap items-center justify-center gap-1.5 py-1">
                {blankCells.map((cell, i) => {
                  if (cell.kind === "fixed") {
                    return (
                      <span
                        key={`fixed-${i}`}
                        aria-hidden="true"
                        className="w-3 text-center font-bebas text-2xl text-cream/40"
                      >
                        {cell.char === " " ? " " : cell.char}
                      </span>
                    );
                  }
                  const flip = flipBatchRef.current.get(i);
                  // The `key` includes the flip-batch classKey so when a cell
                  // first becomes filled, React remounts the span and the CSS
                  // animation kicks off cleanly. Subsequent renders preserve
                  // the same key so unrelated state (chat ticks) don't retrigger.
                  const cellKey = flip ? `cell-${i}-flip${flip.classKey}` : `cell-${i}-blank`;
                  return (
                    <span
                      key={cellKey}
                      className={`inline-flex items-center justify-center rounded-md font-bebas text-xl tracking-wider ${
                        cell.filled && !reduced ? "pa-tile-flip" : ""
                      }`}
                      style={{
                        width: "1.75rem",
                        height: "2.25rem",
                        background: cell.filled
                          ? "rgba(34,197,94,0.22)"
                          : "rgba(255,255,255,0.04)",
                        border: cell.filled
                          ? "1px solid rgba(34,197,94,0.6)"
                          : "1px solid rgba(255,255,255,0.12)",
                        color: cell.filled ? "#86EFAC" : "transparent",
                        // When the cell is mid-flip the keyframe owns its own
                        // box-shadow. When the cell is simply filled (catch-up
                        // fetch or reduced motion), keep the static green halo
                        // so the row doesn't look unstyled.
                        boxShadow:
                          cell.filled && (!flip || reduced)
                            ? "0 0 10px rgba(34,197,94,0.25)"
                            : undefined,
                        animationDelay:
                          flip && !reduced ? `${flip.delayMs}ms` : undefined,
                      }}
                    >
                      {cell.filled ? cell.char.toUpperCase() : ""}
                    </span>
                  );
                })}
              </div>
            );
          })()}

          {isDrawer && phase === "drawing" && (
            <SketchToolbar
              tool={tool}
              color={color}
              size={tool === "eraser" ? eraserSize : brushSize}
              recents={colorRecents}
              onToolChange={setTool}
              onColorChange={handleColorChange}
              onSizeChange={tool === "eraser" ? setEraserSize : setBrushSize}
              onUndo={() => undoRef.current?.()}
              onClear={() => clearRef.current?.()}
              canUndo={strokeCount > 0}
            />
          )}

          {/* Shared guesses panel — the WHOLE room sees every guesser's attempt
              in real time (name + guess). Visible to the drawer too: seeing
              guesses is just progress, and the drawer already knows the word.
              The secret word itself is never shown to guessers here. */}
          {phase === "drawing" && (
            <div
              className="rounded-2xl p-3 max-h-48 overflow-y-auto"
              style={{
                background: "rgba(16,12,26,0.6)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <p className="font-bebas text-[11px] tracking-[0.25em] text-cream/45 mb-1.5">
                GUESSES
              </p>
              <AnimatePresence initial={false}>
                {chat.slice(-14).map((m) => (
                  <motion.div
                    key={m.id}
                    initial={reduced ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-sm font-syne py-0.5 rounded-md px-1.5 -mx-1.5 ${
                      reduced ? "" : "pa-guess-pop"
                    } ${m.variant === "correct" && !reduced ? "pa-correct-flash" : ""}`}
                  >
                    <span className="text-cream/55">{m.username ?? "Someone"}</span>
                    {m.variant === "correct" ? (
                      <span className="text-emerald-300 font-bold"> got it! 🎉</span>
                    ) : m.variant === "close" ? (
                      <span className="text-amber-300"> is close!</span>
                    ) : (
                      <>
                        <span className="text-cream/80">: </span>
                        <GuessText body={m.body} matched={m.matched} />
                      </>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {chat.length === 0 && (
                <p className="text-cream/30 text-xs font-syne italic text-center py-1">
                  Guesses appear here...
                </p>
              )}
            </div>
          )}

          {/* Spectator notice — for players who joined mid-round. Replaces the
              guess input so they understand they'll play the next round. */}
          {!isDrawer && phase === "drawing" && isSpectator && (
            <div
              className="rounded-xl px-4 py-3 text-center font-syne text-sm text-cream/75"
              style={{
                background: "linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(99,102,241,0.05) 100%)",
                border: "1px solid rgba(168,85,247,0.35)",
              }}
            >
              <span aria-hidden="true" className="mr-1.5">{"\u{1F441}"}</span>
              You joined mid-round. You&apos;ll play the next round.
            </div>
          )}

          {/* Guess input (guesser only, not a spectator) */}
          {!isDrawer && phase === "drawing" && !iGotIt && !isSpectator && (
            <form onSubmit={submitGuess} className="flex gap-2">
              <input
                type="text"
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                placeholder="Type your guess..."
                maxLength={64}
                disabled={pausedAt !== null}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-syne text-cream outline-none disabled:opacity-40"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              />
              <button
                type="submit"
                disabled={!guessInput.trim() || pausedAt !== null}
                className="px-5 py-2.5 rounded-xl font-bebas tracking-wider text-sm transition-all active:scale-95 disabled:opacity-30"
                style={{
                  background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
                  color: "#fff",
                  boxShadow: "0 4px 16px rgba(168,85,247,0.3)",
                }}
              >
                GUESS
              </button>
            </form>
          )}
          {!isDrawer && iGotIt && (
            <div
              className={`relative text-center rounded-xl py-2 font-bebas text-sm tracking-wider ${reduced ? "" : "pa-pop-in"}`}
              style={{
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.4)",
                color: "#86EFAC",
              }}
            >
              <FangBurst burstKey={fangKey} />
              YOU GOT IT! WAITING FOR THE ROUND TO END...
            </div>
          )}
        </div>
      )}

      {/* Reveal */}
      {phase === "reveal" && reveal && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* First-correct-guesser celebration (self-gates on reduced motion) */}
          <Confetti
            trigger={fireFirstConfetti}
            count={56}
            origin="top"
            duration={1500}
            palette={["#A855F7", "#FFD700", "#6366F1", "#22C55E"]}
            onComplete={() => setFireFirstConfetti(false)}
          />
          <div
            className="rounded-2xl p-6 text-center"
            style={{
              background: "linear-gradient(135deg, rgba(255,215,0,0.18) 0%, rgba(168,85,247,0.1) 100%)",
              border: "1px solid rgba(255,215,0,0.45)",
              boxShadow: "0 0 32px rgba(255,215,0,0.15)",
            }}
          >
            <p className="font-bebas text-xs tracking-[0.3em] text-cream/50 mb-2">THE WORD WAS</p>
            <p className={`font-bebas text-5xl text-[#FFD700] tracking-wider mb-3 inline-block ${reduced ? "" : "pa-stamp"}`}>
              {reveal.word.toUpperCase()}
            </p>
            {reveal.factoid && (
              <p className={`text-cream/80 text-sm font-syne italic max-w-md mx-auto ${reduced ? "" : "pa-factoid-up"}`}>
                Did you know... {reveal.factoid}
              </p>
            )}
          </div>

          <PartyScoreboard
            players={reveal.scoreboard.map((s) => ({
              user_id: s.user_id,
              username: s.username,
              score: s.score,
            }))}
            highlightUserId={meUserId}
            drawerUserId={reveal.drawer_user_id}
            spectatorUserIds={spectatorUserIds}
          />

          {/* Post-round controls — Phase 2 real voting UI.
              Host sees the two big CTAs (play another round / back to lobby)
              plus the live vote tally. Non-host players see the vote buttons +
              tally. At 75% threshold the round transitions automatically. */}
          {round && (
            <PostRoundVoteCard
              roundId={round.id}
              roundKind="sketch"
              isHost={isHost}
              onAutoPlayAgain={handleAutoPlayAgain}
              onAutoBackToLobby={handleAutoBackToLobby}
            />
          )}

          {isHost ? (
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={startRound}
                  className="flex-1 py-3 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95 btn-gold"
                >
                  PLAY ANOTHER ROUND
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
              {/* Rematch CTA — fresh match, same roster, scores back to zero. */}
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
            // Non-host: show a quiet "waiting on host" pill so the screen
            // doesn't feel abandoned after the round reveal.
            <div className="text-center">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bebas tracking-wider text-cream/55 bg-white/[0.04] border border-white/10">
                Waiting for host
              </span>
            </div>
          )}
        </motion.div>
      )}

      {/* Live scoreboard (drawing phase, compact) */}
      {phase === "drawing" && (
        <PartyScoreboard
          players={playersForBoard}
          highlightUserId={meUserId}
          drawerUserId={round?.drawer_user_id ?? null}
          spectatorUserIds={spectatorUserIds}
          compact
        />
      )}

      {/* Round-end overlay — full-screen card with winner avatar + word
          reveal, mounted at view root via AnimatePresence. Only visible when
          server-pushed phase === "celebrating". All clients render this from
          the same payload at the same time. */}
      <AnimatePresence>
        {phase === "celebrating" && celebrating && (
          <RoundEndOverlay
            winner={celebrating.winner}
            word={celebrating.word}
            startedAt={celebrating.started_at}
            onEscape={() => setPhase("reveal")}
          />
        )}
      </AnimatePresence>

      {/* Mid-game friend invite (host only) — modal shows the full URL +
          room code so a friend can join late. The join flow already handles
          late joiners (they enter as spectators for the current round). */}
      <MidGameInviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        code={room.code}
      />
    </div>
  );
}
