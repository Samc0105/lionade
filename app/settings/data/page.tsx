"use client";

/**
 * /settings/data — Data & Usage section of the route-based settings overhaul.
 *
 * Renders INSIDE app/settings/layout.tsx, which already provides
 * ProtectedRoute + Navbar + SpaceBackground + the section nav rail. This page
 * is content-only.
 *
 * Surfaces (top to bottom):
 *   1. Storage used      — GET /api/ninny/materials (per-file size estimated
 *                          from generated_content length; no size column exists,
 *                          so this is an approximation, labelled as such).
 *                          Per-item delete → DELETE /api/ninny/materials?id=…
 *   2. Quiz history      — total sessions / questions / Fangs, aggregated from
 *                          the user's own quiz_sessions via the RLS-scoped anon
 *                          client (read-only display, no new backend route).
 *   3. Ninny usage       — today's generations vs the daily cap (the real gate),
 *                          progress bar. usePlan reads the subscription tier.
 *   4. Download my data  — GET /api/user/export (one per 24h). Triggers a file
 *                          download; shows "Last export" + a countdown when
 *                          inside the window; handles 429 gracefully.
 *   5. Session history   — GET /api/user/sessions (last 10). "Sign out all
 *                          other sessions" → supabase.auth.signOut({ scope:
 *                          'others' }) (keeps the current session).
 *   6. Data retention notice (plain text).
 *
 * Motion: GPU-only via the shared primitives + animate-slide-up; reduced motion
 * safe via the globals.css blanket rule. No em-dashes in copy.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowsClockwise,
  Trash,
  DownloadSimple,
  Books,
  ChartLineUp,
  Sparkle,
  DeviceMobile,
  DeviceTablet,
  Desktop as DesktopIcon,
  SignOut,
  type Icon,
} from "@phosphor-icons/react";
import { SettingsCard, SettingRow } from "@/components/settings/shared";
import { apiGet } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { usePlan } from "@/lib/use-plan";
import { NINNY_DAILY_LIMIT } from "@/lib/ninny";

// ── Types ─────────────────────────────────────────────────────────────────────
interface NinnyMaterial {
  id: string;
  title: string | null;
  subject: string | null;
  difficulty: string | null;
  generated_content: unknown;
  created_at: string;
}
interface MaterialsResponse {
  materials: NinnyMaterial[];
  todayCount: number;
  dailyLimit: number;
  dailyRemaining: number;
  freeRemaining: number;
}
interface PreferencesResponse {
  last_export_at: string | null;
}
interface SessionRow {
  id: string;
  device: "Mobile" | "Tablet" | "Desktop";
  browser: string;
  created_at: string;
}
interface SessionsResponse {
  ok: boolean;
  sessions: SessionRow[];
}
interface QuizSummary {
  sessions: number;
  questions: number;
  fangs: number;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ── Helpers ─────────────────────────────────────────────────────────────────
// We have no stored byte-size column, so estimate from the JSON payload length.
function estimateBytes(material: NinnyMaterial): number {
  try {
    return new Blob([JSON.stringify(material.generated_content ?? "")]).size;
  } catch {
    return 0;
  }
}
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function formatCountdown(ms: number): string {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DataSettingsPage() {
  const { user } = useAuth();
  const { plan } = usePlan();

  // Loading is per-section so one slow query doesn't blank the whole page.
  const [materials, setMaterials] = useState<MaterialsResponse | null>(null);
  const [materialsError, setMaterialsError] = useState(false);
  const [quizSummary, setQuizSummary] = useState<QuizSummary | null>(null);
  const [lastExportAt, setLastExportAt] = useState<string | null>(null);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [sessionsError, setSessionsError] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Tick the clock once a minute so the 24h export countdown stays live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadMaterials = useCallback(async () => {
    setMaterialsError(false);
    const res = await apiGet<MaterialsResponse>("/api/ninny/materials");
    if (!res.ok || !res.data) {
      setMaterialsError(true);
      return;
    }
    setMaterials(res.data);
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsError(false);
    const res = await apiGet<SessionsResponse>("/api/user/sessions");
    if (!res.ok || !res.data?.ok) {
      setSessionsError(true);
      return;
    }
    setSessions(res.data.sessions);
  }, []);

  const loadPrefs = useCallback(async () => {
    const res = await apiGet<PreferencesResponse>("/api/user/preferences");
    setLastExportAt(res.ok && res.data ? res.data.last_export_at : null);
    setPrefsLoaded(true);
  }, []);

  const loadQuizSummary = useCallback(async () => {
    if (!user?.id) return;
    // Read-only display stats from the user's own quiz_sessions (RLS-scoped).
    const [{ data: sessionRows }, { data: profileRow }] = await Promise.all([
      supabase
        .from("quiz_sessions")
        .select("total_questions")
        .eq("user_id", user.id),
      supabase.from("profiles").select("coins").eq("id", user.id).single(),
    ]);
    const rows = (sessionRows ?? []) as { total_questions: number | null }[];
    const questions = rows.reduce((sum, r) => sum + (r.total_questions ?? 0), 0);
    setQuizSummary({
      sessions: rows.length,
      questions,
      fangs: (profileRow as { coins?: number } | null)?.coins ?? 0,
    });
  }, [user?.id]);

  useEffect(() => {
    void loadMaterials();
    void loadSessions();
    void loadPrefs();
    void loadQuizSummary();
  }, [loadMaterials, loadSessions, loadPrefs, loadQuizSummary]);

  // ── Export ───────────────────────────────────────────────────────────────────
  const exportLockedUntil =
    lastExportAt && !isNaN(new Date(lastExportAt).getTime())
      ? new Date(lastExportAt).getTime() + TWENTY_FOUR_HOURS_MS
      : 0;
  const exportLocked = exportLockedUntil > now;
  const exportCountdown = exportLocked ? formatCountdown(exportLockedUntil - now) : "";

  const handleExport = useCallback(async () => {
    if (exporting || exportLocked) return;
    setExporting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toastError("Your session expired. Sign in again to export.");
        return;
      }
      const res = await fetch("/api/user/export", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 429) {
        // Inside the 24h window — sync our local last-export state and surface
        // the countdown rather than a raw error.
        const body = await res.json().catch(() => null);
        const retryAfter = typeof body?.retryAfter === "number" ? body.retryAfter : 0;
        if (retryAfter > 0) {
          setLastExportAt(new Date(Date.now() - (TWENTY_FOUR_HOURS_MS - retryAfter * 1000)).toISOString());
        } else {
          void loadPrefs();
        }
        toastError(body?.error ?? "You can export your data once every 24 hours.");
        return;
      }

      if (!res.ok) {
        toastError("Couldn't prepare your export. Try again.");
        return;
      }

      // Trigger the file download from the blob.
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `lionade-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLastExportAt(new Date().toISOString());
      toastSuccess("Your data export is downloading.");
    } catch {
      toastError("Couldn't prepare your export. Try again.");
    } finally {
      setExporting(false);
    }
  }, [exporting, exportLocked, loadPrefs]);

  // ── Delete a material ────────────────────────────────────────────────────────
  const handleDeleteMaterial = useCallback(
    async (id: string) => {
      if (deletingId) return;
      setDeletingId(id);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          toastError("Your session expired. Sign in again.");
          return;
        }
        const res = await fetch(`/api/ninny/materials?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          toastError("Couldn't delete that material. Try again.");
          return;
        }
        setMaterials((prev) =>
          prev ? { ...prev, materials: prev.materials.filter((m) => m.id !== id) } : prev,
        );
        toastSuccess("Material deleted.");
      } catch {
        toastError("Couldn't delete that material. Try again.");
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId],
  );

  // ── Sign out other sessions ────────────────────────────────────────────────
  const handleSignOutOthers = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      // scope: 'others' revokes every OTHER session and keeps the current one.
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) {
        toastError("Couldn't sign out your other sessions. Try again.");
        return;
      }
      toastSuccess("Signed out of all your other sessions.");
    } catch {
      toastError("Couldn't sign out your other sessions. Try again.");
    } finally {
      setSigningOut(false);
    }
  }, [signingOut]);

  // ── Derived storage totals ─────────────────────────────────────────────────
  const totalBytes = (materials?.materials ?? []).reduce((sum, m) => sum + estimateBytes(m), 0);
  const fileCount = materials?.materials.length ?? 0;

  // ── Ninny usage ────────────────────────────────────────────────────────────
  const dailyLimit = materials?.dailyLimit ?? NINNY_DAILY_LIMIT;
  const todayCount = materials?.todayCount ?? 0;
  const usagePct = dailyLimit > 0 ? Math.min(100, Math.round((todayCount / dailyLimit) * 100)) : 0;

  return (
    <div>
      {/* ── 1. Storage used ─────────────────────────────────────────────────── */}
      <SettingsCard eyebrow="Storage" title="Study materials">
        {materialsError ? (
          <InlineError message="We couldn't load your materials." onRetry={loadMaterials} />
        ) : !materials ? (
          <RowsSkeleton rows={3} />
        ) : fileCount === 0 ? (
          <EmptyHint
            Icon={Books}
            text="No Ninny study materials yet. Generate one from a topic or your notes to see it here."
          />
        ) : (
          <>
            <SettingRow
              label="Estimated storage used"
              description={`${fileCount} ${fileCount === 1 ? "material" : "materials"} stored. Sizes are estimated from generated content.`}
            >
              <span className="font-bebas text-2xl tracking-wider text-electric">
                {formatBytes(totalBytes)}
              </span>
            </SettingRow>

            <ul className="mt-2 divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {materials.materials.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-cream text-sm font-semibold truncate">
                      {m.title || "Untitled material"}
                    </p>
                    <p className="text-cream/45 text-xs mt-0.5">
                      {[m.subject, formatDate(m.created_at), formatBytes(estimateBytes(m))]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteMaterial(m.id)}
                    disabled={deletingId === m.id}
                    aria-label={`Delete ${m.title || "material"}`}
                    className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-cream/45 hover:text-red-300 hover:bg-red-500/10 transition-colors transform-gpu disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                  >
                    {deletingId === m.id ? (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : (
                      <Trash size={16} aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </SettingsCard>

      {/* ── 2. Quiz history summary ────────────────────────────────────────── */}
      <SettingsCard eyebrow="Activity" title="Quiz history">
        {!quizSummary ? (
          <RowsSkeleton rows={1} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat Icon={ChartLineUp} label="Sessions" value={quizSummary.sessions.toLocaleString()} />
              <Stat Icon={ChartLineUp} label="Questions" value={quizSummary.questions.toLocaleString()} />
              <Stat Icon={Sparkle} label="Fangs" value={quizSummary.fangs.toLocaleString()} />
            </div>
            <div className="mt-4 border-t border-white/[0.06] pt-3.5">
              <a
                href="/profile"
                className="inline-flex items-center gap-1.5 text-electric text-xs font-bold hover:text-electric/80 transition-colors"
              >
                View full quiz history
                <span aria-hidden="true">&#8594;</span>
              </a>
            </div>
          </>
        )}
      </SettingsCard>

      {/* ── 3. Ninny usage ──────────────────────────────────────────────────── */}
      <SettingsCard eyebrow="AI usage" title="Ninny generations today">
        {!materials ? (
          <RowsSkeleton rows={1} />
        ) : (
          <>
            <SettingRow
              label="Generations used today"
              description={`Resets daily. Your plan: ${plan === "free" ? "Free" : plan === "pro" ? "Pro" : "Platinum"}.`}
            >
              <span className="font-bebas text-2xl tracking-wider text-cream">
                {todayCount}
                <span className="text-cream/40"> / {dailyLimit}</span>
              </span>
            </SettingRow>
            <div
              className="mt-1 h-2 w-full rounded-full bg-white/[0.06] overflow-hidden"
              role="progressbar"
              aria-valuenow={todayCount}
              aria-valuemin={0}
              aria-valuemax={dailyLimit}
              aria-label="Ninny generations used today"
            >
              <div
                className="h-full rounded-full bg-electric transition-[width] duration-500 transform-gpu"
                style={{ width: `${usagePct}%`, willChange: "width" }}
              />
            </div>
            <p className="text-cream/45 text-xs mt-2 leading-snug">
              {materials.dailyRemaining > 0
                ? `${materials.dailyRemaining} ${materials.dailyRemaining === 1 ? "generation" : "generations"} left today.`
                : "You've hit today's generation cap. It resets at midnight UTC."}
            </p>
          </>
        )}
      </SettingsCard>

      {/* ── 4. Download my data ─────────────────────────────────────────────── */}
      <SettingsCard eyebrow="Portability" title="Download my data">
        <SettingRow
          label="Export your Lionade data"
          description="A JSON file with your profile, quiz history, achievements, Fang ledger, word banks, classes, and settings. Limited to one export per day."
        >
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || exportLocked || !prefsLoaded}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-electric text-white hover:bg-electric/90 transition-colors transform-gpu disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40"
          >
            {exporting ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Preparing
              </>
            ) : (
              <>
                <DownloadSimple size={16} weight="bold" aria-hidden="true" />
                Download
              </>
            )}
          </button>
        </SettingRow>
        <div className="border-t border-white/[0.06] pt-3 mt-1">
          {exportLocked ? (
            <p className="text-cream/55 text-xs leading-snug">
              You exported recently. You can export again in{" "}
              <span className="text-cream/80 font-semibold">{exportCountdown}</span>.
            </p>
          ) : lastExportAt ? (
            <p className="text-cream/45 text-xs leading-snug">
              Last export: {formatDateTime(lastExportAt)}
            </p>
          ) : (
            <p className="text-cream/45 text-xs leading-snug">
              You haven&apos;t exported your data yet.
            </p>
          )}
        </div>
      </SettingsCard>

      {/* ── 5. Session history ──────────────────────────────────────────────── */}
      <SettingsCard eyebrow="Security" title="Recent sign-ins">
        {sessionsError ? (
          <InlineError message="We couldn't load your sign-in history." onRetry={loadSessions} />
        ) : !sessions ? (
          <RowsSkeleton rows={3} />
        ) : sessions.length === 0 ? (
          <EmptyHint
            Icon={DesktopIcon}
            text="No recent sign-ins recorded yet. They'll appear here after your next login."
          />
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {sessions.map((s) => {
              const DeviceIcon =
                s.device === "Mobile"
                  ? DeviceMobile
                  : s.device === "Tablet"
                    ? DeviceTablet
                    : DesktopIcon;
              return (
                <li key={s.id} className="flex items-center gap-3 py-3">
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] text-cream/70">
                    <DeviceIcon size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-cream text-sm font-semibold leading-tight">
                      {s.browser} on {s.device}
                    </p>
                    <p className="text-cream/45 text-xs mt-0.5">{formatDateTime(s.created_at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-white/[0.06] pt-4 mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-cream/45 text-xs leading-snug">
            Signing out other sessions keeps you signed in here but ends every other device.
          </p>
          <button
            type="button"
            onClick={handleSignOutOthers}
            disabled={signingOut}
            className="flex-shrink-0 self-start sm:self-center inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-cream/80 bg-white/[0.05] border border-white/[0.1] hover:bg-white/[0.1] hover:text-cream transition-colors transform-gpu disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40"
          >
            {signingOut ? (
              <span className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            ) : (
              <SignOut size={14} weight="bold" aria-hidden="true" />
            )}
            Sign out all other sessions
          </button>
        </div>
      </SettingsCard>

      {/* ── 6. Data retention notice ────────────────────────────────────────── */}
      <SettingsCard eyebrow="Retention" title="How long we keep your data">
        <p className="text-cream/55 text-sm leading-relaxed">
          We keep your study data for as long as your account is active. Deleting your account
          permanently removes all data within 30 days.
        </p>
      </SettingsCard>
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────
function Stat({
  Icon: IconCmp,
  label,
  value,
}: {
  Icon: Icon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3.5">
      <IconCmp size={16} className="text-electric mb-2" aria-hidden={true} />
      <p className="font-bebas text-2xl tracking-wider text-cream leading-none">{value}</p>
      <p className="text-cream/45 text-[11px] uppercase tracking-wider font-mono mt-1.5">{label}</p>
    </div>
  );
}

function EmptyHint({
  Icon: IconCmp,
  text,
}: {
  Icon: Icon;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2 text-cream/55">
      <IconCmp size={20} className="text-cream/35 flex-shrink-0" aria-hidden={true} />
      <p className="text-sm leading-snug">{text}</p>
    </div>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" className="space-y-3.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="h-4 w-48 rounded bg-white/[0.07] animate-pulse" />
          <div className="h-6 w-16 rounded bg-white/[0.07] animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-1">
      <p className="text-red-300 text-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="flex-shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream text-xs font-bold transition-colors transform-gpu"
      >
        <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
