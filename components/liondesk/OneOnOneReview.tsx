"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChatsCircle, Target, CheckCircle, XCircle, ArrowRight, Lightning } from "@phosphor-icons/react";
import {
  advanceOneOnOneIfDue,
  getOneOnOneStatus,
  type OneOnOneStatus,
} from "@/lib/liondesk/managerReview";

// Manager 1:1 surface. A periodic performance review delivered by a recurring
// mentor: a line tied to the current saga chapter, one or two goals pulled from
// the player's weakest concepts, and a review of how the previous goals turned
// out. Local only and cosmetic. It grants no Fangs (the economy stays server
// authoritative) and is mount guarded so it never flashes a row of zeros.

const GOLD = "#FFD700";
const PURPLE = "#A855F7";
const GREEN = "#2BBE6B";
const CRIMSON = "#EF4444";

function pctText(p: number | null): string {
  return p === null ? "No data yet" : `${p}%`;
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

export default function OneOnOneReview() {
  // localStorage only exists on the client. Advance the cadence and read the
  // status after mount so SSR and the first paint never show a misleading zero.
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<OneOnOneStatus | null>(null);

  useEffect(() => {
    setMounted(true);
    advanceOneOnOneIfDue();
    setStatus(getOneOnOneStatus());
  }, []);

  if (!mounted || !status) return <Skeleton />;
  if (!status.unlocked) return <Locked status={status} />;

  const s = status.session!;

  return (
    <div className="space-y-5">
      {/* Manager note, tied to the current saga chapter */}
      <div
        className="relative overflow-hidden rounded-2xl p-4 sm:p-5"
        style={{
          background: "linear-gradient(135deg, rgba(255,215,0,0.10) 0%, rgba(168,85,247,0.08) 55%, rgba(12,16,32,0.95) 100%)",
          border: "1px solid rgba(255,215,0,0.28)",
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-bebas text-xl"
            style={{ background: `${s.manager.accent}22`, color: s.manager.accent, border: `1px solid ${s.manager.accent}55` }}
            aria-hidden="true"
          >
            {s.manager.initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[14px] font-semibold leading-none text-cream">{s.manager.name}</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45">{s.manager.role}</span>
              <span className="ml-auto whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45">
                1:1 no. {s.index}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-cream/80">{s.headline}</p>
            <div
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5"
              style={{ background: "rgba(255,215,0,0.10)", border: "1px solid rgba(255,215,0,0.3)" }}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD }}>
                chapter {s.chapterLevel}: {s.chapterTitle}
              </span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-cream/55">{s.unlocked}</p>
          </div>
        </div>
      </div>

      {/* Review of the goals set at the previous 1:1 */}
      {s.prior.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">since your last 1:1</p>
          <ul className="space-y-2">
            {s.prior.map((g) => (
              <li
                key={g.concept}
                className="rounded-xl border bg-white/[0.02] p-3"
                style={{ borderColor: g.achieved ? "rgba(43,190,107,0.3)" : "rgba(239,68,68,0.28)" }}
              >
                <div className="flex items-center gap-2">
                  {g.achieved ? (
                    <CheckCircle size={16} weight="fill" color={GREEN} aria-hidden="true" />
                  ) : (
                    <XCircle size={16} weight="fill" color={CRIMSON} aria-hidden="true" />
                  )}
                  <span className="text-[13px] font-semibold text-cream/90">{g.label}</span>
                  <span
                    className="ml-auto rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                    style={{
                      background: g.achieved ? "rgba(43,190,107,0.16)" : "rgba(239,68,68,0.16)",
                      color: g.achieved ? "#9AE6B4" : "#F8B4B4",
                    }}
                  >
                    {g.achieved ? "met" : "keep going"}
                  </span>
                </div>
                <p className="mt-1.5 font-mono text-[10px] text-cream/45">
                  Target was {g.targetPct}%.{" "}
                  {g.endPct === null
                    ? "No data recorded yet."
                    : `Went from ${pctText(g.startPct)} to ${g.endPct}% (${signed(g.delta)}).`}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Goals for this stretch, with live progress */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Target size={14} weight="fill" color={PURPLE} aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">your goals for this stretch</p>
        </div>

        {s.goals.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-[12px] leading-relaxed text-cream/55">
            Finish a few more shifts so we can pin down concrete goals. Once your mastery has data, the next 1:1 will target your weak spots.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {s.goals.map((g) => {
              const color = g.achieved ? GREEN : GOLD;
              const width = g.currentPct ?? 0;
              return (
                <li
                  key={g.concept}
                  className="rounded-xl border bg-white/[0.02] p-3"
                  style={{ borderColor: g.achieved ? "rgba(43,190,107,0.3)" : "rgba(168,85,247,0.26)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-cream/90">{g.label}</span>
                    {g.achieved && (
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
                        style={{ background: "rgba(43,190,107,0.16)", color: "#9AE6B4" }}
                      >
                        met
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color }}>
                      {pctText(g.currentPct)} / {g.targetPct}%
                    </span>
                  </div>

                  <div
                    className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
                    role="img"
                    aria-label={`${g.label}: ${pctText(g.currentPct)} toward a ${g.targetPct}% goal`}
                  >
                    <div
                      className="h-full rounded-full ease-out motion-safe:transition-[width] motion-safe:duration-700"
                      style={{ width: `${width}%`, background: color }}
                    />
                    <div
                      className="absolute bottom-0 top-0 w-px"
                      style={{ left: `${g.targetPct}%`, background: "rgba(255,255,255,0.5)" }}
                      aria-hidden="true"
                    />
                  </div>

                  <p className="mt-1.5 font-mono text-[10px] text-cream/45">
                    {g.currentPct === null
                      ? `Goal: reach ${g.targetPct}% mastery. Drill this concept to start tracking.`
                      : `Started at ${pctText(g.startPct)}, now ${g.currentPct}% (${signed(g.delta)}). Goal is ${g.targetPct}%.`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Manager sign off, teasing the next promotion */}
      <p className="text-[12px] leading-relaxed text-cream/65">{s.signoff}</p>

      {/* Act on the goals: jump straight to the Weak Spots drill */}
      <Link
        href="/learn/techhub/review"
        className="group flex items-center gap-3 rounded-2xl border border-electric/25 bg-electric/[0.05] p-3 transition-colors hover:bg-electric/[0.09]"
      >
        <Lightning size={20} weight="fill" color={PURPLE} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: PURPLE }}>drill your weak spots</p>
          <p className="mt-0.5 text-[11px] text-cream/55">Practice the concepts behind your goals, then check back here to see them move.</p>
        </div>
        <ArrowRight size={14} weight="bold" color={PURPLE} aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
      </Link>

      <p className="font-mono text-[10px] leading-relaxed text-cream/40">
        Your 1:1 is a personal coaching note stored on this device. It tracks nothing toward your balance (the economy stays server authoritative). The next review lands after {status.shiftsUntilNext} more cleared {status.shiftsUntilNext === 1 ? "shift" : "shifts"}.
      </p>
    </div>
  );
}

// Locked state, shown before the first 1:1 comes due.
function Locked({ status }: { status: OneOnOneStatus }) {
  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{
          background: "linear-gradient(135deg, rgba(255,215,0,0.09) 0%, rgba(12,16,32,0.95) 100%)",
          border: "1px solid rgba(255,215,0,0.24)",
        }}
      >
        <div className="flex items-center gap-2">
          <ChatsCircle size={18} weight="fill" color={GOLD} aria-hidden="true" />
          <h2 className="font-bebas text-xl leading-none tracking-wider text-cream">YOUR FIRST 1:1</h2>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-cream/60">
          Clear {status.cadence} shifts to sit down with your manager for a performance review. You have cleared{" "}
          {status.shiftsCleared} so far, {status.shiftsUntilNext} to go. Your manager will set goals from the concepts you miss most, then track them with you over time.
        </p>
        <Link
          href="/learn/techhub"
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-[#04060c]"
          style={{ background: "linear-gradient(135deg,#FFD700,#A855F7)" }}
        >
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
          Head to TechHub and take a shift
        </Link>
      </div>
    </div>
  );
}

// Skeleton placeholders so the surface has shape before mount, never a row of zeros.
function Skeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.06] text-cream/30">…</div>
          <div className="flex-1">
            <div className="h-3 w-32 rounded bg-white/[0.06]" />
            <div className="mt-2 h-3 w-48 rounded bg-white/[0.05]" />
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="h-3 w-40 rounded bg-white/[0.06]" />
            <div className="mt-2 h-2 w-full rounded-full bg-white/[0.06]" />
          </div>
        ))}
      </div>
      <p className="font-mono text-[10px] text-cream/40">Loading your 1:1...</p>
    </div>
  );
}
