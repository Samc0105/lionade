"use client";

/**
 * Lionade-Pardy — solo V1.
 *
 * Flow:
 *   1. /games/pardy renders the deck picker on first load.
 *   2. Pick a deck → 5×5 board renders. Tiles show only their Fang value.
 *   3. Click a tile → modal opens with the clue + an answer textarea.
 *   4. Submit → POST /api/games/pardy/submit → server validates + grants Fangs.
 *   5. Tile flips to a check (correct) or X (wrong, with the correct answer
 *      revealed) and is locked. Score updates.
 *   6. After all 25 tiles → Game Over screen with total Fangs earned.
 *
 * Multiplayer is V2. Final Pardy round is V2. We deliberately keep the V1
 * footprint tight: no DB session row, no resume-on-refresh (refresh = restart).
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AmbientOrbs from "@/components/AmbientOrbs";
import { useAuth } from "@/lib/auth";
import { mutateUserStats } from "@/lib/hooks";
import { cdnUrl } from "@/lib/cdn";
import { apiPost } from "@/lib/api-client";
import { MicrophoneStage, Check, X as XIcon, ArrowLeft, Crown, Lightning, Flame } from "@phosphor-icons/react";
import { PARDY_DECKS, getDeck, tileId, type PardyDeck } from "@/lib/pardy/decks";
import CountUp from "@/components/CountUp";

interface TileState {
  /** Has this tile been attempted (correct or wrong)? */
  attempted: boolean;
  /** Was the player's attempt correct? */
  correct: boolean;
  /** Fangs awarded (post-multiplier) on correct, 0 otherwise. */
  awarded: number;
}

type Phase = "picker" | "board" | "over";

interface ModalState {
  categoryIndex: number;
  tileIndex: number;
  answer: string;
  submitting: boolean;
  /** After submit: feedback object. Null while user is still typing. */
  result: null | { correct: boolean; correctAnswer: string; awarded: number };
}

export default function PardyPage() {
  const reduced = useReducedMotion();
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>("picker");
  const [deckId, setDeckId] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Record<string, TileState>>({});
  const [score, setScore] = useState(0);
  const [modal, setModal] = useState<ModalState | null>(null);

  // Auto-close timer for the result feedback in the modal.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const deck: PardyDeck | null = useMemo(() => (deckId ? getDeck(deckId) : null), [deckId]);

  const totalAttempted = useMemo(
    () => Object.values(tiles).filter((t) => t.attempted).length,
    [tiles],
  );

  // Game-over trigger — flips phase to "over" once all 25 tiles have been attempted.
  useEffect(() => {
    if (phase === "board" && totalAttempted >= 25) {
      // Small delay so the last-tile flip animation lands first.
      const t = setTimeout(() => setPhase("over"), 1200);
      return () => clearTimeout(t);
    }
  }, [phase, totalAttempted]);

  // ── Deck picker ─────────────────────────────────────────────
  const pickDeck = useCallback((id: string) => {
    setDeckId(id);
    setTiles({});
    setScore(0);
    setModal(null);
    setPhase("board");
  }, []);

  // ── Open a tile ─────────────────────────────────────────────
  const openTile = useCallback(
    (categoryIndex: number, tileIndex: number) => {
      if (!deck) return;
      const id = tileId(deck.id, categoryIndex, tileIndex);
      if (tiles[id]?.attempted) return;
      setModal({
        categoryIndex,
        tileIndex,
        answer: "",
        submitting: false,
        result: null,
      });
    },
    [deck, tiles],
  );

  // ── Submit answer ───────────────────────────────────────────
  const submitAnswer = useCallback(async () => {
    if (!deck || !modal || modal.submitting || modal.result) return;
    if (!modal.answer.trim()) return;
    const id = tileId(deck.id, modal.categoryIndex, modal.tileIndex);

    setModal({ ...modal, submitting: true });

    const res = await apiPost<{
      correct: boolean;
      correct_answer: string;
      awarded?: number;
    }>("/api/games/pardy/submit", { tileId: id, answer: modal.answer });

    if (!res.ok || !res.data) {
      // Surface the error inline by treating it as a wrong answer with a
      // fallback message. Don't lock the tile so the user can retry.
      setModal({
        ...modal,
        submitting: false,
        result: { correct: false, correctAnswer: "Could not reach the server. Try again.", awarded: 0 },
      });
      // Allow retry by clearing the result after 2s.
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      closeTimerRef.current = setTimeout(() => {
        setModal((m) => (m ? { ...m, result: null, submitting: false } : null));
      }, 2000);
      return;
    }

    const data = res.data;
    const awarded = data.awarded ?? 0;
    const correct = data.correct;

    setTiles((prev) => ({
      ...prev,
      [id]: { attempted: true, correct, awarded },
    }));
    if (correct && awarded > 0) {
      setScore((s) => s + awarded);
      if (user?.id) mutateUserStats(user.id);
    }
    setModal({
      ...modal,
      submitting: false,
      result: { correct, correctAnswer: data.correct_answer, awarded },
    });

    // Auto-close the modal after a short reveal window. Correct = quick, wrong = longer.
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(
      () => setModal(null),
      correct ? 1400 : 2600,
    );
  }, [deck, modal, user?.id]);

  const closeModal = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setModal(null);
  }, []);

  // ── Skip a tile ────────────────────────────────────────────
  // Marks the tile as attempted (incorrect, no Fang grant) and closes the
  // modal. Without this, "Skip" would leave the tile live and the game-over
  // trigger (totalAttempted >= 25) would be unreachable for any player who
  // skipped even one clue.
  const skipTile = useCallback(() => {
    if (!deck || !modal) return;
    const id = tileId(deck.id, modal.categoryIndex, modal.tileIndex);
    setTiles((prev) => ({
      ...prev,
      [id]: { attempted: true, correct: false, awarded: 0 },
    }));
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setModal(null);
  }, [deck, modal]);

  // ── Restart ─────────────────────────────────────────────────
  const restart = useCallback(() => {
    setDeckId(null);
    setTiles({});
    setScore(0);
    setModal(null);
    setPhase("picker");
  }, []);

  // ══════════════════════════════════════════════════════════
  // RENDER — PICKER
  // ══════════════════════════════════════════════════════════
  if (phase === "picker") {
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-20 md:pb-8 relative" style={{ isolation: "isolate" }}>
          <AmbientOrbs
            orbs={[
              { color: "#FFD700", pos: "top-[14%] right-[18%]", size: 460, opacity: 0.05 },
              { color: "#4A90D9", pos: "bottom-[18%] left-[12%]", size: 520, opacity: 0.05 },
            ]}
          />

          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 relative z-10">
            <Link
              href="/games"
              className="inline-flex items-center gap-1.5 text-cream/40 text-sm mb-6 hover:text-cream/70 transition"
            >
              <ArrowLeft size={14} weight="bold" /> Back to Arcade
            </Link>

            <header className="mb-10 animate-slide-up">
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/30 mb-2">
                lionade · house quiz
              </p>
              <h1 className="font-bebas text-[clamp(3rem,9vw,7rem)] text-cream tracking-tight leading-[0.86] flex items-center gap-4">
                <MicrophoneStage
                  size={64}
                  weight="fill"
                  className="text-gold shrink-0"
                  aria-hidden="true"
                />
                PARDY
              </h1>
              <p className="font-serif italic text-cream/40 text-sm mt-3 max-w-xl">
                Five categories, five tiles each. Bigger value, harder clue. Pick a deck and pull the curtain.
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {PARDY_DECKS.map((d, idx) => (
                <button
                  key={d.id}
                  onClick={() => pickDeck(d.id)}
                  className="text-left rounded-2xl backdrop-blur transition-all hover:bg-white/8 active:scale-[0.99] animate-slide-up"
                  style={{
                    animationDelay: `${0.1 + idx * 0.08}s`,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    padding: "1.25rem",
                  }}
                >
                  <div className="text-4xl mb-3" aria-hidden="true">{d.icon}</div>
                  <h3 className="font-bebas text-2xl text-cream tracking-wider mb-1">{d.name}</h3>
                  <p className="text-cream/50 text-sm font-syne leading-snug mb-4">
                    {d.description}
                  </p>
                  <div className="flex items-center gap-2">
                    <span
                      className="font-syne font-bold text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5"
                      style={{
                        background: "rgba(255,215,0,0.12)",
                        color: "#FFD700",
                        border: "1px solid rgba(255,215,0,0.25)",
                      }}
                    >
                      Play <span aria-hidden="true">→</span>
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/35">
                      25 tiles · up to 1,400 Fangs
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ══════════════════════════════════════════════════════════
  // RENDER — GAME OVER
  // ══════════════════════════════════════════════════════════
  if (phase === "over" && deck) {
    const correctCount = Object.values(tiles).filter((t) => t.correct).length;
    const accuracy = Math.round((correctCount / 25) * 100);
    // Tier label + accent based on accuracy. Used to flavor the FINAL TALLY
    // hero with one of four labels: PERFECT (gold crown), STRONG RUN (gold
    // flame), DECENT (electric lightning), TOUGH ROUND (muted).
    const tier =
      accuracy === 100
        ? { label: "PERFECT GAME", accent: "#FFD700", Icon: Crown, sub: "every tile cleared." }
        : accuracy >= 75
          ? { label: "STRONG RUN", accent: "#FFD700", Icon: Flame, sub: "well played." }
          : accuracy >= 50
            ? { label: "DECENT RUN", accent: "#4A90D9", Icon: Lightning, sub: "the room felt it." }
            : { label: "TOUGH ROUND", accent: "rgba(238,244,255,0.55)", Icon: Lightning, sub: "rematch the deck — your call." };
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-20 md:pb-8 relative" style={{ isolation: "isolate" }}>
          <AmbientOrbs
            orbs={[
              { color: tier.accent, pos: "top-[20%] left-[28%]", size: 520, opacity: 0.08 },
              { color: "#4A90D9", pos: "bottom-[20%] right-[24%]", size: 460, opacity: 0.05 },
            ]}
          />

          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 relative z-10 text-center animate-slide-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/30 mb-2">
              {deck.name}
            </p>
            <h1 className="font-bebas text-[clamp(3.5rem,11vw,9rem)] text-cream tracking-tight leading-[0.86] mb-3">
              FINAL TALLY
            </h1>
            {/* Tier label — frames the result before the user reads the number. */}
            <div
              className={`inline-flex items-center gap-2 px-3 py-1 rounded-full mb-6 ${reduced ? "" : "pa-pop-in"}`}
              style={{
                background: `linear-gradient(135deg, ${tier.accent}1f 0%, rgba(0,0,0,0.3) 100%)`,
                border: `1px solid ${tier.accent}66`,
              }}
            >
              <tier.Icon size={14} weight="fill" style={{ color: tier.accent }} aria-hidden="true" />
              <span className="font-bebas text-xs tracking-[0.25em]" style={{ color: tier.accent }}>
                {tier.label}
              </span>
            </div>

            <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-8 mb-6 relative overflow-hidden">
              {/* Soft tier-color halo behind the score */}
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `radial-gradient(circle at 50% 30%, ${tier.accent}22 0%, transparent 65%)`,
                }}
              />
              <div className="relative">
                <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-cream/40 mb-2">
                  total earned
                </p>
                <div className="flex items-center justify-center gap-3 mb-4">
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-10 h-10 object-contain" />
                  <p className="font-bebas text-7xl text-gold leading-none tabular-nums">
                    <CountUp value={score} duration={1100} />
                  </p>
                </div>
                <div className="flex items-center justify-center gap-4 text-sm">
                  <span className="font-syne text-cream/60">
                    <span className="font-bebas text-base text-cream/85 tabular-nums">
                      <CountUp value={correctCount} duration={900} />
                    </span>
                    {" of 25 tiles"}
                  </span>
                  <span className="w-px h-4 bg-white/10" aria-hidden="true" />
                  <span className="font-syne text-cream/60">
                    <span
                      className="font-bebas text-base tabular-nums"
                      style={{ color: tier.accent }}
                    >
                      <CountUp value={accuracy} duration={900} />%
                    </span>
                    {" accuracy"}
                  </span>
                </div>
                <p className="font-syne italic text-cream/45 text-xs mt-4">{tier.sub}</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={restart}
                className="btn-gold px-6 py-3 rounded-xl text-sm"
              >
                Pick another deck
              </button>
              <Link
                href="/games"
                className="px-6 py-3 rounded-xl text-sm font-syne font-bold text-cream bg-white/5 border border-white/10 hover:bg-white/10 transition"
              >
                Back to Arcade
              </Link>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ══════════════════════════════════════════════════════════
  // RENDER — BOARD
  // ══════════════════════════════════════════════════════════
  if (!deck) return null;

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8 relative" style={{ isolation: "isolate" }}>
        <AmbientOrbs
          orbs={[
            { color: "#FFD700", pos: "top-[14%] right-[18%]", size: 360, opacity: 0.04 },
            { color: "#4A90D9", pos: "bottom-[18%] left-[12%]", size: 420, opacity: 0.04 },
          ]}
        />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 relative z-10">

          {/* Header bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6 animate-slide-up">
            <div>
              <button
                onClick={restart}
                className="inline-flex items-center gap-1.5 text-cream/40 text-xs hover:text-cream/70 transition mb-1"
              >
                <ArrowLeft size={12} weight="bold" /> Change deck
              </button>
              <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none flex items-center gap-2">
                <span aria-hidden="true">{deck.icon}</span> {deck.name}
              </h1>
            </div>
            <div
              className="rounded-xl bg-white/5 backdrop-blur border border-white/10 px-4 py-2 flex items-center gap-3"
            >
              <div className="flex items-center gap-1.5">
                <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                <span className="font-bebas text-2xl text-gold tabular-nums leading-none">{score}</span>
              </div>
              <div className="h-6 w-px bg-cream/10" aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">
                {totalAttempted} / 25
              </span>
            </div>
          </div>

          {/* Board: 5-column grid. Each column is a category. */}
          <div className="grid grid-cols-5 gap-2 sm:gap-3">
            {deck.categories.map((cat, ci) => (
              <div key={ci} className="flex flex-col gap-2 sm:gap-3">
                {/* Category header */}
                <div
                  className="rounded-lg sm:rounded-xl px-2 py-3 sm:py-4 text-center animate-slide-up"
                  style={{
                    animationDelay: `${0.05 + ci * 0.04}s`,
                    background: "linear-gradient(180deg, rgba(74,144,217,0.18) 0%, rgba(74,144,217,0.08) 100%)",
                    border: "1px solid rgba(74,144,217,0.3)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  <p className="font-bebas text-[10px] sm:text-sm md:text-base text-cream tracking-wider leading-tight">
                    {cat.name}
                  </p>
                </div>

                {/* Tiles */}
                {cat.tiles.map((tile, ti) => {
                  const id = tileId(deck.id, ci, ti);
                  const state = tiles[id];
                  const attempted = state?.attempted ?? false;
                  const correct = state?.correct ?? false;
                  return (
                    <button
                      key={ti}
                      onClick={() => openTile(ci, ti)}
                      disabled={attempted}
                      className="relative aspect-[5/3] sm:aspect-[4/3] rounded-lg sm:rounded-xl flex items-center justify-center transition-all animate-slide-up disabled:cursor-not-allowed active:scale-[0.97]"
                      style={{
                        animationDelay: `${0.1 + ci * 0.04 + ti * 0.02}s`,
                        background: attempted
                          ? correct
                            ? "linear-gradient(180deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%)"
                            : "linear-gradient(180deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.04) 100%)"
                          : "linear-gradient(180deg, rgba(255,215,0,0.08) 0%, rgba(255,255,255,0.02) 100%)",
                        border: attempted
                          ? correct
                            ? "1px solid rgba(34,197,94,0.4)"
                            : "1px solid rgba(239,68,68,0.35)"
                          : "1px solid rgba(255,215,0,0.25)",
                        boxShadow: attempted
                          ? "none"
                          : "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 12px rgba(0,0,0,0.3)",
                      }}
                      aria-label={
                        attempted
                          ? `${cat.name}, ${tile.value} Fangs, ${correct ? "correct" : "missed"}`
                          : `${cat.name}, ${tile.value} Fangs, click to play`
                      }
                    >
                      <span
                        key={attempted ? "done" : "open"}
                        className={`inline-flex items-center justify-center ${attempted && !reduced ? "pa-tile-flip" : ""}`}
                      >
                        {attempted ? (
                          correct ? (
                            <Check size={28} weight="bold" className="text-green-400" aria-hidden="true" />
                          ) : (
                            <XIcon size={28} weight="bold" className="text-red-400" aria-hidden="true" />
                          )
                        ) : (
                          <span className="flex items-center gap-1">
                            <img
                              src={cdnUrl("/F.png")}
                              alt=""
                              aria-hidden="true"
                              className="w-3 h-3 sm:w-4 sm:h-4 object-contain opacity-70"
                            />
                            <span className="font-bebas text-xl sm:text-3xl md:text-4xl text-gold tabular-nums leading-none">
                              {tile.value}
                            </span>
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Modal */}
        {modal && deck.categories[modal.categoryIndex] && (
          <PardyModal
            categoryName={deck.categories[modal.categoryIndex].name}
            tile={deck.categories[modal.categoryIndex].tiles[modal.tileIndex]}
            modal={modal}
            onChangeAnswer={(answer) => setModal({ ...modal, answer })}
            onSubmit={submitAnswer}
            onClose={closeModal}
            onSkip={skipTile}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function PardyModal({
  categoryName,
  tile,
  modal,
  onChangeAnswer,
  onSubmit,
  onClose,
  onSkip,
}: {
  categoryName: string;
  tile: { value: number; question: string; correctAnswer: string };
  modal: ModalState;
  onChangeAnswer: (answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  onSkip: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC to close (only before submit so it doesn't kill the reveal).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !modal.result) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modal.result, onClose]);

  const result = modal.result;
  const correct = result?.correct ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-slide-up"
      style={{ background: "rgba(4,8,15,0.85)", backdropFilter: "blur(8px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${categoryName} for ${tile.value} Fangs`}
    >
      <div
        className="w-full max-w-xl rounded-3xl backdrop-blur border p-8 sm:p-10"
        style={{
          background: "linear-gradient(180deg, rgba(74,144,217,0.18) 0%, rgba(74,144,217,0.04) 100%)",
          borderColor: "rgba(74,144,217,0.4)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header strip */}
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/50">
            {categoryName}
          </p>
          <div className="flex items-center gap-1.5">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />
            <span className="font-bebas text-xl text-gold tabular-nums leading-none">
              {tile.value}
            </span>
          </div>
        </div>

        {/* Clue */}
        <p className="font-bebas text-2xl sm:text-3xl text-cream tracking-wide leading-tight mb-6 text-center min-h-[3.5rem]">
          {tile.question}
        </p>

        {/* Answer area or result */}
        {!result ? (
          <>
            <textarea
              ref={inputRef}
              value={modal.answer}
              onChange={(e) => onChangeAnswer(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits, Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
              rows={2}
              disabled={modal.submitting}
              placeholder="Your answer"
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl bg-navy/60 border border-white/10 text-cream font-syne text-base px-4 py-3 focus:outline-none focus:border-electric/60 transition resize-none"
              aria-label="Your answer"
            />

            <div className="flex items-center justify-between gap-3 mt-5">
              <button
                onClick={onSkip}
                disabled={modal.submitting}
                className="font-syne text-sm text-cream/50 hover:text-cream/80 transition disabled:opacity-40"
                aria-label="Skip this clue (counts as attempted, no Fangs awarded)"
              >
                Skip
              </button>
              <button
                onClick={onSubmit}
                disabled={modal.submitting || !modal.answer.trim()}
                className="btn-gold px-6 py-2.5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {modal.submitting ? "Checking..." : "Submit"}
              </button>
            </div>
          </>
        ) : (
          <div className="text-center animate-slide-up">
            {correct ? (
              <>
                <div
                  className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-3"
                  style={{ background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.45)" }}
                >
                  <Check size={32} weight="bold" className="text-green-400" aria-hidden="true" />
                </div>
                <p className="font-bebas text-3xl text-cream tracking-wider mb-1">CORRECT</p>
                {result.awarded > 0 && (
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-2xl text-gold">+{result.awarded}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div
                  className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-3"
                  style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)" }}
                >
                  <XIcon size={32} weight="bold" className="text-red-400" aria-hidden="true" />
                </div>
                <p className="font-bebas text-3xl text-cream tracking-wider mb-2">MISS</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 mb-1">
                  the answer was
                </p>
                <p className="font-syne text-cream text-base">{result.correctAnswer}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
