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
      setPhase(isMe ? "select-word" : "drawing");
      setNinnyMsg(isMe ? "Your turn! Pick a word to draw." : "Watch carefully and guess what they're drawing.");
    });
    ch.on("broadcast", { event: SKETCH_EVENTS.WORD_SELECTED }, () => {
      setPhase("drawing");
      setNinnyMsg(null);
    });
    ch.on("broadcast", { event: SKETCH_EVENTS.GUESS }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as {
        user_id: string;
        username: string | null;
        body: string;
        variant: ChatMsg["variant"];
      };
      if (!payload.user_id) return;
      setChat((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random()}`,
          user_id: payload.user_id,
          username: payload.username,
          body: payload.body,
          variant: payload.variant,
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
    }>(`/api/party/sketch/rounds/${round.id}/guess`, { guess: text });
    if (!res.ok || !res.data) return;
    const me = players.find((p) => p.user_id === meUserId);
    if (res.data.verdict === "correct") {
      setIGotIt(true);
      const ch = supabase.channel(sketchChannel(room.code));
      await ch.send({
        type: "broadcast",
        event: SKETCH_EVENTS.GUESS,
        payload: {
          user_id: meUserId,
          username: me?.username ?? "Someone",
          body: "got it!",
          variant: "correct",
        },
      });
    } else {
      const ch = supabase.channel(sketchChannel(room.code));
      await ch.send({
        type: "broadcast",
        event: SKETCH_EVENTS.GUESS,
        payload: {
          user_id: meUserId,
          username: me?.username ?? "Someone",
          body: res.data.was_close ? "is close!" : text,
          variant: res.data.was_close ? "close" : "guess",
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
            <span className="font-bebas text-xs tracking-wider px-2.5 py-1 rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/40">
              {subjectLabel || "DRAWING"}
            </span>
            {isDrawer && lockedWord && (
              <span className="font-bebas text-xs tracking-wider px-2.5 py-1 rounded-full bg-[#FFD700]/15 text-[#FFD700] border border-[#FFD700]/40">
                {lockedWord.toUpperCase()}
              </span>
            )}
            {!isDrawer && (
              <span className="font-syne text-xs text-cream/60 italic">
                {players.find((p) => p.user_id === round.drawer_user_id)?.username ?? "Someone"} is drawing
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`font-bebas text-2xl tracking-wider ${timeLeft <= 10 ? "text-red-400" : "text-cream/80"}`}
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
            {candidates.map((c) => (
              <button
                key={c.word}
                onClick={() => selectWord(c.word)}
                className="rounded-2xl p-5 text-left transition-all active:scale-95"
                style={{
                  background: "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(124,58,237,0.06) 100%)",
                  border: "1px solid rgba(168,85,247,0.45)",
                  boxShadow: "0 0 20px rgba(168,85,247,0.15)",
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

          {/* Guesser chat: hidden from drawer per anti-cheat */}
          {!isDrawer && phase === "drawing" && (
            <div
              className="rounded-2xl p-3 max-h-48 overflow-y-auto"
              style={{
                background: "rgba(16,12,26,0.6)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <AnimatePresence initial={false}>
                {chat.slice(-12).map((m) => (
                  <motion.div
                    key={m.id}
                    initial={reduced ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-sm font-syne py-0.5"
                  >
                    <span className="text-cream/55">{m.username ?? "Someone"}</span>
                    {m.variant === "correct" ? (
                      <span className="text-emerald-300 font-bold"> {m.body}</span>
                    ) : m.variant === "close" ? (
                      <span className="text-amber-300"> {m.body}</span>
                    ) : (
                      <span className="text-cream/80">: {m.body}</span>
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
              className="text-center rounded-xl py-2 font-bebas text-sm tracking-wider"
              style={{
                background: "rgba(34,197,94,0.15)",
                border: "1px solid rgba(34,197,94,0.4)",
                color: "#86EFAC",
              }}
            >
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
          <div
            className="rounded-2xl p-6 text-center"
            style={{
              background: "linear-gradient(135deg, rgba(255,215,0,0.18) 0%, rgba(168,85,247,0.1) 100%)",
              border: "1px solid rgba(255,215,0,0.45)",
              boxShadow: "0 0 32px rgba(255,215,0,0.15)",
            }}
          >
            <p className="font-bebas text-xs tracking-[0.3em] text-cream/50 mb-2">THE WORD WAS</p>
            <p className="font-bebas text-5xl text-[#FFD700] tracking-wider mb-3">
              {reveal.word.toUpperCase()}
            </p>
            {reveal.factoid && (
              <p className="text-cream/80 text-sm font-syne italic max-w-md mx-auto">
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
