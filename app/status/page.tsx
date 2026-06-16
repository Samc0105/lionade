"use client";

// PUBLIC status / uptime page. Reachable LOGGED OUT and even under a 'site'
// maintenance flag (MaintenanceGate exempts /status). NO ProtectedRoute.
// ============================================================================
// It polls /api/status every ~45s with a BARE public fetch (NOT swrFetcher — no
// auth token; this surface must work for anonymous visitors and never vary by
// session). The endpoint is fail-open: on any backend error it returns
// "operational" with empty lists, so this page degrades to a calm "all good"
// rather than reporting an outage of the status system itself.
//
// SECTIONS:
//   1. Header — a big calm "All systems operational" (green) when overall is
//      operational, else "Some features are degraded" (amber).
//   2. Active degraded features — label, warning/maintenance pill, message, and
//      a relative "since" time. Only shown when something is degraded.
//   3. Recent history — resolved incidents (label, kind, duration, when).
//   4. Loading + empty states with NO flash of wrong content.
//
// Brand chrome mirrors app/not-found.tsx (navy #04080F bg, ambient drift,
// reduced-motion respected). No em-dashes anywhere in the copy.

import { useCallback, useEffect, useState } from "react";

const POLL_INTERVAL_MS = 45_000;

type Overall = "operational" | "degraded";

interface DegradedEntry {
  key: string;
  label: string;
  status: "warning" | "maintenance";
  message: string | null;
  since: string | null;
}

interface RecentEntry {
  key: string;
  label: string;
  kind: "warning" | "maintenance";
  message: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface StatusData {
  overall: Overall;
  degraded: DegradedEntry[];
  recent: RecentEntry[];
}

// Bare public fetch, no auth header. Returns null on any failure so the caller
// can keep the last good snapshot rather than flashing an error state.
async function fetchStatus(): Promise<StatusData | null> {
  try {
    const res = await fetch("/api/status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<StatusData> | null;
    if (!json || typeof json !== "object") return null;
    return {
      overall: json.overall === "degraded" ? "degraded" : "operational",
      degraded: Array.isArray(json.degraded) ? json.degraded : [],
      recent: Array.isArray(json.recent) ? json.recent : [],
    };
  } catch {
    return null;
  }
}

// "3 minutes ago" / "2 hours ago" / "just now". Dash-free, no parenthetical
// dashes. Returns "" for an unparseable / missing time so the UI can hide it.
function relativeFromNow(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

// Human duration between two ISO timestamps, e.g. "12 minutes", "1 hour".
// Empty string when either bound is missing or unparseable.
function durationBetween(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "";
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "";
  const sec = Math.floor((end - start) / 1000);
  if (sec < 60) return "under a minute";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"}`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"}`;
}

function StatusPill({ kind }: { kind: "warning" | "maintenance" }) {
  const isMaint = kind === "maintenance";
  const label = isMaint ? "Maintenance" : "Known issue";
  return (
    <span
      className="font-mono shrink-0 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em]"
      style={
        isMaint
          ? {
              color: "#FF8FA3",
              background: "rgba(255,99,132,0.10)",
              border: "1px solid rgba(255,99,132,0.30)",
            }
          : {
              color: "#FFD700",
              background: "rgba(255,215,0,0.10)",
              border: "1px solid rgba(255,215,0,0.30)",
            }
      }
    >
      {label}
    </span>
  );
}

export default function StatusPage() {
  // null while we have never loaded => show the loading state, never a wrong
  // "operational" flash. After the first load we keep the last good snapshot.
  const [data, setData] = useState<StatusData | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const next = await fetchStatus();
    if (next) {
      setData(next);
    }
    // Mark loaded even on a miss so we leave the loading state. A miss keeps the
    // previous snapshot (or shows the calm operational fallback on first miss).
    setLoaded(true);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const next = await fetchStatus();
      if (!active) return;
      if (next) setData(next);
      setLoaded(true);
    })();

    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [refresh]);

  // Fall back to a calm operational view if the first load missed entirely.
  const overall: Overall = data?.overall ?? "operational";
  const degraded = data?.degraded ?? [];
  const recent = data?.recent ?? [];
  const isOperational = overall === "operational";

  return (
    <div
      className="relative min-h-screen overflow-hidden px-6 py-16 sm:py-24"
      style={{ background: "#04080F" }}
    >
      <style>{`
        @keyframes st-drift-a {
          0%, 100% { transform: translate3d(-4%, -2%, 0) scale(1); opacity: 0.5; }
          50%      { transform: translate3d(4%, 3%, 0) scale(1.08); opacity: 0.7; }
        }
        @keyframes st-drift-b {
          0%, 100% { transform: translate3d(3%, 2%, 0) scale(1.04); opacity: 0.4; }
          50%      { transform: translate3d(-3%, -3%, 0) scale(0.96); opacity: 0.55; }
        }
        @keyframes st-fade-up {
          from { opacity: 0; transform: translate3d(0, 12px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        @keyframes st-pulse {
          0%, 100% { opacity: 0.85; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.12); }
        }
        .st-drift-a { animation: st-drift-a 16s ease-in-out infinite; will-change: transform, opacity; }
        .st-drift-b { animation: st-drift-b 20s ease-in-out infinite; will-change: transform, opacity; }
        .st-fade-up { animation: st-fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both; will-change: transform, opacity; }
        .st-pulse   { animation: st-pulse 2.6s ease-in-out infinite; will-change: transform, opacity; }
        @media (prefers-reduced-motion: reduce) {
          .st-drift-a, .st-drift-b, .st-fade-up, .st-pulse { animation: none; }
        }
      `}</style>

      {/* Ambient drift, GPU only, tinted by overall state */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none st-drift-a"
        style={{
          background: isOperational
            ? "radial-gradient(ellipse 60% 50% at 30% 25%, rgba(74,217,150,0.10) 0%, transparent 60%)"
            : "radial-gradient(ellipse 60% 50% at 30% 25%, rgba(255,215,0,0.12) 0%, transparent 60%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none st-drift-b"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 75% 75%, rgba(74,144,217,0.10) 0%, transparent 65%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-cream/40 mb-6 text-center">
          Lionade status
        </p>

        {/* Header: loading, or operational, or degraded */}
        {!loaded ? (
          <div className="st-fade-up text-center" role="status" aria-live="polite">
            <h1 className="font-bebas text-cream/70 tracking-wide text-4xl sm:text-5xl">
              Checking status
            </h1>
            <p className="mt-3 text-sm text-cream/45 font-syne">
              One moment while we read the latest signals.
            </p>
          </div>
        ) : (
          <div className="st-fade-up text-center" role="status" aria-live="polite">
            <div className="mb-5 flex items-center justify-center gap-3">
              <span
                aria-hidden="true"
                className="st-pulse inline-block h-3.5 w-3.5 rounded-full"
                style={{
                  background: isOperational ? "#4AD996" : "#FFD700",
                  boxShadow: isOperational
                    ? "0 0 16px rgba(74,217,150,0.6)"
                    : "0 0 16px rgba(255,215,0,0.6)",
                }}
              />
            </div>
            <h1
              className="font-bebas tracking-wide leading-tight"
              style={{
                fontSize: "clamp(40px, 9vw, 72px)",
                color: isOperational ? "#7CE7B5" : "#FFD700",
                textShadow: isOperational
                  ? "0 0 36px rgba(74,217,150,0.20)"
                  : "0 0 36px rgba(255,215,0,0.22)",
              }}
            >
              {isOperational
                ? "All systems operational"
                : "Some features are degraded"}
            </h1>
            <p className="mt-4 text-sm sm:text-base text-cream/55 font-syne max-w-md mx-auto leading-relaxed">
              {isOperational
                ? "Everything is running smoothly. We refresh this page automatically."
                : "The features below are having a rough moment. Everything else is running fine."}
            </p>
          </div>
        )}

        {/* Active degraded features */}
        {loaded && degraded.length > 0 && (
          <section className="st-fade-up mt-12">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/40 mb-4">
              Active issues
            </h2>
            <ul className="space-y-3">
              {degraded.map((item) => {
                const since = relativeFromNow(item.since);
                return (
                  <li
                    key={item.key}
                    className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-syne font-bold text-cream text-base sm:text-lg">
                        {item.label}
                      </h3>
                      <StatusPill kind={item.status} />
                    </div>
                    {item.message && (
                      <p className="mt-2 text-sm text-cream/65 font-syne leading-relaxed">
                        {item.message}
                      </p>
                    )}
                    {since && (
                      <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/35">
                        Since {since}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Recent history */}
        <section className="st-fade-up mt-12">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/40 mb-4">
            Recent history
          </h2>
          {loaded && recent.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur">
              <p className="text-sm text-cream/50 font-syne">
                No recent incidents. Smooth sailing lately.
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {recent.map((item, idx) => {
                const when = relativeFromNow(item.startedAt);
                const dur = durationBetween(item.startedAt, item.endedAt);
                return (
                  <li
                    key={`${item.key}-${item.startedAt ?? idx}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background:
                            item.kind === "maintenance" ? "#FF8FA3" : "#FFD700",
                        }}
                      />
                      <span className="font-syne text-sm text-cream/80">
                        {item.label}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cream/35">
                        {item.kind === "maintenance"
                          ? "maintenance"
                          : "known issue"}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-cream/40">
                      {dur ? `Resolved in ${dur}` : "Resolved"}
                      {when ? ` · ${when}` : ""}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cream/25 mt-14 text-center">
          This page refreshes itself
        </p>
      </div>
    </div>
  );
}
