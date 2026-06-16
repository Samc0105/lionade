"use client";

/**
 * /admin/security — Application-layer (L7) security operations dashboard.
 * ADMIN ONLY.
 *
 * This is the SOC view of what the app itself sees: live presence, request
 * volume from the telemetry rollup, classified threat actors from the
 * security_events feed, and the manual IP denylist. It is an honest L7 view:
 * volumetric network DDoS never reaches this app (Vercel's edge absorbs it),
 * so the scope banner up top links out to Vercel's Firewall / Observability
 * for the network-layer picture rather than pretending to show it here.
 *
 * Client-side rules this file honors:
 *   - The role gate is enforced by app/admin/layout.tsx; we self-gate here too.
 *     The SWR keys are null for non-admins so no /api/admin/security fetch ever
 *     fires from a support account, and support staff see an access note rather
 *     than a broken dashboard.
 *   - No flash of zero: every numeric tile reads `null` until its source SWR
 *     query resolves, which renders the StatCard skeleton instead of "0".
 *   - Near-real-time: overview polls every 5s, threats + denylist every 10s,
 *     all with keepPreviousData so the UI never blanks on a refresh.
 *   - Mutations (block / unblock) surface via toasts; inline red banners are
 *     reserved for SWR load failures.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { swrFetcher, apiPost } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { toastSuccess, toastError } from "@/lib/toast";
import ConfirmModal from "@/components/ConfirmModal";
import { CARD_BG, AdminModalShell } from "@/components/admin/shared";
import {
  ShieldWarning,
  Pulse,
  Users,
  ChartLineUp,
  ShieldSlash,
  Prohibit,
  ArrowSquareOut,
  Plus,
  WarningOctagon,
  Bug,
  MagnifyingGlass,
  Robot,
  Key,
} from "@phosphor-icons/react";

// ─────────────────────────────────────────────────────────────────────────
// Response shapes — these mirror the admin security API exactly.
// ─────────────────────────────────────────────────────────────────────────

interface TrafficPoint {
  minute: string;
  total: number;
  blocked: number;
}

interface OverviewResponse {
  activeNow: number;
  recentlyActive: number;
  inSession: number;
  traffic: TrafficPoint[];
  totals: { requests: number; blocked: number; denylistHits: number };
}

type ThreatCategory =
  | "scanner"
  | "bruteforce"
  | "enumeration"
  | "bot"
  | "flood"
  | "denylist_hit"
  | "auth_failure"
  | "admin_probe";

interface ThreatRow {
  ip: string;
  score: number;
  categories: string[];
  events: number;
  lastSeen: string;
  samplePath?: string;
  sampleUa?: string;
  blocked: boolean;
}

interface ThreatsResponse {
  threats: ThreatRow[];
}

interface DenylistEntry {
  ip: string;
  reason: string | null;
  blockedByName: string | null;
  active: boolean;
  createdAt: string | null;
  expiresAt: string | null;
}

interface DenylistResponse {
  entries: DenylistEntry[];
}

// ─────────────────────────────────────────────────────────────────────────
// Accents + small helpers.
// ─────────────────────────────────────────────────────────────────────────

const GOLD = "#FFD700";
const ELECTRIC = "#4A90D9";
const EMERALD = "#34D399";
const RED = "#F87171";

const fieldInput =
  "w-full mb-3 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-red-400/40";
const fieldLabel =
  "block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1";

function fmtDateTime(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "—";
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────
// StatCard — matches app/admin/page.tsx markup exactly.
// ─────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
// Threat classification chips.
// ─────────────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<
  ThreatCategory,
  { label: string; color: string; icon: React.ReactNode }
> = {
  scanner: {
    label: "scanner",
    color: RED,
    icon: <MagnifyingGlass size={11} weight="bold" aria-hidden="true" />,
  },
  bruteforce: {
    label: "brute force",
    color: RED,
    icon: <Key size={11} weight="bold" aria-hidden="true" />,
  },
  enumeration: {
    label: "enumeration",
    color: "#FB923C",
    icon: <MagnifyingGlass size={11} weight="bold" aria-hidden="true" />,
  },
  admin_probe: {
    label: "admin probe",
    color: "#FB923C",
    icon: <WarningOctagon size={11} weight="bold" aria-hidden="true" />,
  },
  auth_failure: {
    label: "auth failure",
    color: GOLD,
    icon: <Key size={11} weight="bold" aria-hidden="true" />,
  },
  flood: {
    label: "flood",
    color: GOLD,
    icon: <Pulse size={11} weight="bold" aria-hidden="true" />,
  },
  bot: {
    label: "bot",
    color: ELECTRIC,
    icon: <Robot size={11} weight="bold" aria-hidden="true" />,
  },
  denylist_hit: {
    label: "denylist hit",
    color: ELECTRIC,
    icon: <Prohibit size={11} weight="bold" aria-hidden="true" />,
  },
};

function ClassificationChip({ category }: { category: string }) {
  const meta = (CATEGORY_META as Record<string, (typeof CATEGORY_META)[ThreatCategory]>)[
    category
  ];
  const color = meta?.color ?? "#9CA3AF";
  const label = meta?.label ?? category;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: `${color}18`, color, border: `1px solid ${color}33` }}
    >
      {meta?.icon}
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hand-rolled traffic timeseries. No chart library — same flex/height/delay
// technique as app/dashboard/page.tsx. Pads the last 60 minutes so the axis is
// continuous even when only a few minutes have rollup data.
// ─────────────────────────────────────────────────────────────────────────

function TrafficChart({ points }: { points: TrafficPoint[] | undefined }) {
  // Build a continuous 60-minute window keyed by the minute bucket so gaps in
  // the rollup render as empty (zero) bars rather than collapsing the axis.
  const series = useMemo<TrafficPoint[]>(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const byMinute = new Map<string, TrafficPoint>();
    for (const p of points ?? []) {
      const k = new Date(p.minute);
      k.setSeconds(0, 0);
      byMinute.set(k.toISOString(), p);
    }
    const out: TrafficPoint[] = [];
    for (let i = 59; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 60_000);
      const iso = t.toISOString();
      const hit = byMinute.get(iso);
      out.push(hit ?? { minute: iso, total: 0, blocked: 0 });
    }
    return out;
  }, [points]);

  const loading = points === undefined;
  const max = Math.max(1, ...series.map((p) => p.total));
  const grandTotal = series.reduce((s, p) => s + p.total, 0);

  // Elevated-traffic note: compare the latest minute against the trailing
  // median of the prior window. Honest wording — this is "elevated traffic",
  // not a DDoS verdict, which only Vercel's edge can make.
  const elevated = useMemo(() => {
    if (series.length < 6) return false;
    const prior = series.slice(0, -1).map((p) => p.total);
    const latest = series[series.length - 1]?.total ?? 0;
    const sorted = [...prior].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : sorted[mid] ?? 0;
    // Require both a meaningful absolute volume and a clear multiple of median
    // so a quiet site (median 0, one request) does not trip the note.
    return latest >= 20 && latest > Math.max(median * 3, 10);
  }, [series]);

  return (
    <div
      className="rounded-2xl border border-white/[0.08] p-5"
      style={{ background: CARD_BG }}
    >
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="font-bebas text-2xl tracking-wider text-cream flex items-center gap-2">
            <ChartLineUp size={20} weight="fill" color={ELECTRIC} aria-hidden="true" />
            Live traffic
          </h2>
          <p className="text-xs text-cream/45 mt-0.5">
            Requests per minute, last 60 minutes. Red is blocked or rate limited.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-cream/50">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm"
              style={{ background: `linear-gradient(180deg, ${ELECTRIC}, ${ELECTRIC}55)` }}
            />
            Total
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-sm"
              style={{ background: `linear-gradient(180deg, ${RED}, ${RED}55)` }}
            />
            Blocked
          </span>
        </div>
      </div>

      {elevated && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-400/30 bg-red-400/[0.08] px-3.5 py-2.5">
          <WarningOctagon
            size={16}
            weight="fill"
            color={RED}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-xs text-red-300 leading-relaxed">
            Elevated traffic in the latest minute, well above the trailing
            median for this window. Worth a look. This is an application-layer
            observation, not a network DDoS verdict. Cross-check Vercel
            Observability for the edge-level picture.
          </p>
        </div>
      )}

      {loading ? (
        <div className="h-[240px] w-full rounded-xl bg-white/[0.04] animate-pulse" />
      ) : grandTotal === 0 ? (
        <div className="h-[240px] flex flex-col items-center justify-center text-center">
          <Pulse size={28} weight="fill" className="text-cream/25 mb-2" aria-hidden="true" />
          <p className="text-cream/50 text-sm">No request telemetry in the last hour.</p>
          <p className="text-cream/35 text-xs mt-1">
            Bars will fill once the middleware starts flushing rollups.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Decorative gridlines. */}
          <div
            className="absolute inset-0 flex flex-col justify-between pointer-events-none"
            aria-hidden="true"
          >
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border-t border-white/[0.04] w-full" />
            ))}
          </div>

          <div className="relative flex items-end gap-[2px] h-[240px]">
            {series.map((p, i) => {
              const totalPct =
                p.total > 0 ? Math.max(8, (p.total / max) * 100) : 0;
              const blockedPct =
                p.blocked > 0 ? Math.max(8, (p.blocked / max) * 100) : 0;
              const label = new Date(p.minute).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <div
                  key={p.minute}
                  className="group relative flex-1 h-full flex items-end justify-center"
                >
                  {/* Total bar (blue). */}
                  <div
                    className="w-full rounded-t-sm traffic-bar"
                    style={{
                      height: `${totalPct}%`,
                      background: `linear-gradient(180deg, ${ELECTRIC}, ${ELECTRIC}33)`,
                      transitionDelay: `${i * 8}ms`,
                    }}
                  />
                  {/* Blocked overlay (red), anchored to the same baseline. */}
                  {p.blocked > 0 && (
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-t-sm traffic-bar"
                      style={{
                        height: `${blockedPct}%`,
                        background: `linear-gradient(180deg, ${RED}, ${RED}44)`,
                        transitionDelay: `${i * 8}ms`,
                      }}
                    />
                  )}
                  {/* Hover tooltip. */}
                  <div className="pointer-events-none absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 z-10 hidden group-hover:block whitespace-nowrap rounded-lg border border-white/10 bg-navy/95 px-2.5 py-1.5 text-[11px] shadow-lg">
                    <div className="text-cream/50">{label}</div>
                    <div className="text-cream">
                      <span style={{ color: ELECTRIC }}>{p.total}</span> requests
                    </div>
                    {p.blocked > 0 && (
                      <div style={{ color: RED }}>{p.blocked} blocked</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style jsx>{`
        .traffic-bar {
          transition: height 0.6s cubic-bezier(0.22, 1, 0.36, 1);
        }
        @media (prefers-reduced-motion: reduce) {
          .traffic-bar {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Page.
// ─────────────────────────────────────────────────────────────────────────

const EMPTY_BLOCK_FORM = { ip: "", reason: "", expiresAt: "" };

export default function AdminSecurityPage() {
  const { isAdmin, loading: roleLoading } = useAdminRole();

  // Overview polls fast (presence + traffic); threats and denylist slower.
  const overview = useSWR<OverviewResponse>(
    isAdmin ? "/api/admin/security/overview" : null,
    swrFetcher,
    { refreshInterval: 5000, keepPreviousData: true, revalidateOnFocus: true },
  );
  const threats = useSWR<ThreatsResponse>(
    isAdmin ? "/api/admin/security/threats" : null,
    swrFetcher,
    { refreshInterval: 10_000, keepPreviousData: true, revalidateOnFocus: true },
  );
  const denylist = useSWR<DenylistResponse>(
    isAdmin ? "/api/admin/security/denylist" : null,
    swrFetcher,
    { refreshInterval: 10_000, keepPreviousData: true, revalidateOnFocus: true },
  );

  // Block-from-threat confirm (destructive).
  const [blockTarget, setBlockTarget] = useState<ThreatRow | null>(null);
  // Unblock confirm, keyed by IP.
  const [unblockIp, setUnblockIp] = useState<string | null>(null);
  // Manual "block an IP" form.
  const [manualOpen, setManualOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_BLOCK_FORM);
  const [manualBusy, setManualBusy] = useState(false);

  const refreshSecurity = () => {
    void threats.mutate();
    void denylist.mutate();
    void overview.mutate();
  };

  // ── Self-gate: support staff and non-staff never fetch the dashboard. ──
  if (!roleLoading && !isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        The security operations dashboard is admin only.
      </div>
    );
  }

  const o = overview.data;
  const tiles = {
    activeNow: o ? o.activeNow.toLocaleString() : null,
    recentlyActive: o ? o.recentlyActive.toLocaleString() : null,
    requests: o ? o.totals.requests.toLocaleString() : null,
    blocked: o ? o.totals.blocked.toLocaleString() : null,
    denylistHits: o ? o.totals.denylistHits.toLocaleString() : null,
  };

  const threatRows = threats.data?.threats ?? [];
  const denyEntries = denylist.data?.entries ?? [];
  const activeDeny = denyEntries.filter((e) => e.active);

  // ── Mutations ──────────────────────────────────────────────────────
  const blockIp = async (ip: string, reason: string | null, expiresAt?: string | null) => {
    const body: Record<string, string> = { ip };
    if (reason && reason.trim()) body.reason = reason.trim();
    if (expiresAt) body.expiresAt = expiresAt;
    const res = await apiPost("/api/admin/security/denylist", body);
    if (res.ok) {
      toastSuccess(`Blocked ${ip}`);
      refreshSecurity();
      return true;
    }
    toastError(res.error ?? "Could not block that IP");
    return false;
  };

  const confirmBlockTarget = async () => {
    if (!blockTarget) return;
    const ok = await blockIp(
      blockTarget.ip,
      blockTarget.categories.join(", ") || "Flagged in threat feed",
    );
    if (ok) setBlockTarget(null);
    else throw new Error("block failed"); // keep ConfirmModal open
  };

  const confirmUnblock = async () => {
    if (!unblockIp) return;
    const res = await apiPost("/api/admin/security/denylist/remove", { ip: unblockIp });
    if (res.ok) {
      toastSuccess(`Unblocked ${unblockIp}`);
      setUnblockIp(null);
      refreshSecurity();
    } else {
      toastError(res.error ?? "Could not unblock that IP");
      throw new Error("unblock failed");
    }
  };

  const submitManual = async () => {
    const ip = form.ip.trim();
    if (ip.length < 3) {
      toastError("Enter a valid IP address");
      return;
    }
    setManualBusy(true);
    const ok = await blockIp(
      ip,
      form.reason,
      form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
    );
    setManualBusy(false);
    if (ok) {
      setManualOpen(false);
      setForm(EMPTY_BLOCK_FORM);
    }
  };

  const loadFailed = overview.error || threats.error || denylist.error;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1 flex items-center gap-3">
            <ShieldWarning size={30} weight="fill" className="text-gold" aria-hidden="true" />
            Security
          </h1>
          <p className="text-sm text-cream/50 max-w-2xl">
            Application-layer threat monitoring. Presence, request volume,
            classified actors, and the IP denylist. Refreshes every few seconds.
          </p>
        </div>
        <button
          onClick={() => {
            setForm(EMPTY_BLOCK_FORM);
            setManualOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold shrink-0 disabled:opacity-60"
          style={{
            background: "linear-gradient(135deg, #DC2626 0%, #991B1B 100%)",
            color: "#fff",
          }}
        >
          <Prohibit size={15} weight="bold" aria-hidden="true" /> Block an IP
        </button>
      </div>

      {/* ── 1. Honest scope banner ── */}
      <div className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-3.5 my-5">
        <div className="flex items-start gap-2.5">
          <ShieldSlash
            size={17}
            weight="fill"
            className="text-cream/40 mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs text-cream/55 leading-relaxed">
              Application-layer (L7) view. Volumetric network DDoS is absorbed by
              Vercel's edge before requests reach the app. See Vercel Firewall and
              Observability for the network-layer picture.
            </p>
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {[
                { label: "Vercel Firewall", href: "https://vercel.com/dashboard" },
                { label: "Vercel Observability", href: "https://vercel.com/dashboard" },
                { label: "Vercel Analytics", href: "https://vercel.com/dashboard" },
              ].map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-bold text-electric hover:underline"
                >
                  {l.label}
                  <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
                </a>
              ))}
              <span className="text-[11px] text-cream/30">
                Links open the Vercel dashboard root.
              </span>
            </div>
          </div>
        </div>
      </div>

      {loadFailed && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-5">
          Some security data could not load. If the security monitoring migration
          has not been run yet, run it first.
        </div>
      )}

      {/* ── 2. Stat tiles ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard
          label="Active now"
          value={tiles.activeNow}
          sub={o ? `${o.inSession.toLocaleString()} in a match` : undefined}
          accent={EMERALD}
          icon={<Pulse size={18} weight="fill" color={EMERALD} aria-hidden="true" />}
        />
        <StatCard
          label="Recently active"
          value={tiles.recentlyActive}
          sub="last 3 min"
          accent={ELECTRIC}
          icon={<Users size={18} weight="fill" color={ELECTRIC} aria-hidden="true" />}
        />
        <StatCard
          label="Requests"
          value={tiles.requests}
          sub="last 60 min"
          accent={GOLD}
          icon={<ChartLineUp size={18} weight="fill" color={GOLD} aria-hidden="true" />}
        />
        <StatCard
          label="Blocked / 429s"
          value={tiles.blocked}
          sub="last 60 min"
          accent={RED}
          icon={<ShieldSlash size={18} weight="fill" color={RED} aria-hidden="true" />}
        />
        <StatCard
          label="Denylist hits"
          value={tiles.denylistHits}
          sub="last 60 min"
          accent={RED}
          icon={<Prohibit size={18} weight="fill" color={RED} aria-hidden="true" />}
        />
      </div>

      {/* ── 3. Live traffic timeseries ── */}
      <div className="mb-6">
        <TrafficChart points={overview.data?.traffic} />
      </div>

      {/* ── 4. Threat feed ── */}
      <div
        className="rounded-2xl border border-white/[0.08] overflow-hidden mb-6"
        style={{ background: CARD_BG }}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/[0.06]">
          <h2 className="font-bebas text-2xl tracking-wider text-cream flex items-center gap-2">
            <Bug size={20} weight="fill" color={RED} aria-hidden="true" />
            Threat feed
          </h2>
          <span className="text-[11px] text-cream/40">Last 6 hours, top offenders</span>
        </div>

        {threats.data === undefined ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : threatRows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <ShieldWarning
              size={30}
              weight="fill"
              className="text-emerald-400/50 mx-auto mb-3"
              aria-hidden="true"
            />
            <p className="text-cream/60 text-sm">No flagged actors in the last 6 hours.</p>
            <p className="text-cream/35 text-xs mt-1">
              Scanners, brute force, and probes will appear here when detected.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-cream/40 border-b border-white/[0.06]">
                  <th className="px-5 py-3 font-bold">IP</th>
                  <th className="px-5 py-3 font-bold">Classification</th>
                  <th className="px-5 py-3 font-bold text-right">Score</th>
                  <th className="px-5 py-3 font-bold text-right">Events</th>
                  <th className="px-5 py-3 font-bold">Last seen</th>
                  <th className="px-5 py-3 font-bold">Sample</th>
                  <th className="px-5 py-3 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {threatRows.map((t) => (
                  <tr
                    key={t.ip}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-5 py-3">
                      <span className="font-mono text-cream/90 text-xs">{t.ip}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {t.categories.length === 0 ? (
                          <span className="text-cream/30 text-xs">—</span>
                        ) : (
                          t.categories.map((c) => (
                            <ClassificationChip key={c} category={c} />
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className="font-bebas text-lg tracking-wide"
                        style={{
                          color: t.score >= 200 ? RED : t.score >= 60 ? "#FB923C" : GOLD,
                        }}
                      >
                        {t.score}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-cream/70">{t.events}</td>
                    <td className="px-5 py-3 text-cream/50 text-xs" title={fmtDateTime(t.lastSeen)}>
                      {fmtRelative(t.lastSeen)}
                    </td>
                    <td className="px-5 py-3 max-w-[220px]">
                      {t.samplePath && (
                        <div className="font-mono text-[11px] text-cream/70 truncate" title={t.samplePath}>
                          {t.samplePath}
                        </div>
                      )}
                      {t.sampleUa && (
                        <div className="text-[11px] text-cream/35 truncate" title={t.sampleUa}>
                          {t.sampleUa}
                        </div>
                      )}
                      {!t.samplePath && !t.sampleUa && (
                        <span className="text-cream/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {t.blocked ? (
                        <div className="inline-flex items-center gap-2 justify-end">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-400/15 text-red-400 border border-red-400/30">
                            Blocked
                          </span>
                          <button
                            onClick={() => setUnblockIp(t.ip)}
                            className="px-3 py-1.5 rounded-lg border border-white/10 text-cream/70 text-xs font-bold hover:bg-white/5"
                          >
                            Unblock
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setBlockTarget(t)}
                          className="px-3 py-1.5 rounded-lg border border-red-400/30 text-red-400 bg-red-400/10 text-xs font-bold hover:brightness-110"
                        >
                          Block
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 5. Denylist panel ── */}
      <div
        className="rounded-2xl border border-white/[0.08] overflow-hidden"
        style={{ background: CARD_BG }}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-white/[0.06]">
          <h2 className="font-bebas text-2xl tracking-wider text-cream flex items-center gap-2">
            <Prohibit size={20} weight="fill" color={RED} aria-hidden="true" />
            IP denylist
          </h2>
          <button
            onClick={() => {
              setForm(EMPTY_BLOCK_FORM);
              setManualOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-400/30 text-red-400 bg-red-400/10 text-xs font-bold hover:brightness-110"
          >
            <Plus size={14} weight="bold" aria-hidden="true" /> Block an IP
          </button>
        </div>

        {denylist.data === undefined ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : activeDeny.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <ShieldCheckless />
            <p className="text-cream/60 text-sm">No IPs are currently blocked.</p>
            <p className="text-cream/35 text-xs mt-1">
              Block an actor from the threat feed above, or add one manually.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-cream/40 border-b border-white/[0.06]">
                  <th className="px-5 py-3 font-bold">IP</th>
                  <th className="px-5 py-3 font-bold">Reason</th>
                  <th className="px-5 py-3 font-bold">Blocked by</th>
                  <th className="px-5 py-3 font-bold">Created</th>
                  <th className="px-5 py-3 font-bold">Expires</th>
                  <th className="px-5 py-3 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {activeDeny.map((e) => (
                  <tr
                    key={e.ip}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-5 py-3 font-mono text-cream/90 text-xs">{e.ip}</td>
                    <td className="px-5 py-3 text-cream/70">
                      {e.reason ?? <span className="text-cream/30">—</span>}
                    </td>
                    <td className="px-5 py-3 text-cream/60">
                      {e.blockedByName ?? <span className="text-cream/30">—</span>}
                    </td>
                    <td className="px-5 py-3 text-cream/50 text-xs">
                      {fmtDateTime(e.createdAt)}
                    </td>
                    <td className="px-5 py-3 text-cream/50 text-xs">
                      {e.expiresAt ? (
                        fmtDateTime(e.expiresAt)
                      ) : (
                        <span className="text-cream/35">never</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setUnblockIp(e.ip)}
                        className="px-3 py-1.5 rounded-lg border border-white/10 text-cream/70 text-xs font-bold hover:bg-white/5"
                      >
                        Unblock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Block-from-threat confirm ── */}
      <ConfirmModal
        open={blockTarget !== null}
        onClose={() => setBlockTarget(null)}
        onConfirm={confirmBlockTarget}
        title="Block this IP?"
        message={
          blockTarget
            ? `${blockTarget.ip} will be added to the denylist and refused at the edge. This is logged to the audit trail. You can unblock it later.`
            : undefined
        }
        confirmLabel="Block IP"
        destructive
      />

      {/* ── Unblock confirm ── */}
      <ConfirmModal
        open={unblockIp !== null}
        onClose={() => setUnblockIp(null)}
        onConfirm={confirmUnblock}
        title="Unblock this IP?"
        message={
          unblockIp
            ? `${unblockIp} will be removed from the denylist and allowed through again. This is logged to the audit trail.`
            : undefined
        }
        confirmLabel="Unblock IP"
      />

      {/* ── Manual block-an-IP form ── */}
      <AdminModalShell
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        busy={manualBusy}
        labelId="block-ip-title"
        borderClass="border-red-400/30"
      >
        <h3 id="block-ip-title" className="font-bebas text-2xl tracking-wider text-red-400 mb-1">
          Block an IP
        </h3>
        <p className="text-xs text-cream/50 mb-4">
          Adds the address to the denylist. The middleware refuses it on its next
          denylist refresh. Logged to the audit trail.
        </p>

        <label className={fieldLabel}>IP address (required)</label>
        <input
          value={form.ip}
          onChange={(e) => setForm((f) => ({ ...f, ip: e.target.value }))}
          placeholder="e.g. 203.0.113.7"
          maxLength={64}
          inputMode="text"
          autoComplete="off"
          className={`${fieldInput} font-mono`}
        />

        <label className={fieldLabel}>Reason</label>
        <input
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          placeholder="e.g. Vuln scanner hitting /.env"
          maxLength={300}
          className={fieldInput}
        />

        <label className={fieldLabel}>Expires (optional)</label>
        <input
          value={form.expiresAt}
          onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
          type="datetime-local"
          className={`${fieldInput} [color-scheme:dark]`}
        />
        <p className="text-[11px] text-cream/35 -mt-1.5 mb-3">
          Leave blank for a permanent block.
        </p>

        <div className="flex gap-2 mt-1">
          <button
            onClick={() => setManualOpen(false)}
            disabled={manualBusy}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={submitManual}
            disabled={manualBusy}
            className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #DC2626 0%, #991B1B 100%)",
              color: "#fff",
            }}
          >
            {manualBusy ? "Working..." : "Block IP"}
          </button>
        </div>
      </AdminModalShell>
    </div>
  );
}

// Small empty-state glyph for the denylist panel.
function ShieldCheckless() {
  return (
    <Prohibit
      size={28}
      weight="fill"
      className="text-emerald-400/45 mx-auto mb-2"
      aria-hidden="true"
    />
  );
}
