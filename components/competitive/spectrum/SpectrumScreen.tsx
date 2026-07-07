"use client";

// Spectrum Slider — drag a slider mapped to [min,max] to estimate a value.
// Closest to the true value scores more (distance-based partial credit). Both
// players answer the same prompts. Settles via the shared /complete endpoint.

import { useState, useEffect, useRef, useCallback } from "react";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import type { MatchSettleProps } from "../useSettle";
import Countdown from "../Countdown";
import { Hud, SettlingMsg } from "../zoom/ZoomScreen";
import { apiPost } from "@/lib/api-client";
import { COMPETITIVE_EVENTS } from "@/lib/competitive/channels";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

// true_value is stripped from the in-flight payload by the sanitized match route
// and only arrives in the /answer reveal after the player locks in.
interface Round {
  id: string;
  round_num: number;
  prompt: string;
  min_value: number;
  max_value: number;
  unit: string | null;
}

function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return r.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function SpectrumScreen({
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
  const [pct, setPct] = useState(50);
  const [revealed, setRevealed] = useState(false);
  const [lastPts, setLastPts] = useState(0);
  const [trueValue, setTrueValue] = useState<number | null>(null);
  // True when the /answer POST failed: the round is ungraded (server never
  // scored the estimate), so we show an honest "didn't count" note instead of
  // a silent blank reveal. The round still advances so both players stay in
  // lockstep — a live match can't pause for one side's network blip.
  const [submitFailed, setSubmitFailed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [started, setStarted] = useState(false); // false until 3-2-1-GO clears
  const myScoreRef = useRef(0);

  // The post-lock-in round-advance timeout is fire-and-forget; track it so an
  // unmount (navigate away, forfeit, settle) clears any pending advance and
  // can't setState on a dead component.
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anchor the match START (the pre-round 3-2-1-GO) to the server's
  // match.starts_at so both players begin round 1 together. Spectrum has no
  // per-round timer, so the anchor only gates when the first lock-in opens.
  const startsAtRaw = (loaded.match as { starts_at?: string | null }).starts_at ?? null;

  const round = rounds[idx];

  useEffect(() => {
    const off = on(COMPETITIVE_EVENTS.PROGRESS, (p) => {
      if (typeof p.score === "number") setOppScore(p.score as number);
    });
    return () => off();
  }, [on]);

  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
  }, []);

  const value = round ? round.min_value + (pct / 100) * (round.max_value - round.min_value) : 0;

  const advance = useCallback(() => {
    // Guard a stale deferred fire: bail if the match already finished while
    // this advance was queued.
    if (finished) return;
    setRevealed(false); setPct(50); setLastPts(0); setTrueValue(null); setSubmitFailed(false);
    if (idx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: COMPETITIVE_EVENTS.FINISHED });
      return;
    }
    setIdx((i) => i + 1);
  }, [idx, rounds.length, send, finished]);

  const lockIn = useCallback(async () => {
    if (!started || revealed || finished) return;
    setRevealed(true); // lock the slider immediately; the server scores the guess
    const { ok, data } = await apiPost<{ points: number; reveal: { true_value: number } }>(
      `/api/competitive/match/${matchId}/answer`,
      { roundNum: round.round_num, guess: value },
    );
    const pts = ok && data ? data.points : 0;
    if (ok && data) setTrueValue(data.reveal.true_value);
    else setSubmitFailed(true);
    setLastPts(pts);
    setScore((s) => { myScoreRef.current = s + pts; return s + pts; });
    send({ type: COMPETITIVE_EVENTS.PROGRESS, score: myScoreRef.current });
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      advance();
    }, 1800);
  }, [started, revealed, finished, value, round, send, advance, matchId]);

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

  const truePct =
    trueValue === null
      ? 0
      : ((trueValue - round.min_value) / (round.max_value - round.min_value)) * 100;

  // Result coloring by closeness — derived purely from values already in client
  // state after the reveal (no secret read). 0 = bullseye, 1 = whole-range off.
  const closeness = (() => {
    if (trueValue === null) return { color: "#50C878", label: "" };
    const span = Math.abs(round.max_value - round.min_value) || 1;
    const errFrac = Math.min(1, Math.abs(value - trueValue) / span);
    if (errFrac < 0.05) return { color: "#FFD700", label: "BULLSEYE" };
    if (errFrac < 0.15) return { color: "#50C878", label: "VERY CLOSE" };
    if (errFrac < 0.35) return { color: "#00BFFF", label: "CLOSE" };
    return { color: "#EF4444", label: "OFF THE MARK" };
  })();

  return (
    <div className="relative flex-1 min-h-0 flex flex-col w-full px-3 sm:px-6">
      {/* Pre-round 3-2-1-GO beat (first round only), anchored to the shared
          server starts_at so both players start together. */}
      {!started && (
        <Countdown accent="#A855F7" startsAt={startsAtRaw} onDone={() => setStarted(true)} />
      )}
      <Hud idx={idx} total={rounds.length} score={score} oppScore={oppScore} accent="#A855F7" />

      {/* Prompt + slider command the center mass */}
      <div className="flex-1 min-h-0 flex flex-col justify-center w-full max-w-3xl mx-auto py-4">
        <p className="text-cream/90 text-2xl sm:text-3xl lg:text-4xl leading-snug text-center mb-10 sm:mb-14 font-medium">{round.prompt}</p>

        <div className="relative px-1">
          <input
            type="range" min={0} max={100} step={0.1} value={pct}
            disabled={revealed}
            aria-label="Estimate slider"
            aria-valuetext={`${fmt(value)}${round.unit ? ` ${round.unit}` : ""}`}
            onChange={(e) => setPct(parseFloat(e.target.value))}
            className="w-full accent-[#A855F7] h-3"
          />
          {/* true-value marker springs in on lock-in */}
          {revealed && trueValue !== null && (
            <div className="ca-spring-in absolute -top-1 h-5 w-0.5 bg-[#50C878] shadow-[0_0_8px_rgba(80,200,120,0.7)]" style={{ left: `${Math.max(0, Math.min(100, truePct))}%` }} />
          )}
        </div>

        <div className="flex justify-between text-cream/40 text-xs sm:text-sm mt-1.5">
          <span>{fmt(round.min_value)}{round.unit ? ` ${round.unit}` : ""}</span>
          <span>{fmt(round.max_value)}{round.unit ? ` ${round.unit}` : ""}</span>
        </div>

        <div className="text-center mt-8 sm:mt-10">
          <p className="text-cream/40 text-[10px] uppercase tracking-widest">Your estimate</p>
          <p
            className="font-bebas text-5xl sm:text-7xl text-[#A855F7] transition-transform duration-150 ease-out"
            style={{ transform: revealed ? "scale(1)" : `scale(${1 + Math.min(0.06, Math.abs(pct - 50) / 900)})` }}
          >
            {fmt(value)}<span className="text-cream/40 text-xl sm:text-2xl ml-1.5">{round.unit}</span>
          </p>
          {revealed && trueValue !== null && (
            <p className="ca-pop-in text-sm sm:text-base mt-3" style={{ color: closeness.color }}>
              True value: <span className="font-bebas text-lg sm:text-xl text-[#50C878]">{fmt(trueValue)} {round.unit}</span>
              {" "}&middot; <span style={{ color: closeness.color }}>{closeness.label}</span> &middot; +{lastPts} pts
            </p>
          )}
          {revealed && submitFailed && (
            <p role="alert" className="ca-pop-in text-sm sm:text-base mt-3 text-red-300">
              Connection issue &middot; that round didn&apos;t count &middot; +0 pts
            </p>
          )}
        </div>
      </div>

      {/* LOCK IN pinned to the bottom edge */}
      <div className="flex-none w-full max-w-2xl mx-auto pb-1">
        {!revealed && (
          <button onClick={lockIn} className="w-full font-bebas tracking-wider text-xl py-4 rounded-xl"
            style={{ background: "linear-gradient(135deg, #A855F7, #8b3fd6)", color: "#0a0a14" }}>
            LOCK IN
          </button>
        )}
      </div>
    </div>
  );
}
