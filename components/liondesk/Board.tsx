"use client";

import { useEffect, useState } from "react";
import { ChartBar, CalendarBlank, Lightning, Trophy, Crown, Medal } from "@phosphor-icons/react";
import { apiGet } from "@/lib/api-client";
import { DAILY_MODES, type DailyMode } from "@/lib/liondesk/dailyLog";

// The Board: a server-ranked leaderboard for the three shared deterministic
// modes. It ranks GRADES and SCORES, never Fangs (the economy stays
// server-authoritative and is granted nowhere on the client). The server owns
// the period, the clamp, and the grade; this component only reads and displays.
//
// While the held leaderboard migration is unapplied the route answers with
// liveYet:false, so we render a clean "goes live soon" preview rather than a
// misleading empty board. Before mount (and while loading) we show skeleton rows
// so there is never a flash of zero.

interface BoardEntry {
  rank: number;
  name: string;
  score: number;
  grade: string;
  you: boolean;
}
interface BoardResponse {
  liveYet: boolean;
  mode: string;
  periodKey: string;
  entries: BoardEntry[];
  you: BoardEntry | null;
}

const MODE_META: Record<DailyMode, { label: string; blurb: string; color: string; icon: typeof CalendarBlank }> = {
  combo: { label: "Daily Combo", blurb: "Today's shared mix of tickets and mutators.", color: "#FFD700", icon: CalendarBlank },
  chaos: { label: "Daily Chaos", blurb: "Today's brutal stacked gauntlet, same for everyone.", color: "#F87171", icon: Lightning },
  weekly: { label: "Weekly Challenge", blurb: "This week's shared challenge, ranked all week.", color: "#C9A2F2", icon: Trophy },
};

// Grade accents drawn from the interstellar palette (gold, green, electric,
// purple, muted). Higher grade, warmer accent.
const GRADE_COLOR: Record<string, string> = {
  S: "#FFD700",
  A: "#2BBE6B",
  B: "#4A90D9",
  C: "#C9A2F2",
  D: "#9DB4E0",
};
function gradeColor(grade: string): string {
  return GRADE_COLOR[grade] ?? "#9DB4E0";
}

// Seasons: each mode runs as a sequence of periods (a day for the dailies, a week
// for the weekly). "current" is the live period you can still post into; previous
// is the season archive, the final standings of the day or week just gone. The
// server owns both period keys (seed aligned), so switching only changes which
// bucket we read; it never writes and never grants Fangs.
type Period = "current" | "previous";
const PERIODS: { id: Period; label: string }[] = [
  { id: "current", label: "This period" },
  { id: "previous", label: "Previous" },
];

export default function Board() {
  // The board only exists on the server (and only once the held migration is
  // live). Read after mount so SSR and first paint never show a misleading board;
  // the "mounted" flag guards every dynamic read.
  const [mounted, setMounted] = useState(false);
  const [mode, setMode] = useState<DailyMode>("combo");
  const [period, setPeriod] = useState<Period>("current");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<BoardResponse | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    setLoading(true);
    apiGet<BoardResponse>(`/api/techhub/leaderboard?mode=${mode}&period=${period}&limit=10`).then((res) => {
      if (cancelled) return;
      // Any non-ok result (not signed in, route error) degrades to the preview
      // state, exactly like a held migration would. Never an error flash.
      setData(res.ok && res.data ? res.data : { liveYet: false, mode, periodKey: "", entries: [], you: null });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, mode, period]);

  const meta = MODE_META[mode];
  // For period aware copy: the dailies run a day at a time, the weekly a week.
  const periodNoun = mode === "weekly" ? "week" : "day";
  const showSkeleton = !mounted || loading;
  const liveYet = !!data?.liveYet;
  const entries = data?.entries ?? [];
  const you = data?.you ?? null;

  return (
    <div
      className="rounded-2xl p-4 sm:p-5"
      style={{
        background: "linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(74,144,217,0.07) 55%, rgba(12,16,32,0.95) 100%)",
        border: "1px solid rgba(168,85,247,0.26)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ChartBar size={18} weight="fill" color="#C9A2F2" aria-hidden="true" />
          <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">THE BOARD</h2>
        </div>
        <span className="font-mono text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded bg-[#A855F7]/15 text-[#C9A2F2] border border-[#A855F7]/30">
          ranked
        </span>
      </div>
      <p className="text-cream/55 text-[11px] mt-1.5">
        Top players on the three shared modes, ranked by grade. Same shift for everyone, so the ladder is fair.
      </p>

      {/* Mode tabs */}
      <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Leaderboard mode">
        {DAILY_MODES.map((m) => {
          const mm = MODE_META[m.id];
          const Icon = mm.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={active}
              onClick={() => setMode(m.id)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 min-h-[36px] font-mono text-[10px] uppercase tracking-[0.12em] motion-safe:transition-colors"
              style={{
                background: active ? `${mm.color}18` : "rgba(255,255,255,0.03)",
                border: `1px solid ${active ? `${mm.color}55` : "rgba(255,255,255,0.08)"}`,
                color: active ? mm.color : "rgba(245,239,224,0.5)",
              }}
            >
              <Icon size={13} weight="fill" aria-hidden="true" />
              {mm.label}
            </button>
          );
        })}
      </div>

      <p className="text-cream/45 text-[11px] mt-2.5">{meta.blurb}</p>

      {/* Period switcher: the live period vs the previous period's archive (a
          season). The server owns the period key, so this only picks which bucket
          to read. */}
      <div className="mt-2.5 flex items-center gap-1.5" role="tablist" aria-label="Leaderboard period">
        {PERIODS.map((p) => {
          const active = period === p.id;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              onClick={() => setPeriod(p.id)}
              className="rounded-lg px-2.5 py-1 min-h-[32px] font-mono text-[9px] uppercase tracking-[0.14em] motion-safe:transition-colors"
              style={{
                background: active ? "rgba(168,85,247,0.16)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${active ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.08)"}`,
                color: active ? "#C9A2F2" : "rgba(245,239,224,0.5)",
              }}
            >
              {p.label}
            </button>
          );
        })}
        {period === "previous" && (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-cream/35 ml-1">
            season archive
          </span>
        )}
      </div>

      {/* Body */}
      <div className="mt-3">
        {showSkeleton ? (
          <ul className="space-y-2" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl bg-white/[0.025] border border-white/[0.06] p-2.5">
                <div className="w-6 h-5 rounded bg-white/[0.06] motion-safe:animate-pulse" />
                <div className="flex-1 h-3.5 rounded bg-white/[0.06] motion-safe:animate-pulse" />
                <div className="w-7 h-6 rounded bg-white/[0.06] motion-safe:animate-pulse" />
              </li>
            ))}
          </ul>
        ) : !liveYet ? (
          // Held migration (or signed-out): a clear, honest preview state.
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px dashed rgba(201,162,242,0.3)" }}
          >
            <Crown size={26} weight="fill" color="#C9A2F2" aria-hidden="true" className="mx-auto" />
            <p className="font-bebas text-lg text-cream tracking-wide mt-2 leading-none">LEADERBOARD GOES LIVE SOON</p>
            <p className="text-cream/55 text-[12px] mt-2 leading-relaxed max-w-sm mx-auto">
              Ranked play for the daily and weekly shared modes is on the way. Keep clearing today's board and your best
              grade will be ready to climb the ladder the moment it opens.
            </p>
          </div>
        ) : entries.length === 0 ? (
          // Live, but the bucket is empty: no one posted this period, or nobody
          // posted the previous one before it closed.
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <Medal size={24} weight="fill" color={meta.color} aria-hidden="true" className="mx-auto" />
            {period === "previous" ? (
              <>
                <p className="font-bebas text-base text-cream tracking-wide mt-2 leading-none">THE ARCHIVE IS EMPTY</p>
                <p className="text-cream/55 text-[12px] mt-1.5">No grades were posted for the previous {periodNoun}.</p>
              </>
            ) : (
              <>
                <p className="font-bebas text-base text-cream tracking-wide mt-2 leading-none">NO GRADES POSTED YET</p>
                <p className="text-cream/55 text-[12px] mt-1.5">Clear {meta.label} to take the top spot. Be the first.</p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* The player's own best for the loaded period, surfaced up top so it
                is always visible whether or not they sit in the top N. */}
            {you && (
              <YourBest
                entry={you}
                accent={meta.color}
                label={period === "current" ? "your best this period" : "your best, archived"}
              />
            )}
            <ul className="space-y-2">
              {entries.map((e) => (
                <BoardRow key={e.rank} entry={e} accent={meta.color} />
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Honesty note: ranking only, no economy. */}
      <p className="font-mono text-[10px] text-cream/35 leading-relaxed mt-3">
        The Board ranks grades and scores only. It grants no Fangs (the economy stays server side and tamper proof).
      </p>
    </div>
  );
}

function BoardRow({ entry, accent }: { entry: BoardEntry; accent: string }) {
  const gc = gradeColor(entry.grade);
  const isTop = entry.rank === 1;
  return (
    <li
      className="flex items-center gap-3 rounded-xl p-2.5"
      style={{
        background: entry.you ? `${accent}12` : "rgba(255,255,255,0.025)",
        border: `1px solid ${entry.you ? `${accent}44` : "rgba(255,255,255,0.07)"}`,
      }}
    >
      {/* Rank */}
      <span className="flex-shrink-0 w-7 inline-flex items-center justify-center">
        {isTop ? (
          <Crown size={16} weight="fill" color="#FFD700" aria-label="Rank 1" />
        ) : (
          <span className="font-mono text-[12px] tabular-nums text-cream/55">{entry.rank}</span>
        )}
      </span>

      {/* Name */}
      <span className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-cream/90 text-[13px] font-semibold truncate">{entry.name}</span>
        {entry.you && (
          <span
            className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ background: `${accent}1f`, color: accent, border: `1px solid ${accent}44` }}
          >
            you
          </span>
        )}
      </span>

      {/* Grade + score */}
      <span className="flex-shrink-0 flex items-center gap-2">
        <span className="font-mono text-[11px] tabular-nums text-cream/55">{entry.score}</span>
        <span
          className="font-bebas text-base leading-none px-2 py-0.5 rounded tabular-nums"
          style={{ background: `${gc}1f`, color: gc, border: `1px solid ${gc}44` }}
        >
          {entry.grade}
        </span>
      </span>
    </li>
  );
}

// A compact callout for the signed-in player's own best in the loaded period.
// Distinct from a ranked row so it reads as "here is where you stand," and shown
// whether or not the player sits in the visible top N. The score and grade are
// the server's values, only rendered in the live branch (after mount and load),
// so there is never a flash of zero.
function YourBest({ entry, accent, label }: { entry: BoardEntry; accent: string; label: string }) {
  const gc = gradeColor(entry.grade);
  return (
    <div
      className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{ background: `${accent}14`, border: `1px solid ${accent}40` }}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] flex-shrink-0" style={{ color: accent }}>
        {label}
      </span>
      <span className="ml-auto flex items-center gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-cream/45">
          rank <span className="tabular-nums text-cream/70">{entry.rank}</span>
        </span>
        <span className="font-mono text-[11px] tabular-nums text-cream/55">{entry.score}</span>
        <span
          className="font-bebas text-base leading-none px-2 py-0.5 rounded tabular-nums"
          style={{ background: `${gc}1f`, color: gc, border: `1px solid ${gc}44` }}
        >
          {entry.grade}
        </span>
      </span>
    </div>
  );
}
