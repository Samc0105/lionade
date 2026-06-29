"use client";

import { Sword, Trophy } from "@phosphor-icons/react";
import { gradeFor } from "@/lib/liondesk/scoring";
import type { ChallengeVs } from "@/lib/liondesk/combocode";

// Idea 29: Beat my desk async challenge.
//
// A shared shift link can embed the sharer's own score and grade (combocode's
// optional vs field). When such a link is opened, the recipient plays the exact
// same shift and this surface frames it as a head to head:
//
//   mine null  → an incoming challenge banner, shown before the recipient
//                finishes. It is rendered above the desk (outside the focus
//                trapped report), so it stays keyboard and screen reader
//                reachable the same way the Share this shift control does.
//   mine set   → the you versus them comparison on completion: both scores and
//                grades side by side, with a win, tie, or loss verdict.
//
// Pure display. It reads the sharer's result out of the link (no localStorage, no
// server) and the recipient's result out of the engine, so there is no
// flash-of-zero to guard and nothing is ever granted. The entrance uses the
// shared animate-slide-up keyframe, already disabled under prefers-reduced-motion
// in globals.css (transform and opacity only, so no layout shift).

const GRADE_LETTERS = new Set(["S", "A", "B", "C", "D"]);

// Same grade to color mapping the shift report uses, so a grade reads the same
// everywhere on the desk.
function gradeColor(g: string): string {
  return g === "S" || g === "A" ? "#2BBE6B" : g === "B" ? "#4A90D9" : g === "C" ? "#F59E0B" : "#EF4444";
}

// Trust an embedded grade only when it is a real letter; otherwise derive it from
// the score with the single grade ladder, so a hand edited link still renders a
// sane grade.
function safeGrade(g: string, score: number): string {
  return GRADE_LETTERS.has(g) ? g : gradeFor(score);
}

interface MyResult {
  score: number;
  grade: string;
}

function ScoreTile({ who, score, grade, accent }: { who: string; score: number; grade: string; accent: string }) {
  return (
    <div className="flex-1 rounded-lg border p-2.5 text-center" style={{ borderColor: `${accent}40`, background: `${accent}0f` }}>
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45">{who}</p>
      <p className="font-bebas text-3xl leading-none mt-1" style={{ color: accent }}>{grade}</p>
      <p className="font-mono text-[11px] tabular-nums text-cream/70 mt-1">Score {score}</p>
    </div>
  );
}

export default function ChallengeResult({ theirs, mine }: { theirs: ChallengeVs; mine: MyResult | null }) {
  const theirGrade = safeGrade(theirs.grade, theirs.score);

  // Incoming challenge, before the recipient has finished. A reachable heads up
  // of the bar to beat.
  if (!mine) {
    return (
      <div role="status" className="animate-slide-up rounded-xl border border-[#A855F7]/40 bg-[#A855F7]/[0.08] p-3 flex items-center gap-3">
        <Sword size={22} weight="fill" color="#C9A2F2" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C9A2F2]">You have been challenged</p>
          <p className="text-cream text-sm font-semibold">
            Beat their score of {theirs.score} (grade {theirGrade}) on this exact shift.
          </p>
        </div>
      </div>
    );
  }

  const myGrade = safeGrade(mine.grade, mine.score);
  const won = mine.score > theirs.score;
  const tie = mine.score === theirs.score;
  const diff = Math.abs(mine.score - theirs.score);
  const outcome = tie ? "Tie" : won ? "You won" : "They won";
  const outcomeColor = tie ? "#FFD700" : won ? "#2BBE6B" : "#EF4444";
  const detail = tie
    ? "Dead even. A perfect tie on the same shift."
    : won
    ? `You came out ahead by ${diff}.`
    : `They were ahead by ${diff}. Run it back and take the rematch.`;
  // One clean announcement for screen readers; the visual tiles below are hidden
  // from assistive tech so the scores are not read out twice.
  const announce = `Challenge result, ${outcome.toLowerCase()}. Your score ${mine.score}, grade ${myGrade}. Their score ${theirs.score}, grade ${theirGrade}. ${detail}`;

  return (
    <div role="status" className="animate-slide-up rounded-xl border p-3.5" style={{ borderColor: `${outcomeColor}55`, background: `${outcomeColor}0f` }}>
      <p className="sr-only">{announce}</p>
      <div aria-hidden="true">
        <div className="flex items-center gap-2 mb-2.5">
          <Trophy size={18} weight="fill" color={outcomeColor} aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">Beat my desk</span>
          <span
            className="ml-auto font-bebas text-base tracking-wide leading-none px-2 py-0.5 rounded"
            style={{ color: outcomeColor, background: `${outcomeColor}1f`, border: `1px solid ${outcomeColor}55` }}
          >
            {outcome}
          </span>
        </div>
        <div className="flex items-stretch gap-2">
          <ScoreTile who="You" score={mine.score} grade={myGrade} accent={gradeColor(myGrade)} />
          <div className="flex items-center font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40">vs</div>
          <ScoreTile who="Them" score={theirs.score} grade={theirGrade} accent={gradeColor(theirGrade)} />
        </div>
        <p className="text-cream/70 text-[11px] leading-relaxed mt-2.5">{detail}</p>
      </div>
    </div>
  );
}
