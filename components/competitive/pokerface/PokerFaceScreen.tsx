"use client";

// Poker Face — bounded "Challenge Stakes" bluff duel.
//
// COPY RULE (design-copywriter + legal): this surface uses "Challenge Stake",
// "Stake", "Prize", "Present", "Believe", "Doubt" only. It NEVER says bet, pot,
// wager-as-noun, all-in, rake, or casino. The stake is bounded: opening
// [10/25/50] plus an optional single raise (capped server-side).
//
// Hands alternate presenter/caller by hand parity (even = team_a[0] presents).
// The presenter privately picks truth or a self-authored lie, sets a stake,
// and presents the claim. The caller responds Believe or Doubt; reveal + the
// zero-sum prize transfer happen server-side. The match settles at the end via
// the shared /complete endpoint (which folds in the accumulated prize pot).

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import { useSettle } from "../useSettle";
import ResultCard from "../ResultCard";
import CountUp from "@/components/CountUp";
import { apiPost } from "@/lib/api-client";
import { cdnUrl } from "@/lib/cdn";
import { OPENING_STAKES, MAX_RAISE_MULTIPLIER } from "@/lib/competitive/pokerface-wager";
import { drawRandomCard, type PokerFaceCard } from "@/lib/competitive/pokerface-cards";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

const TOTAL_HANDS = 6;

interface Reveal {
  cardWord: string;
  cardFact: string;
  claimShown: string;
  presenterToldTruth: boolean;
  call: "believe" | "doubt";
  winner: "presenter" | "caller";
  amount: number;
}

export default function PokerFaceScreen({ loaded, selfId }: { loaded: LoadedMatch; selfId: string }) {
  const matchId = loaded.match.id;
  const { on, send } = useMatchChannel(matchId, selfId);
  const { settle, result } = useSettle(matchId);

  const [handNum, setHandNum] = useState(0);
  const [phase, setPhase] = useState<"present" | "waitingCall" | "call" | "reveal" | "settling">("present");
  const [card, setCard] = useState<PokerFaceCard>(() => drawRandomCard());
  const [mode, setMode] = useState<"truth" | "lie">("truth");
  const [lieText, setLieText] = useState("");
  const [openingStake, setOpeningStake] = useState<number>(OPENING_STAKES[0]);
  const [raise, setRaise] = useState(0);
  const [presentedClaim, setPresentedClaim] = useState("");
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [callerPending, setCallerPending] = useState<{ claim: string; word: string; stake: number } | null>(null);
  const finishedRef = useRef(false);

  // For 1v1, presenter alternates by hand parity.
  const isPresenter = handNum % 2 === 0
    ? loaded.match.team_a.includes(selfId)
    : loaded.match.team_b.includes(selfId);

  // ── realtime: presenter notifies caller a claim is ready; caller notifies reveal ──
  useEffect(() => {
    const offHand = on(COMPETITIVE_EVENTS.HAND, (p) => {
      const kind = String(p.kind ?? "");
      if (kind === "presented" && !isPresenter) {
        setCallerPending({
          claim: String(p.claim ?? ""),
          word: String(p.word ?? ""),
          stake: Number(p.stake ?? 0),
        });
        setPhase("call");
      } else if (kind === "resolved") {
        // both sides advance after a reveal
        const nextHand = Number(p.nextHand ?? handNum + 1);
        setReveal(p.reveal as Reveal);
        setPhase("reveal");
        setTimeout(() => goToHand(nextHand), 3200);
      }
    });
    return () => offHand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, isPresenter, handNum]);

  const goToHand = useCallback((next: number) => {
    if (next >= TOTAL_HANDS) {
      setPhase("settling");
      if (!finishedRef.current) {
        finishedRef.current = true;
        // /complete derives the Poker Face winner server-side from the
        // accumulated per-hand prize pot (fang_delta), written by /pokerface/call.
        // The client sends no score map.
        settle();
      }
      return;
    }
    setHandNum(next);
    setCard(drawRandomCard());
    setMode("truth"); setLieText(""); setOpeningStake(OPENING_STAKES[0]); setRaise(0);
    setReveal(null); setCallerPending(null);
    setPhase(next % 2 === 0
      ? (loaded.match.team_a.includes(selfId) ? "present" : "waitingCall")
      : (loaded.match.team_b.includes(selfId) ? "present" : "waitingCall"));
  }, [loaded.match, selfId, settle]);

  const present = useCallback(async () => {
    const claim = mode === "truth" ? card.fact : (lieText.trim() || "(no claim)");
    setPresentedClaim(claim);
    const { ok, data } = await apiPost<{ claimShown: string; totalStake: number; openingStake: number; raise: number; cardWord: string }>(
      "/api/competitive/pokerface/present",
      { matchId, handNum, isTruth: mode === "truth", claimText: claim, openingStake, raise },
    );
    if (ok && data) {
      setPhase("waitingCall");
      send({ type: COMPETITIVE_EVENTS.HAND, kind: "presented", claim: data.claimShown, word: data.cardWord, stake: data.totalStake });
    }
  }, [mode, card, lieText, openingStake, raise, matchId, handNum, send]);

  const respond = useCallback(async (call: "believe" | "doubt") => {
    const { ok, data } = await apiPost<Reveal>(
      "/api/competitive/pokerface/call",
      { matchId, handNum, call },
    );
    if (ok && data) {
      setReveal(data);
      setPhase("reveal");
      send({ type: COMPETITIVE_EVENTS.HAND, kind: "resolved", reveal: data, nextHand: handNum + 1 });
      setTimeout(() => goToHand(handNum + 1), 3200);
    }
  }, [matchId, handNum, send, goToHand]);

  if (result) return <ResultCard result={result} selfId={selfId} teamA={loaded.match.team_a} />;
  if (phase === "settling") return <div className="flex-1 flex items-center justify-center text-center"><p className="font-bebas text-3xl text-cream/70 tracking-wider">SETTLING STAKES...</p></div>;

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full px-3 sm:px-6">
      {/* header pinned to the top edge */}
      <div className="flex-none flex items-center justify-between w-full max-w-2xl mx-auto mb-4">
        <span className="font-bebas tracking-wider text-cream/50 text-sm">HAND {handNum + 1} / {TOTAL_HANDS}</span>
        <span className="font-bebas tracking-wider text-[#FFD700] text-sm">{isPresenter ? "YOU PRESENT" : "YOU READ"}</span>
      </div>

      {/* Active panel commands the center mass */}
      <div className="flex-1 min-h-0 flex flex-col justify-center w-full max-w-2xl mx-auto py-2 overflow-y-auto">
      {/* reveal overlay */}
      {phase === "reveal" && reveal && (
        <RevealCard reveal={reveal} selfId={selfId} isPresenter={isPresenter} />
      )}

      {/* PRESENT phase (presenter only) */}
      {phase === "present" && isPresenter && (
        <div className="ca-pop-in rounded-2xl p-6 sm:p-8" style={{ background: "linear-gradient(135deg, #1a1400 0%, #060c18 100%)", border: "1px solid rgba(255,215,0,0.25)" }}>
          <p className="text-cream/40 text-[10px] uppercase tracking-widest mb-1">Your secret card</p>
          <p className="font-bebas text-3xl text-[#FFD700] mb-1">{card.word}</p>
          <p className="text-cream/60 text-sm mb-5 italic">True fact: {card.fact}</p>

          <div className="flex gap-2 mb-4">
            <button onClick={() => setMode("truth")}
              className={`flex-1 py-2.5 rounded-xl font-bebas tracking-wider ${mode === "truth" ? "bg-[#50C878] text-[#0a0a14]" : "border border-cream/10 text-cream/60"}`}>
              PRESENT THE TRUTH
            </button>
            <button onClick={() => setMode("lie")}
              className={`flex-1 py-2.5 rounded-xl font-bebas tracking-wider ${mode === "lie" ? "bg-[#EF4444] text-[#0a0a14]" : "border border-cream/10 text-cream/60"}`}>
              INVENT A BLUFF
            </button>
          </div>

          {mode === "lie" && (
            <textarea
              value={lieText}
              onChange={(e) => setLieText(e.target.value)}
              placeholder="Write a believable false claim about this card..."
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-cream/[0.04] border border-cream/10 text-cream/90 placeholder-cream/30 focus:border-[#EF4444]/50 outline-none mb-4 resize-none"
            />
          )}

          {/* Challenge Stake selector */}
          <p className="text-cream/40 text-[10px] uppercase tracking-widest mb-2 flex items-center gap-1">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3 h-3 object-contain" /> Challenge Stake
          </p>
          <div className="flex gap-2 mb-3">
            {OPENING_STAKES.map((s) => (
              <button key={s} onClick={() => { setOpeningStake(s); setRaise(0); }}
                className={`flex-1 py-2 rounded-lg font-bebas tracking-wider ${openingStake === s ? "bg-[#FFD700] text-[#1a1400]" : "border border-cream/10 text-cream/60"}`}>
                {s}
              </button>
            ))}
          </div>

          {/* optional single bounded raise */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-cream/50 text-xs">Optional raise (up to {openingStake * MAX_RAISE_MULTIPLIER})</span>
            <span className="text-cream/70 font-bebas">+{raise}</span>
          </div>
          <input type="range" min={0} max={openingStake * MAX_RAISE_MULTIPLIER} step={5} value={raise}
            aria-label="Optional raise to your Challenge Stake"
            onChange={(e) => setRaise(parseInt(e.target.value, 10))} className="w-full accent-[#FFD700] mb-1" />
          <p className="text-cream/35 text-[11px] mb-5">
            Total Stake: <span className="text-cream/70 font-bebas">{openingStake + raise}</span> Fangs each. Prize goes to the winner of the read.
          </p>

          <button onClick={present} disabled={mode === "lie" && !lieText.trim()}
            className="w-full font-bebas tracking-wider text-lg py-3 rounded-xl disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #FFD700, #d4af00)", color: "#1a1400" }}>
            PRESENT TO RIVAL
          </button>
        </div>
      )}

      {/* WAITING for caller */}
      {phase === "waitingCall" && isPresenter && (
        <div className="rounded-2xl p-8 text-center" style={{ background: "linear-gradient(135deg, #1a1400 0%, #060c18 100%)", border: "1px solid rgba(255,215,0,0.2)" }}>
          <p className="font-bebas text-2xl text-[#FFD700] mb-2">CLAIM PRESENTED</p>
          <p className="text-cream/70 italic mb-3">&ldquo;{presentedClaim}&rdquo;</p>
          <p className="text-cream/40 text-sm">Waiting for your rival to call Believe or Doubt...</p>
          <span className="inline-block w-2 h-2 rounded-full bg-[#FFD700] animate-pulse mt-3" />
        </div>
      )}

      {/* waiting to present (caller, before presenter has presented) */}
      {phase === "waitingCall" && !isPresenter && (
        <div className="rounded-2xl p-8 text-center" style={{ background: "linear-gradient(135deg, #0c1020 0%, #060c18 100%)", border: "1px solid rgba(168,85,247,0.2)" }}>
          <p className="font-bebas text-2xl text-cream/60 mb-2">RIVAL IS PRESENTING</p>
          <p className="text-cream/40 text-sm">Wait for their claim, then read them.</p>
          <span className="inline-block w-2 h-2 rounded-full bg-[#A855F7] animate-pulse mt-3" />
        </div>
      )}

      {/* CALL phase (caller responds) */}
      {phase === "call" && !isPresenter && callerPending && (
        <div className="ca-pop-in rounded-2xl p-6" style={{ background: "linear-gradient(135deg, #150a1f 0%, #060c18 100%)", border: "1px solid rgba(168,85,247,0.25)" }}>
          <p className="text-cream/40 text-[10px] uppercase tracking-widest mb-1">Their card</p>
          <p className="font-bebas text-2xl text-[#A855F7] mb-3">{callerPending.word}</p>
          <p className="text-cream/40 text-[10px] uppercase tracking-widest mb-1">Their claim</p>
          <p className="text-cream/90 text-lg italic mb-4">&ldquo;{callerPending.claim}&rdquo;</p>
          <p className="text-cream/40 text-xs mb-5 flex items-center gap-1">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3 h-3 object-contain" /> Stake on the line: {callerPending.stake} Fangs
          </p>
          <div className="flex gap-3">
            <button onClick={() => respond("believe")} className="ca-spring-in flex-1 py-3.5 rounded-xl font-bebas tracking-wider text-lg active:scale-95"
              style={{ background: "linear-gradient(135deg, #50C878, #3da862)", color: "#0a0a14", animationDelay: "60ms" }}>
              BELIEVE
            </button>
            <button onClick={() => respond("doubt")} className="ca-spring-in flex-1 py-3.5 rounded-xl font-bebas tracking-wider text-lg active:scale-95"
              style={{ background: "linear-gradient(135deg, #EF4444, #c43333)", color: "#fff", animationDelay: "140ms" }}>
              DOUBT
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// The reveal is the showpiece of Poker Face: a suspense beat, then a 3D card
// flip from a face-down "?" to the truth/bluff face, the verdict headline slams
// in, and the prize Fangs count up. All driven by the `reveal` already in client
// state. Self-gates on reduced motion (flip + slam collapse to an instant show).
function RevealCard({ reveal, selfId, isPresenter }: { reveal: Reveal; selfId: string; isPresenter: boolean }) {
  const reduce = useReducedMotion();
  const [flipped, setFlipped] = useState(reduce); // reduced motion -> already flipped
  const youWon = (reveal.winner === "presenter" && isPresenter) || (reveal.winner === "caller" && !isPresenter);
  const color = youWon ? "#FFD700" : "#EF4444";
  const claimColor = reveal.presenterToldTruth ? "#50C878" : "#EF4444";

  // Suspense beat: hold the card face-down ~650ms, then flip to the truth.
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setFlipped(true), 650);
    return () => clearTimeout(t);
  }, [reduce]);

  return (
    <div className="rounded-2xl p-6 text-center mb-4" style={{ background: "linear-gradient(135deg, #0c1020 0%, #060c18 100%)", border: `1px solid ${color}40` }}>
      {/* 3D flip card */}
      <div className="mx-auto mb-4" style={{ width: 132, height: 92, perspective: 900 }}>
        <motion.div
          className="relative w-full h-full"
          style={{ transformStyle: "preserve-3d" }}
          initial={false}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* face-down */}
          <div className="ca-card-flip-face absolute inset-0 rounded-xl flex items-center justify-center font-bebas text-4xl"
            style={{ background: "linear-gradient(135deg, #1a1400, #060c18)", border: "1px solid rgba(255,215,0,0.3)", color: "#FFD70066" }}>
            ?
          </div>
          {/* revealed */}
          <div className="ca-card-flip-face absolute inset-0 rounded-xl flex items-center justify-center font-bebas text-2xl tracking-wider"
            style={{ background: `linear-gradient(135deg, ${claimColor}22, #060c18)`, border: `1px solid ${claimColor}66`, color: claimColor, transform: "rotateY(180deg)" }}>
            {reveal.presenterToldTruth ? "TRUE" : "BLUFF"}
          </div>
        </motion.div>
      </div>

      {flipped && (
        <>
          <p className="ca-slam font-bebas text-3xl tracking-widest mb-2" style={{ color }}>{youWon ? "YOU WIN THE PRIZE" : "RIVAL TAKES THE PRIZE"}</p>
          <p className="text-cream/70 mb-1">The claim was <span className="font-bold" style={{ color: claimColor }}>{reveal.presenterToldTruth ? "TRUE" : "A BLUFF"}</span></p>
          <p className="text-cream/50 text-sm mb-1">Real fact: {reveal.cardFact}</p>
          <p className="text-cream/40 text-xs flex items-center gap-1 justify-center mt-2">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3 h-3 object-contain" /> Prize: <CountUp value={reveal.amount} duration={900} /> Fangs
          </p>
        </>
      )}
    </div>
  );
}
