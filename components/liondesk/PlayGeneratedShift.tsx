"use client";

import { useEffect, useState } from "react";
import LionDesk from "@/components/liondesk/LionDesk";
import { generateShift, dateSeed } from "@/lib/liondesk/generate";
import { decodeCombo } from "@/lib/liondesk/combocode";
import { recordShiftResult } from "@/lib/liondesk/stats";
import AchievementBanner from "@/components/liondesk/AchievementBanner";
import type { Shift } from "@/lib/liondesk/types";

interface Props {
  daily?: boolean;
  chaos?: boolean;
  comboCode?: string;
}

// Plays a procedurally generated shift. Modes:
// - comboCode: a shared combo (decode + draw); rerolls to a fresh draw of the
//   same recipe.
// - daily / daily+chaos: date-seeded, stable for everyone today (no reroll).
// - chaos: 3-4 stacked modifiers, rerolls.
// - default: a random Surprise Shift, rerolls.
// Generated after mount so the RNG / date never run during SSR.
export default function PlayGeneratedShift({ daily = false, chaos = false, comboCode }: Props) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [newAch, setNewAch] = useState<string[]>([]);

  function makeShift(): Shift {
    if (comboCode) {
      const c = decodeCombo(comboCode);
      if (c) return generateShift({ track: c.track, count: c.count, modifierIds: c.modifierIds, name: "Shared Combo" });
    }
    if (chaos && daily) return generateShift({ seed: dateSeed(), chaos: true, name: "Daily Chaos" });
    if (chaos) return generateShift({ chaos: true, name: "Chaos Shift" });
    if (daily) return generateShift({ seed: dateSeed(), name: "Daily Combo" });
    return generateShift({ name: "Surprise Shift" });
  }

  // daily and daily-chaos are the fixed shared challenges; everything else rerolls.
  const rerollable = !daily;

  useEffect(() => {
    setShift(makeShift());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, chaos, comboCode]);

  function reroll() {
    setShift(makeShift());
    setRunKey((k) => k + 1);
  }

  if (!shift) {
    return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-10 text-center text-cream/40 font-mono text-sm">shuffling the queue...</div>;
  }

  return (
    <div className="space-y-3">
      <AchievementBanner ids={newAch} />
      {shift.modifiers && shift.modifiers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">modifiers</span>
          {shift.modifiers.map((m) => (
            <span key={m.id} title={m.desc} className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.15)", color: "#C9A2F2", border: "1px solid rgba(168,85,247,0.35)" }}>{m.label}</span>
          ))}
        </div>
      )}
      <LionDesk key={`${shift.id}-${runKey}`} shift={shift} onComplete={(r) => setNewAch(recordShiftResult(shift, r))} onReplay={rerollable ? reroll : undefined} />
      <p className="font-mono text-[10px] text-cream/40">
        {daily
          ? "Today's challenge is the same for everyone and rerolls at midnight."
          : "A fresh draw every time. Hit “Run it back” for a new combo."}
      </p>
    </div>
  );
}
