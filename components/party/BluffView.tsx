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
import NinnyHostBubble from "./NinnyHostBubble";
import { bluffChannel, BLUFF_EVENTS } from "@/lib/party/realtime-channels";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";

interface Props {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
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
  }[];
  has_submitted?: boolean;
  my_submission?: string | null;
  submitted_count?: number;
  my_vote_answer_id?: string | null;
}

export default function BluffView({
  room,
  players,
  isHost,
  meUserId,
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

  // ── Start a fresh round (host) ──
  const startRound = useCallback(async () => {
    setPhase("loading");
    setDetail(null);
    setFakeInput("");
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

  // Host auto-starts the first round.
  useEffect(() => {
    if (isHost && !roundId && phase === "loading") {
      void startRound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // ── Listen for round_started ──
  useEffect(() => {
    const ch = supabase.channel(bluffChannel(room.code));
    ch.on("broadcast", { event: BLUFF_EVENTS.ROUND_STARTED }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { round_id?: string };
      if (payload.round_id && payload.round_id !== roundId) {
        setRoundId(payload.round_id);
        setPhase("write");
        setFakeInput("");
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
    ch.subscribe();
    return () => {
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
      if (remain === 0 && isHost && !advanceLock.current && (round.phase === "write" || round.phase === "vote")) {
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
  }, [detail, isHost, room.code, refreshDetail]);

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
      setError(res.error ?? "Couldn't save your fake.");
      return;
    }
    void refreshDetail();
  }

  // ── Vote ──
  async function castVote(answerId: string) {
    if (!roundId) return;
    const res = await apiPost(`/api/party/bluff/rounds/${roundId}/vote`, { answer_id: answerId });
    if (!res.ok) {
      setError(res.error ?? "Couldn't cast your vote.");
      return;
    }
    void refreshDetail();
  }

  // ── Render ──
  const playersForBoard = useMemo(() => players.map((p) => ({
    user_id: p.user_id,
    username: p.username,
    score: p.score,
  })), [players]);

  if (phase === "loading" || !detail) {
    return (
      <div className="flex flex-col items-center py-16 gap-4">
        <p className="font-bebas text-2xl text-cream/60 tracking-wider">DEALING ROUND...</p>
        <div className="w-12 h-12 rounded-full border-2 border-[#FFD700]/40 border-t-[#FFD700] animate-spin" />
      </div>
    );
  }

  const round = detail.round;

  return (
    <div className="space-y-4">
      <NinnyHostBubble message={ninnyMsg} />

      {/* Question card */}
      <div
        className="rounded-2xl p-5"
        style={{
          background: "linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(168,85,247,0.05) 100%)",
          border: "1px solid rgba(255,215,0,0.35)",
          boxShadow: "0 0 24px rgba(255,215,0,0.1)",
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
            ROUND {round.round_num} · {phase.toUpperCase()}
          </span>
          {phase !== "reveal" && (
            <span className={`font-bebas text-2xl ${timeLeft <= 5 ? "text-red-400" : "text-cream/80"}`}>
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
                {detail.submitted_count ?? 0} / {players.length} submitted
              </p>
            </div>
            <button
              type="submit"
              disabled={!fakeInput.trim() || submitting}
              className="w-full py-3 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95 disabled:opacity-30"
              style={{
                background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                color: "#04080F",
                boxShadow: "0 4px 18px rgba(255,215,0,0.3)",
              }}
            >
              {detail.has_submitted ? "UPDATE FAKE" : "SUBMIT FAKE"}
            </button>
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
            {detail.answers.map((a) => {
              const isMine = detail.my_vote_answer_id === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => castVote(a.id)}
                  className="w-full text-left rounded-xl px-4 py-3 transition-all active:scale-[0.98]"
                  style={{
                    background: isMine
                      ? "linear-gradient(135deg, rgba(168,85,247,0.22) 0%, rgba(124,58,237,0.1) 100%)"
                      : "rgba(255,255,255,0.04)",
                    border: isMine
                      ? "1px solid rgba(168,85,247,0.55)"
                      : "1px solid rgba(255,255,255,0.08)",
                    color: "rgba(238,244,255,0.92)",
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
              className="rounded-2xl p-5 text-center"
              style={{
                background: "linear-gradient(135deg, rgba(34,197,94,0.2) 0%, rgba(255,215,0,0.1) 100%)",
                border: "1px solid rgba(34,197,94,0.45)",
              }}
            >
              <p className="font-bebas text-xs tracking-[0.3em] text-cream/55 mb-1">THE TRUTH</p>
              <p className="font-bebas text-3xl text-emerald-300 tracking-wider">
                {round.correct_answer}
              </p>
            </div>

            <div className="space-y-2">
              {detail.answers
                .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
                .map((a) => {
                  const author = players.find((p) => p.user_id === a.author_user_id);
                  return (
                    <div
                      key={a.id}
                      className="rounded-xl px-4 py-3 flex items-center justify-between"
                      style={{
                        background: a.is_truth
                          ? "linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%)"
                          : "rgba(255,255,255,0.03)",
                        border: a.is_truth
                          ? "1px solid rgba(34,197,94,0.4)"
                          : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <div className="min-w-0">
                        <p className="font-syne text-sm text-cream/90">{a.text}</p>
                        <p className="text-cream/40 text-[11px] font-syne mt-0.5">
                          {a.is_truth ? "TRUTH" : `by ${author?.username ?? "Someone"}`}
                        </p>
                      </div>
                      <span className="font-bebas text-lg text-cream/80 ml-3 flex-shrink-0">
                        {a.vote_count ?? 0} {(a.vote_count ?? 0) === 1 ? "vote" : "votes"}
                      </span>
                    </div>
                  );
                })}
            </div>

            <PartyScoreboard players={playersForBoard} highlightUserId={meUserId} />

            {isHost && (
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
    </div>
  );
}
