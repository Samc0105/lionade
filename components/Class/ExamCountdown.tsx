"use client";

import { useEffect, useState } from "react";

/**
 * Big "exam in 12d 04:33:09" banner for the class detail page.
 *
 * - The accent color is read from the CSS var `--accent` so the parent can
 *   pass `style={{ "--accent": cls.color }}` and we don't have to thread the
 *   color through props purely for styling.
 * - When the exam is < 24h away we switch to a red "FINAL HOURS" treatment.
 * - When the date has already passed we render a muted "exam day was N days
 *   ago" line — never null, because the parent only mounts this when there
 *   IS a target date.
 * - Respects prefers-reduced-motion: the only motion is the per-second tick
 *   on the digits, which is informational, not decorative.
 */

interface Props {
  examTitle: string | null;
  /** YYYY-MM-DD (local). */
  targetDate: string | null;
  /** Short class label used in the headline. Falls back to "class". */
  classShortCode?: string | null;
}

interface Parts {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function partsUntil(target: Date): Parts {
  const totalMs = target.getTime() - Date.now();
  const safe = Math.max(0, totalMs);
  const days = Math.floor(safe / 86_400_000);
  const hours = Math.floor((safe % 86_400_000) / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  return { totalMs, days, hours, minutes, seconds };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export default function ExamCountdown({
  examTitle,
  targetDate,
  classShortCode,
}: Props) {
  // Parent decides whether to render us at all when targetDate is null,
  // but we double-defend: render nothing rather than show a broken state.
  if (!targetDate) return null;

  const target = new Date(targetDate + "T00:00:00");
  const [parts, setParts] = useState<Parts>(() => partsUntil(target));

  useEffect(() => {
    const id = window.setInterval(() => {
      setParts(partsUntil(target));
    }, 1000);
    return () => window.clearInterval(id);
  }, [targetDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPast = parts.totalMs <= 0;
  const isFinalHours = !isPast && parts.totalMs < 24 * 3_600_000;

  const accent = isFinalHours
    ? "#EF4444"
    : "var(--accent, #4A90D9)";
  const subjectLabel = classShortCode || "class";

  // ── Past exam — muted footer line, no live ticker.
  if (isPast) {
    const daysAgo = Math.ceil(Math.abs(parts.totalMs) / 86_400_000);
    return (
      <section
        aria-label="Exam countdown"
        className="relative mb-8 rounded-[16px] overflow-hidden border border-white/[0.06] bg-white/[0.015] p-5 sm:p-6"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 mb-1">
          {examTitle || "Last exam"}
        </p>
        <p className="text-[14px] text-cream/55">
          Exam day was {daysAgo === 1 ? "1 day" : `${daysAgo} days`} ago.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Exam countdown"
      className="relative mb-8 rounded-[16px] overflow-hidden border p-5 sm:p-6"
      style={{
        borderColor: isFinalHours ? "#EF444466" : "color-mix(in srgb, var(--accent, #4A90D9) 35%, transparent)",
        background: isFinalHours
          ? "linear-gradient(135deg, rgba(239,68,68,0.16) 0%, rgba(239,68,68,0.04) 60%, transparent 100%)"
          : "linear-gradient(135deg, color-mix(in srgb, var(--accent, #4A90D9) 18%, transparent) 0%, color-mix(in srgb, var(--accent, #4A90D9) 4%, transparent) 60%, transparent 100%)",
      }}
    >
      {isFinalHours && (
        <p
          className="font-mono text-[10px] uppercase tracking-[0.32em] mb-2"
          style={{ color: accent }}
        >
          Final hours
        </p>
      )}
      <p className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.28em] text-cream/65 mb-3">
        Your {subjectLabel} exam is in
      </p>

      <div className="flex flex-wrap items-end gap-x-4 sm:gap-x-6 gap-y-2">
        {!isFinalHours && parts.days > 0 && (
          <CountUnit value={parts.days} label="days" accent={accent} />
        )}
        <CountUnit value={parts.hours} label="hrs" accent={accent} pad />
        <CountUnit value={parts.minutes} label="min" accent={accent} pad />
        <CountUnit value={parts.seconds} label="sec" accent={accent} pad />
      </div>

      {examTitle && (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45">
          {examTitle}
        </p>
      )}
    </section>
  );
}

function CountUnit({
  value, label, accent, pad: shouldPad = false,
}: {
  value: number;
  label: string;
  accent: string;
  pad?: boolean;
}) {
  return (
    <div className="flex flex-col items-start leading-none">
      <span
        className="font-bebas text-[44px] sm:text-[60px] tabular-nums tracking-wider"
        style={{ color: accent }}
      >
        {shouldPad ? pad(value) : value}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/55 mt-0.5">
        {label}
      </span>
    </div>
  );
}
