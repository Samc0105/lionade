"use client";

import { useEffect, useState } from "react";
import LionDesk from "@/components/liondesk/LionDesk";
import { generateShift, dateSeed } from "@/lib/liondesk/generate";
import type { Shift } from "@/lib/liondesk/types";

// Plays a procedurally generated shift. Daily = a date-seeded combo everyone
// shares (stable for the day); otherwise a fresh random "Surprise Shift" that
// re-rolls on replay. Generated after mount so the RNG / date never run during
// SSR (no hydration mismatch).
export default function PlayGeneratedShift({ daily = false }: { daily?: boolean }) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setShift(generateShift(daily ? { seed: dateSeed(), name: "Daily Combo" } : { name: "Surprise Shift" }));
  }, [daily]);

  function reroll() {
    setShift(generateShift({ name: "Surprise Shift" }));
    setRunKey((k) => k + 1);
  }

  if (!shift) {
    return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-10 text-center text-cream/40 font-mono text-sm">shuffling the queue...</div>;
  }

  return (
    <div className="space-y-3">
      {shift.modifiers && shift.modifiers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">modifiers</span>
          {shift.modifiers.map((m) => (
            <span key={m.id} title={m.desc} className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.15)", color: "#C9A2F2", border: "1px solid rgba(168,85,247,0.35)" }}>{m.label}</span>
          ))}
        </div>
      )}
      <LionDesk key={`${shift.id}-${runKey}`} shift={shift} onReplay={daily ? undefined : reroll} />
      <p className="font-mono text-[10px] text-cream/40">
        {daily
          ? "Today's combo is the same for everyone and rerolls at midnight."
          : "A fresh draw of tickets and random modifiers every time. Hit “Run it back” for a brand-new combo."}
      </p>
    </div>
  );
}
