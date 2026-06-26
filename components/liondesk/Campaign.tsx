"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, LockSimple, CheckCircle, CaretRight, Trophy } from "@phosphor-icons/react";
import type { Track } from "@/lib/helpdesk/types";
import { getTrack } from "@/lib/helpdesk/tracks";
import { shiftsForTrack } from "@/lib/liondesk/shifts";
import { getAllRecords, recordShift, gradeFor, PASS_SCORE, type ShiftRecord } from "@/lib/liondesk/campaignProgress";
import { apiPost } from "@/lib/api-client";
import LionDesk, { type ShiftResult } from "@/components/liondesk/LionDesk";

const gradeColor = (g: string) => (g === "S" || g === "A" ? "#2BBE6B" : g === "B" ? "#4A90D9" : g === "C" ? "#F59E0B" : "#EF4444");

export default function Campaign({ track, initialShiftId }: { track: Track; initialShiftId?: string }) {
  const def = getTrack(track);
  const shifts = useMemo(() => shiftsForTrack(track), [track]);

  const [mounted, setMounted] = useState(false);
  const [records, setRecords] = useState<Record<string, ShiftRecord>>({});
  // A deep-link (e.g. the Shift of the Day) can open straight into a shift.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (initialShiftId && shiftsForTrack(track).some((s) => s.id === initialShiftId) ? initialShiftId : null),
  );
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setMounted(true);
    setRecords(getAllRecords());
  }, []);

  const cleared = mounted ? shifts.filter((s) => (records[s.id]?.bestScore ?? 0) >= PASS_SCORE).length : 0;
  const rankIdx = def ? Math.min(cleared, def.ranks.length - 1) : 0;
  const rankTitle = def?.ranks[rankIdx]?.title ?? "";
  const accent = shifts[0]?.accent ?? "#4A90D9";

  const selected = selectedId ? shifts.find((s) => s.id === selectedId) ?? null : null;

  function handleComplete(r: ShiftResult) {
    recordShift(r.shiftId, r.score, r.csat);
    setRecords(getAllRecords());
    // Best-effort server sync: records the completion and grants Fangs ONCE,
    // server-side (the route owns the reward ceiling). Safe no-op if the
    // migration isn't applied yet (route returns { pending: true }). Local
    // progress stays the display source of truth either way.
    apiPost("/api/techhub/shifts/complete", { shiftId: r.shiftId, score: r.score, csat: r.csat }).catch(() => {});
  }

  /* ── playing a shift ── */
  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedId(null)} className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/55 hover:text-electric transition-colors">
          <ArrowLeft size={14} weight="bold" aria-hidden="true" /> {def?.name ?? "campaign"} shifts
        </button>
        <LionDesk
          key={`${selected.id}-${runKey}`}
          shift={selected}
          onComplete={handleComplete}
          onExit={() => setSelectedId(null)}
          onReplay={() => setRunKey((k) => k + 1)}
        />
      </div>
    );
  }

  /* ── shift list ── */
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/50">your rank</p>
          <p className="font-bebas text-2xl text-cream tracking-wide leading-none mt-0.5">{mounted ? rankTitle : " "}</p>
        </div>
        <div className="text-right">
          <p className="font-bebas text-2xl tabular-nums leading-none" style={{ color: accent }}>{mounted ? `${cleared}/${shifts.length}` : `${shifts.length}`}</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45 mt-0.5">shifts cleared</p>
        </div>
      </div>

      <ul className="space-y-2">
        {shifts.map((s) => {
          const rec = records[s.id];
          const done = mounted && (rec?.bestScore ?? 0) >= PASS_SCORE;
          const unlocked = mounted ? s.order <= cleared : s.order === 0;
          const grade = rec ? gradeFor(rec.bestScore) : null;
          const need = s.order - cleared;
          return (
            <li key={s.id}>
              <button
                disabled={!unlocked}
                onClick={() => unlocked && setSelectedId(s.id)}
                className={`w-full text-left rounded-xl border p-4 transition-colors ${unlocked ? "hover:bg-white/[0.04] hover:border-white/20 cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
                style={{ borderColor: done ? "#2BBE6B40" : "rgba(255,255,255,0.08)", background: done ? "rgba(43,190,107,0.05)" : "rgba(255,255,255,0.02)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    {done ? <CheckCircle size={22} weight="fill" color="#2BBE6B" aria-hidden="true" />
                      : unlocked ? <CaretRight size={18} weight="bold" color={accent} aria-hidden="true" />
                      : <LockSimple size={18} weight="fill" color="#6B7280" aria-hidden="true" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45">{s.rank}</p>
                    <p className="font-syne font-semibold text-sm text-cream mt-0.5 truncate">{s.name}</p>
                    {!unlocked && <p className="font-mono text-[10px] text-cream/45 mt-0.5">clear {need} more shift{need === 1 ? "" : "s"} to unlock</p>}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {done && grade ? (
                      <>
                        <p className="font-bebas text-2xl leading-none" style={{ color: gradeColor(grade) }}>{grade}</p>
                        <p className="font-mono text-[9px] text-cream/45 mt-0.5">best</p>
                      </>
                    ) : unlocked ? (
                      <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border" style={{ color: accent, borderColor: `${accent}55` }}>Start</span>
                    ) : null}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {def && cleared >= shifts.length && shifts.length > 0 && (
        <div className="rounded-xl border border-gold/25 bg-gold/[0.05] p-4 flex items-center gap-3">
          <Trophy size={22} weight="fill" color="#FFD700" aria-hidden="true" />
          <p className="text-cream/80 text-sm">You cleared every shift on the board so far. More shifts are on the way up the ladder to {def.ranks[def.ranks.length - 1].title}.</p>
        </div>
      )}
    </div>
  );
}
