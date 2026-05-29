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
import { apiGet, apiPost } from "@/lib/api-client";
import SketchCanvas from "./SketchCanvas";
import SketchToolbar, { SKETCH_COLORS, SKETCH_SIZES, type SketchTool } from "./SketchToolbar";
import PartyScoreboard from "./PartyScoreboard";
import NinnyHostBubble from "./NinnyHostBubble";
import Confetti from "@/components/Confetti";
import FangBurst from "@/components/competitive/FangBurst";
import { sketchChannel, SKETCH_EVENTS } from "@/lib/party/realtime-channels";
import { SUBJECT_LABELS, type Subject } from "@/lib/party/word-lists-stub";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";

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
}

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
  const [phase, setPhase] = useState<"loading" | "select-word" | "drawing" | "reveal">("loading");
  const [reveal, setReveal] = useState<{
    word: string;
    factoid: string | null;
    drawer_user_id: string;
    scoreboard: { user_id: string; username: string | null; score: number }[];
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
  const [fangKey, setFangKey] = useState(0); // bumps on MY correct guess -> Fang burst

  // Toolbar state (drawer only).
  const [tool, setTool] = useState<SketchTool>("brush");
  const [color, setColor] = useState<string>(SKETCH_COLORS[0]);
  const [size, setSize] = useState<number>(SKETCH_SIZES[1]);
  const [strokeCount, setStrokeCount] = useState(0);
  const undoRef = useRef<(() => void) | null>(null);
  const clearRef = useRef<(() => void) | null>(null);

  const isDrawer = round?.drawer_user_id === meUserId;
  const subjectLabel = round ? SUBJECT_LABELS[round.subject as Subject] ?? round.subject : "";

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
    sawFirstCorrectRef.current = false;
    setFireFirstConfetti(false);
    const res = await apiPost<{ round: RoundSnapshot; drawer_should_pick: boolean }>(
      "/api/party/sketch/rounds",
      { code: room.code },
    );
    if (!res.ok || !res.data) {
      setNinnyMsg("Hmm, I couldn't deal a new round. Try again?");
      return;
    }
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
    const ch = supabase.channel(sketchChannel(room.code));
    await ch.send({
      type: "broadcast",
      event: SKETCH_EVENTS.ROUND_STARTED,
      payload: { round_id: res.data.round.id, drawer_user_id: res.data.round.drawer_user_id },
    });
  }, [room.code, meUserId]);

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
      // Avoid stomping our own creation.
      if (round?.id === payload.round_id) return;
      // Fetch the round (guesser view).
      const isMe = payload.drawer_user_id === meUserId;
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
      sawFirstCorrectRef.current = false;
      setFireFirstConfetti(false);
      setPhase(isMe ? "select-word" : "drawing");
      setNinnyMsg(isMe ? "Your turn! Pick a word to draw." : "Watch carefully and guess what they're drawing.");
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
    ch.on("broadcast", { event: SKETCH_EVENTS.ROUND_ENDED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { reveal?: typeof reveal };
      if (payload.reveal) {
        setReveal(payload.reveal);
        setPhase("reveal");
        setNinnyMsg(null);
      }
    });
    ch.subscribe();
    return () => {
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
  useEffect(() => {
    if (phase !== "drawing") return;
    const iv = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(iv);
          if (isDrawer || isHost) {
            void completeRound();
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isDrawer, isHost]);

  // ── Drawer picks a word ──
  async function selectWord(word: string) {
    if (!round) return;
    const res = await apiPost(`/api/party/sketch/rounds/${round.id}/select-word`, { word });
    if (!res.ok) return;
    setLockedWord(word);
    setPhase("drawing");
    setNinnyMsg(null);
    const ch = supabase.channel(sketchChannel(room.code));
    await ch.send({
      type: "broadcast",
      event: SKETCH_EVENTS.WORD_SELECTED,
      payload: { round_id: round.id },
    });
  }

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

    const ch = supabase.channel(sketchChannel(room.code));

    // Broadcast the progressive reveal so the WHOLE room lights up the shared
    // green squares. Carries only matched positions + letters (no secret).
    if (newlyRevealed.length > 0 || matched.length > 0) {
      await ch.send({
        type: "broadcast",
        event: SKETCH_EVENTS.LETTER_REVEAL,
        payload: {
          mask: serverMask,
          revealed: newlyRevealed.length > 0 ? newlyRevealed : matched,
        },
      });
    }

    if (data.verdict === "correct") {
      setIGotIt(true);
      setFangKey((k) => k + 1); // juice-only: Fang burst on my own correct guess
      await ch.send({
        type: "broadcast",
        event: SKETCH_EVENTS.GUESS,
        payload: {
          user_id: meUserId,
          username: me?.username ?? "Someone",
          body: "got it!",
          variant: "correct",
          matched: matchedComparable,
        },
      });
    } else {
      await ch.send({
        type: "broadcast",
        event: SKETCH_EVENTS.GUESS,
        payload: {
          user_id: meUserId,
          username: me?.username ?? "Someone",
          // Show the guesser's actual attempt to the room (shared guesses panel).
          body: text,
          variant: data.was_close ? "close" : "guess",
          matched: matchedComparable,
        },
      });
    }
  }

  // ── Round complete ──
  const completeRound = useCallback(async () => {
    if (!round) return;
    const res = await apiPost<{
      word: string;
      factoid: string | null;
      drawer_user_id: string;
      scoreboard: { user_id: string; username: string | null; score: number }[];
    }>(`/api/party/sketch/rounds/${round.id}/complete`, {});
    if (!res.ok || !res.data) return;
    setReveal(res.data);
    setPhase("reveal");
    setNinnyMsg(`The word was "${res.data.word}".`);
    const ch = supabase.channel(sketchChannel(room.code));
    await ch.send({
      type: "broadcast",
      event: SKETCH_EVENTS.ROUND_ENDED,
      payload: { reveal: res.data },
    });
  }, [round, room.code]);

  // ── Render ──
  const playersForBoard = useMemo(() => players.map((p) => ({
    user_id: p.user_id,
    username: p.username,
    score: p.score,
  })), [players]);

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
      <div className="flex flex-col items-center py-16 gap-4">
        <p className="font-bebas text-2xl text-cream/60 tracking-wider">DEALING ROUND...</p>
        <div className="w-12 h-12 rounded-full border-2 border-purple-500/40 border-t-purple-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
              <span className="font-bebas text-xs tracking-wider px-2.5 py-1 rounded-full bg-[#FFD700]/15 text-[#FFD700] border border-[#FFD700]/40">
                {lockedWord.toUpperCase()}
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

      {/* Candidate-word picker (drawer only) */}
      {phase === "select-word" && candidates && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3"
        >
          <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">PICK A WORD</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {candidates.map((c, i) => (
              <button
                key={c.word}
                onClick={() => selectWord(c.word)}
                className={`rounded-2xl p-5 text-left transition-all active:scale-95 hover:-translate-y-0.5 ${reduced ? "" : "pa-deal-in"}`}
                style={{
                  background: "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(124,58,237,0.06) 100%)",
                  border: "1px solid rgba(168,85,247,0.45)",
                  boxShadow: "0 0 20px rgba(168,85,247,0.15)",
                  ...(reduced ? {} : { animationDelay: `${i * 90}ms` }),
                }}
              >
                <p className="font-bebas text-3xl tracking-wider text-cream mb-2">
                  {c.word.toUpperCase()}
                </p>
                <p className="text-cream/40 text-xs font-syne uppercase tracking-wider">
                  {c.difficulty}
                </p>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Drawing surface */}
      {round && (phase === "drawing" || phase === "reveal") && (
        <div className="space-y-3">
          <SketchCanvas
            roomCode={room.code}
            roundId={round.id}
            readonly={!isDrawer || phase === "reveal"}
            color={color}
            size={size}
            tool={tool}
            onStrokeCountChange={setStrokeCount}
            undoRef={undoRef}
            clearRef={clearRef}
          />

          {/* Wordle blanks — the word being guessed, one box per letter, with
              spaces/punctuation shown. Correct-position letters turn green as
              the room reveals them. The SECRET never reaches guesser clients;
              guessers fill a box only once the server confirms that position. */}
          {phase === "drawing" && blankCells.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 py-1">
              {blankCells.map((cell, i) =>
                cell.kind === "fixed" ? (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="w-3 text-center font-bebas text-2xl text-cream/40"
                  >
                    {cell.char === " " ? " " : cell.char}
                  </span>
                ) : (
                  <span
                    key={i}
                    className={`inline-flex items-center justify-center rounded-md font-bebas text-xl tracking-wider transition-all ${
                      cell.filled && !reduced ? "pa-pop-in" : ""
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
                      boxShadow: cell.filled ? "0 0 10px rgba(34,197,94,0.25)" : "none",
                    }}
                  >
                    {cell.filled ? cell.char.toUpperCase() : ""}
                  </span>
                ),
              )}
            </div>
          )}

          {isDrawer && phase === "drawing" && (
            <SketchToolbar
              tool={tool}
              color={color}
              size={size}
              onToolChange={setTool}
              onColorChange={setColor}
              onSizeChange={setSize}
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

          {/* Guess input (guesser only) */}
          {!isDrawer && phase === "drawing" && !iGotIt && (
            <form onSubmit={submitGuess} className="flex gap-2">
              <input
                type="text"
                value={guessInput}
                onChange={(e) => setGuessInput(e.target.value)}
                placeholder="Type your guess..."
                maxLength={64}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-syne text-cream outline-none"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              />
              <button
                type="submit"
                disabled={!guessInput.trim()}
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
          />

          {isHost && (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={startRound}
                className="flex-1 py-3 rounded-xl font-bebas tracking-wider text-base transition-all active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
                  color: "#fff",
                  boxShadow: "0 4px 18px rgba(168,85,247,0.3)",
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
        </motion.div>
      )}

      {/* Live scoreboard (drawing phase, compact) */}
      {phase === "drawing" && (
        <PartyScoreboard
          players={playersForBoard}
          highlightUserId={meUserId}
          drawerUserId={round?.drawer_user_id ?? null}
          compact
        />
      )}
    </div>
  );
}
