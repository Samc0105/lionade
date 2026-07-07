"use client";

// Zoom Reveal — image un-blurs over ~15s; guess early to score more; a wrong
// guess locks the round. Both players see the same images. Fuzzy match via the
// shared Levenshtein matcher. Settles via the shared /complete endpoint.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import type { MatchSettleProps } from "../useSettle";
import CountUp from "@/components/CountUp";
import FangBurst from "../FangBurst";
import Countdown from "../Countdown";
import { apiPost } from "@/lib/api-client";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

// answer + aliases are stripped from the in-flight payload by the sanitized match
// route; the server grades the guess and returns the answer in the /answer reveal.
interface Round {
  id: string;
  round_num: number;
  image_url: string;
  reveal_sec: number;
}

export default function ZoomScreen({
  loaded,
  selfId,
  settle,
}: { loaded: LoadedMatch; selfId: string } & Pick<MatchSettleProps, "settle" | "result">) {
  const matchId = loaded.match.id;
  const rounds = loaded.rounds as unknown as Round[];
  const opponentIds = loaded.match.team_a.includes(selfId) ? loaded.match.team_b : loaded.match.team_a;
  const { on, send } = useMatchChannel(matchId, selfId, opponentIds);
  // Settlement is owned by the SHELL (single useSettle hook). This screen only
  // triggers the rounds-exhausted settle; the shell renders the ResultCard.
  const settledRef = useRef(false);

  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [guess, setGuess] = useState("");
  const [locked, setLocked] = useState(false);
  // "error" = the /answer POST failed (network), distinct from an honest miss.
  const [feedback, setFeedback] = useState<"" | "correct" | "wrong" | "close" | "error">("");
  // Round 1's un-blur reveal clock is anchored to the server's match.starts_at
  // so both clients reveal the image in lockstep (no clock-skew head start).
  // Pre-migration rows have starts_at === null → fall back to local Date.now().
  const startsAtRaw = (loaded.match as { starts_at?: string | null }).starts_at ?? null;
  const startsAtMs = useMemo(() => {
    if (!startsAtRaw) return null;
    const t = new Date(startsAtRaw).getTime();
    return Number.isNaN(t) ? null : t;
  }, [startsAtRaw]);
  const [roundStart, setRoundStart] = useState(() =>
    startsAtMs !== null ? Math.max(startsAtMs, Date.now()) : Date.now(),
  );
  const [started, setStarted] = useState(false); // false until 3-2-1-GO clears
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [revealAnswer, setRevealAnswer] = useState("");
  const myScoreRef = useRef(0);

  const round = rounds[idx];
  const revealMs = (round?.reveal_sec ?? 15) * 1000;

  // The post-guess round-advance timeout is fire-and-forget; track it so an
  // unmount (navigate away, forfeit, settle) clears any pending advance and
  // can't setState on a dead component.
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
  }, []);

  useEffect(() => {
    const off = on(COMPETITIVE_EVENTS.PROGRESS, (p) => {
      if (typeof p.score === "number") setOppScore(p.score as number);
    });
    const offFin = on(COMPETITIVE_EVENTS.FINISHED, () => {});
    return () => { off(); offFin(); };
  }, [on]);

  // Hold the reveal at full blur until the pre-round countdown clears, so the
  // image isn't un-blurring during the 3-2-1-GO beat.
  const elapsed = started ? now - roundStart : 0;
  const blurAmount = Math.max(0, 28 * (1 - Math.min(1, elapsed / revealMs)));

  const advance = useCallback(() => {
    // Guard a stale deferred fire: bail if the match already finished while
    // this advance was queued.
    if (finished) return;
    setGuess(""); setLocked(false); setFeedback(""); setImgError(false); setRevealAnswer("");
    if (idx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: COMPETITIVE_EVENTS.FINISHED });
      return;
    }
    setIdx((i) => i + 1);
    setRoundStart(Date.now());
  }, [idx, rounds.length, send, finished]);

  const submitGuess = useCallback(async () => {
    if (!started || locked || !guess.trim() || finished || feedback) return;
    setLocked(true); // freeze input while the server grades the guess
    const { ok, data } = await apiPost<{ points: number; isCorrect: boolean; reveal: { answer: string } }>(
      `/api/competitive/match/${matchId}/answer`,
      { roundNum: round.round_num, guess, elapsedMs: elapsed },
    );
    if (ok && data?.isCorrect) {
      const pts = data.points;
      setScore((s) => { myScoreRef.current = s + pts; return s + pts; });
      setRevealAnswer(data.reveal.answer);
      setFeedback("correct");
      send({ type: COMPETITIVE_EVENTS.PROGRESS, score: myScoreRef.current });
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        advance();
      }, 1300);
    } else if (!ok) {
      // The /answer POST failed outright (network) — NOT a miss. Say so
      // honestly and still advance so both players stay in lockstep.
      setFeedback("error");
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        advance();
      }, 1500);
    } else {
      // Wrong (or alias/close not accepted) — Zoom locks the round on a miss.
      setFeedback("wrong");
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        advance();
      }, 1500);
    }
  }, [started, locked, guess, round, elapsed, send, advance, finished, feedback, matchId]);

  // round timeout (only once the round has actually started)
  useEffect(() => {
    if (!started || locked || finished || feedback) return;
    if (elapsed > revealMs + 2000) advance();
  }, [started, elapsed, revealMs, locked, finished, feedback, advance]);

  useEffect(() => {
    if (!finished || settledRef.current) return;
    settledRef.current = true;
    // Outcome is recomputed server-side from competitive_responses; no score map.
    settle();
  }, [finished, settle]);

  // The SHELL renders the lone ResultCard once its hook holds a result; this
  // screen shows only the brief settling interstitial until then.
  if (finished) return <SettlingMsg />;
  if (!round) return <p className="text-cream/60 text-center flex-1 flex items-center justify-center">No rounds loaded.</p>;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col w-full px-3 sm:px-6">
      {/* Pre-round 3-2-1-GO beat (first round only), anchored to the shared
          server starts_at so both players reveal in lockstep. */}
      {!started && (
        <Countdown
          accent="#00BFFF"
          startsAt={startsAtRaw}
          onDone={() => {
            setRoundStart(startsAtMs !== null ? Math.max(startsAtMs, Date.now()) : Date.now());
            setStarted(true);
          }}
        />
      )}
      <Hud idx={idx} total={rounds.length} score={score} oppScore={oppScore} accent="#00BFFF" />

      {/* Image dominates the center mass, filling available height */}
      <div className="flex-1 min-h-0 flex items-center justify-center w-full max-w-5xl mx-auto py-2">
        <div className="relative rounded-2xl overflow-hidden w-full h-full max-h-full bg-black/40"
          style={{ border: "1px solid rgba(0,191,255,0.25)" }}>
          {!imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={round.image_url}
              alt="Guess this"
              onError={() => setImgError(true)}
              className="w-full h-full object-cover transition-[filter] duration-200"
              style={{ filter: `blur(${blurAmount}px)`, transform: "scale(1.1)" }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <button onClick={advance} className="font-bebas tracking-wider text-cream/50 px-4 py-2 rounded-lg border border-cream/15">
                Image unavailable. Skip round
              </button>
            </div>
          )}
          {/* LOCKED IN stamp slams in the instant a guess is submitted (in-flight) */}
          {locked && !feedback && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="ca-stamp font-bebas text-4xl sm:text-6xl text-[#00BFFF] tracking-widest px-6 py-2 border-2 border-[#00BFFF]/70 rounded-xl">
                LOCKED IN
              </span>
            </div>
          )}
          {feedback === "correct" && (
            <div className="ca-correct absolute inset-0 flex items-center justify-center bg-[#50C878]/20 backdrop-blur-sm">
              <span className="ca-spring-in font-bebas text-4xl sm:text-6xl text-[#50C878] tracking-widest">{revealAnswer.toUpperCase()}</span>
            </div>
          )}
          {(feedback === "wrong" || feedback === "close") && (
            <div className="ca-wrong absolute inset-0 flex items-center justify-center bg-[#EF4444]/20 backdrop-blur-sm">
              <span className="font-bebas text-2xl sm:text-4xl text-[#EF4444] tracking-widest">
                {feedback === "close" ? "SO CLOSE" : "LOCKED OUT"}
              </span>
            </div>
          )}
          {feedback === "error" && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center bg-[#EF4444]/15 backdrop-blur-sm text-center px-4">
              <span className="font-bebas text-2xl sm:text-4xl text-red-300 tracking-widest">DIDN&apos;T COUNT</span>
              <span className="text-cream/60 text-xs sm:text-sm mt-1">Connection issue &middot; +0 this round</span>
            </div>
          )}
        </div>
      </div>

      {/* Guess controls pinned to the bottom edge */}
      <div className="flex-none w-full max-w-3xl mx-auto pt-2 pb-1">
        <div className="flex gap-3">
          <input
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitGuess()}
            disabled={locked || !!feedback}
            aria-label="Your guess"
            placeholder="What is this? Guess anytime..."
            className="flex-1 px-4 py-3.5 rounded-xl bg-cream/[0.04] border border-cream/10 text-cream/90 placeholder-cream/30 focus:border-[#00BFFF]/50 outline-none text-base"
          />
          <button
            onClick={submitGuess}
            disabled={locked || !guess.trim() || !!feedback}
            className="px-6 sm:px-8 py-3.5 rounded-xl font-bebas tracking-wider text-lg disabled:opacity-40"
            style={{ background: "linear-gradient(135deg, #00BFFF, #0090cc)", color: "#0a0a14" }}
          >
            GUESS
          </button>
        </div>
        <p className="text-cream/35 text-xs mt-2 text-center">Earlier correct guesses score more. One wrong guess locks the round.</p>
      </div>
    </div>
  );
}

// Shared top-edge HUD used by Zoom, Spectrum and Pin. flex-none so it pins to
// the top of the full-screen game shell; the play surface fills the rest.
//
// JUICE: the "you" score COUNTS UP (reused CountUp, reduced-motion-safe), the
// number pulses on every gain (.ca-score-pulse), and a Fang-coin burst fires
// from behind it. Score deltas are derived purely from props already in client
// state — no fetch, no secret read.
export function Hud({ idx, total, score, oppScore, accent }: { idx: number; total: number; score: number; oppScore: number; accent: string }) {
  const [burstKey, setBurstKey] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  const prevScore = useRef(score);

  useEffect(() => {
    if (score > prevScore.current) {
      setBurstKey((k) => k + 1);
      setPulseKey((k) => k + 1);
    }
    prevScore.current = score;
  }, [score]);

  return (
    <div className="flex-none flex items-center justify-between w-full max-w-5xl mx-auto mb-2">
      <div className="relative text-cream/70">
        <FangBurst burstKey={burstKey} />
        <span key={pulseKey} className={`inline-block font-bebas text-3xl sm:text-4xl ${pulseKey ? "ca-score-pulse" : ""}`} style={{ color: accent }}>
          <CountUp value={score} duration={500} />
        </span>
        <span className="text-cream/40 text-sm"> you</span>
      </div>
      <div className="font-bebas tracking-wider text-cream/50 text-sm">ROUND {idx + 1} / {total}</div>
      <div className="text-cream/70 text-right"><span className="font-bebas text-3xl sm:text-4xl text-cream/60"><CountUp value={oppScore} duration={500} /></span><span className="text-cream/40 text-sm"> rival</span></div>
    </div>
  );
}

export function SettlingMsg() {
  return <div className="flex-1 flex items-center justify-center text-center"><p className="font-bebas text-3xl text-cream/70 tracking-wider">SETTLING...</p></div>;
}
