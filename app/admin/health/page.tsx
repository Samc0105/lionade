"use client";

/**
 * /admin/health — Systems Health. Admin only (gated by app/admin/layout.tsx,
 * enforced by GET /api/admin/health).
 *
 * Turns the manual schema-drift verification we run by hand into a live panel:
 * every feature's backend read path, green / amber / red at a glance. Refreshes
 * on load + every 60s. This is the "is it actually wired up on prod" page.
 */

import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { CheckCircle, WarningCircle, XCircle, Heartbeat, ArrowClockwise } from "@phosphor-icons/react";
import { CARD_BG } from "@/components/admin/shared";

type Status = "ok" | "degraded" | "down";
interface Check {
  feature: string;
  category: string;
  status: Status;
  detail: string;
}
interface HealthResponse {
  checks: Check[];
  summary: { total: number; ok: number; degraded: number; down: number };
}

const STATUS_META: Record<Status, { color: string; label: string; Icon: typeof CheckCircle }> = {
  ok: { color: "#34D399", label: "OK", Icon: CheckCircle },
  degraded: { color: "#FBBF24", label: "DEGRADED", Icon: WarningCircle },
  down: { color: "#F87171", label: "DOWN", Icon: XCircle },
};

export default function AdminHealthPage() {
  const { data, error, isValidating, mutate } = useSWR<HealthResponse>(
    "/api/admin/health",
    swrFetcher,
    { refreshInterval: 60_000 },
  );

  // Group checks by category, preserving first-seen order.
  const groups: { category: string; checks: Check[] }[] = [];
  for (const c of data?.checks ?? []) {
    let g = groups.find((x) => x.category === c.category);
    if (!g) {
      g = { category: c.category, checks: [] };
      groups.push(g);
    }
    g.checks.push(c);
  }

  const s = data?.summary;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-bebas text-4xl tracking-wider text-cream flex items-center gap-2">
          <Heartbeat size={30} weight="fill" className="text-gold" aria-hidden="true" />
          Systems Health
        </h1>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="inline-flex items-center gap-2 text-sm font-semibold text-cream/60 hover:text-cream px-3 py-2 rounded-xl border border-white/[0.08] hover:bg-white/[0.04] transition-all disabled:opacity-50"
        >
          <ArrowClockwise size={15} weight="bold" aria-hidden="true" className={isValidating ? "animate-spin" : ""} />
          Re-check
        </button>
      </div>
      <p className="text-sm text-cream/50 mb-6">
        Each feature&apos;s real backend read path, probed live. Red means a user tapping it would error.
      </p>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-6">
          Health check unavailable. You need an admin role to view this page.
        </div>
      )}

      {/* Summary banner */}
      {s && (
        <div
          className="rounded-2xl border p-4 mb-6 flex items-center gap-6"
          style={{
            background: CARD_BG,
            borderColor: s.down > 0 ? "#F8717140" : s.degraded > 0 ? "#FBBF2440" : "#34D39940",
          }}
        >
          <div className="font-bebas text-3xl tracking-wide" style={{ color: s.down > 0 ? "#F87171" : s.degraded > 0 ? "#FBBF24" : "#34D399" }}>
            {s.down > 0 ? `${s.down} DOWN` : s.degraded > 0 ? `${s.degraded} DEGRADED` : "ALL SYSTEMS GO"}
          </div>
          <div className="flex gap-4 text-sm text-cream/60">
            <span className="text-[#34D399]">{s.ok} ok</span>
            <span className="text-[#FBBF24]">{s.degraded} degraded</span>
            <span className="text-[#F87171]">{s.down} down</span>
            <span className="text-cream/35">of {s.total}</span>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {!data && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-white/[0.06] h-24 animate-pulse" style={{ background: CARD_BG }} />
          ))}
        </div>
      )}

      {/* Category groups */}
      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.category}>
            <h2 className="font-bebas text-xl tracking-wider text-cream/70 mb-2">{g.category}</h2>
            <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: CARD_BG }}>
              {g.checks.map((c, i) => {
                const meta = STATUS_META[c.status];
                return (
                  <div
                    key={c.feature}
                    className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-white/[0.05]" : ""}`}
                  >
                    <meta.Icon size={20} weight="fill" color={meta.color} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-cream">{c.feature}</p>
                      <p className="text-xs text-cream/40 truncate">{c.detail}</p>
                    </div>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                      style={{ color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}30` }}
                    >
                      {meta.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
