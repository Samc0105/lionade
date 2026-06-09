"use client";

/**
 * /admin — dashboard overview. Staff only (gated by app/admin/layout.tsx,
 * enforced by GET /api/admin/stats).
 *
 * Six stat cards: total users, signups today / this week, active 24h / 7d,
 * and total Fangs in circulation with the cashable/IAP ledger split.
 */

import useSWR from "swr";
import Image from "next/image";
import { swrFetcher } from "@/lib/api-client";
import { cdnUrl } from "@/lib/cdn";
import {
  UsersThree,
  UserPlus,
  CalendarBlank,
  Pulse,
  ChartLineUp,
} from "@phosphor-icons/react";

const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";

interface Stats {
  totalUsers: number;
  signupsToday: number;
  signupsWeek: number;
  activeToday: number;
  activeWeek: number;
  fangsTotal: number;
  fangsCashable: number;
  fangsIap: number;
}

function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string | null;
  sub?: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ background: CARD_BG, borderColor: `${accent}25` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: `${accent}15`, border: `1px solid ${accent}30` }}
        >
          {icon}
        </div>
        <span className="text-xs font-bold uppercase tracking-wider text-cream/50">
          {label}
        </span>
      </div>
      {value === null ? (
        <div className="h-9 w-24 bg-white/10 rounded animate-pulse" />
      ) : (
        <div className="font-bebas text-4xl tracking-wide text-cream">{value}</div>
      )}
      {sub && <div className="mt-1 text-xs text-cream/45">{sub}</div>}
    </div>
  );
}

export default function AdminOverviewPage() {
  const { data, error } = useSWR<Stats>("/api/admin/stats", swrFetcher, {
    refreshInterval: 60_000,
  });

  const fmt = (n: number | undefined) =>
    data === undefined ? null : (n ?? 0).toLocaleString();

  return (
    <div>
      <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1">Overview</h1>
      <p className="text-sm text-cream/50 mb-6">
        Live platform health. Numbers refresh every minute.
      </p>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-6">
          Stats are unavailable. If migration 057 has not been run yet, run it first.
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Total users"
          value={fmt(data?.totalUsers)}
          accent="#FFD700"
          icon={<UsersThree size={18} weight="fill" color="#FFD700" aria-hidden="true" />}
        />
        <StatCard
          label="Signups today"
          value={fmt(data?.signupsToday)}
          accent="#4A90D9"
          icon={<UserPlus size={18} weight="fill" color="#4A90D9" aria-hidden="true" />}
        />
        <StatCard
          label="Signups this week"
          value={fmt(data?.signupsWeek)}
          accent="#4A90D9"
          icon={<CalendarBlank size={18} weight="fill" color="#4A90D9" aria-hidden="true" />}
        />
        <StatCard
          label="Active in 24h"
          value={fmt(data?.activeToday)}
          accent="#34D399"
          icon={<Pulse size={18} weight="fill" color="#34D399" aria-hidden="true" />}
        />
        <StatCard
          label="Active this week"
          value={fmt(data?.activeWeek)}
          accent="#34D399"
          icon={<ChartLineUp size={18} weight="fill" color="#34D399" aria-hidden="true" />}
        />
        <StatCard
          label="Fangs in circulation"
          value={fmt(data?.fangsTotal)}
          sub={
            data
              ? `${data.fangsCashable.toLocaleString()} cashable · ${data.fangsIap.toLocaleString()} IAP`
              : undefined
          }
          accent="#A855F7"
          icon={
            <Image
              src={cdnUrl("/F.png")}
              alt=""
              width={18}
              height={18}
              aria-hidden="true"
            />
          }
        />
      </div>
    </div>
  );
}
