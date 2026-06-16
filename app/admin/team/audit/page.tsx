"use client";

/**
 * /admin/team/audit — team-scoped audit trail. ADMIN ONLY.
 *
 * Reads the shared GET /api/admin/audit-log endpoint (the same table the
 * team action routes write to via writeTeamAudit) and presents only the
 * team_* events as a timeline: when, who, the humanized action, the target,
 * and a safe subset of the metadata.
 *
 * The audit-log endpoint filters by ONE exact action server-side. When a
 * specific team action is selected we pass it through (`?action=`). When
 * "All team actions" is selected we cannot express an OR on the server, so we
 * fetch the page unfiltered and keep only the team_* rows client-side. A short
 * allow-list of metadata keys is rendered so a future field can never leak a
 * secret-looking value into this view.
 */

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { ArrowLeft, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { CARD_BG } from "@/components/admin/shared";

// The team actions writeTeamAudit emits (see lib/team/audit.ts callers) plus
// team_mfa_autosuspend, which the MFA-enforcement cron writes when a staff
// member misses the TOTP grace window (app/api/cron/team-mfa-enforce).
const TEAM_ACTIONS = [
  "team_provision",
  "team_offboard",
  "team_offboard_hard",
  "team_role_change",
  "team_password_reset",
  "team_mfa_autosuspend",
] as const;

const TEAM_ACTION_SET = new Set<string>(TEAM_ACTIONS);

const ACTION_LABEL: Record<string, string> = {
  team_provision: "Provisioned",
  team_offboard: "Offboarded (soft)",
  team_offboard_hard: "Offboarded (hard)",
  team_role_change: "Status change",
  team_password_reset: "Password reset",
  team_mfa_autosuspend: "MFA auto-suspend",
};

const ACTION_COLORS: Record<string, string> = {
  team_provision: "text-green-300 bg-green-400/10 border-green-400/30",
  team_offboard: "text-amber-300 bg-amber-400/10 border-amber-400/30",
  team_offboard_hard: "text-red-400 bg-red-400/10 border-red-400/30",
  team_role_change: "text-purple-300 bg-purple-400/10 border-purple-400/30",
  team_password_reset: "text-electric bg-electric/10 border-electric/30",
  team_mfa_autosuspend: "text-amber-300 bg-amber-400/10 border-amber-400/30",
};

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All team actions" },
  { value: "team_provision", label: "Provision" },
  { value: "team_offboard", label: "Offboard (soft)" },
  { value: "team_offboard_hard", label: "Offboard (hard)" },
  { value: "team_role_change", label: "Status change" },
  { value: "team_password_reset", label: "Password reset" },
  { value: "team_mfa_autosuspend", label: "MFA auto-suspend" },
];

// Allow-list of metadata keys safe to render. Anything outside this list is
// dropped so a future credential-like field can never surface in the UI.
const SAFE_METADATA_KEYS = new Set<string>([
  "username",
  "email_address",
  "role",
  "previous_role",
  "previous_status",
  "lionade_access",
  "lionade_access_granted",
  "auth_user_created",
  "to",
  "hard",
  "mode",
  "delivery",
  "email_sent",
  "must_change_password_set",
  "link_revealed_to_admin",
]);

interface Entry {
  id: string;
  action: string;
  performedBy: string;
  performedByName: string;
  targetUserId: string | null;
  targetName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Render the allow-listed metadata as "key: value" chips. Never renders an
 *  unknown key, so an accidentally-added secret field cannot leak here. */
function safeMetadataPairs(metadata: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!SAFE_METADATA_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue; // skip nested objects (e.g. steps)
    out.push([key.replace(/_/g, " "), String(value)]);
  }
  return out;
}

export default function AdminTeamAuditPage() {
  const { isAdmin } = useAdminRole();
  const [action, setAction] = useState<string>("");
  const [page, setPage] = useState(0);

  const qs = new URLSearchParams();
  if (action) qs.set("action", action);
  qs.set("page", String(page));

  const { data, error, isLoading } = useSWR<{
    entries: Entry[];
    total: number;
    pageSize: number;
  }>(isAdmin ? `/api/admin/audit-log?${qs.toString()}` : null, swrFetcher, {
    keepPreviousData: true,
  });

  if (!isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        The team audit log is admin only.
      </div>
    );
  }

  // When a specific team action is selected the server already filtered, but we
  // still defensively keep only team_* rows for the "all" view.
  const allEntries = data?.entries ?? [];
  const entries = action
    ? allEntries
    : allEntries.filter((e) => TEAM_ACTION_SET.has(e.action));

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div>
      <Link
        href="/admin/team"
        className="inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-cream/80 transition-colors mb-4"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to team
      </Link>

      <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1">
        Team audit log
      </h1>
      <p className="text-sm text-cream/50 mb-6">
        Provisioning, status changes, password resets, and offboards. Who did
        what to whom, and when.
      </p>

      {/* Filter */}
      <div className="flex gap-3 mb-5">
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(0);
          }}
          className="px-3 py-2.5 rounded-xl border border-white/10 text-sm text-cream outline-none focus:border-electric/40 [&>option]:bg-[#0a1020]"
          style={{ background: CARD_BG }}
          aria-label="Filter by team action"
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-5">
          Could not load the team audit log.
        </div>
      )}

      {/* Timeline */}
      <div
        className="rounded-2xl border border-white/[0.08] p-2"
        style={{ background: CARD_BG }}
      >
        {entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-cream/40 text-sm">
            {isLoading
              ? "Loading team events..."
              : action
                ? "No team events match this filter."
                : "No team events on this page."}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {entries.map((e) => {
              const pairs = safeMetadataPairs(e.metadata);
              return (
                <li key={e.id} className="px-3 py-4">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span
                      className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                        ACTION_COLORS[e.action] ??
                        "text-cream/70 bg-white/[0.06] border-white/15"
                      }`}
                    >
                      {ACTION_LABEL[e.action] ?? e.action}
                    </span>
                    <span className="text-xs text-cream/40 whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-cream/80">
                    <span className="font-semibold text-cream">
                      {e.performedByName}
                    </span>
                    {e.targetUserId ? (
                      <>
                        {" "}
                        &rarr;{" "}
                        <Link
                          href={`/admin/users/${e.targetUserId}`}
                          className="text-electric hover:underline"
                        >
                          {e.targetName ?? e.targetUserId}
                        </Link>
                      </>
                    ) : null}
                  </div>
                  {pairs.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {pairs.map(([k, v]) => (
                        <span
                          key={k}
                          className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/[0.04] text-cream/55 border border-white/[0.06]"
                        >
                          {k}: {v}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-cream/40">
          page {page + 1} of {lastPage + 1}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-white/10 text-cream/70 text-xs font-bold hover:bg-white/5 disabled:opacity-40"
          >
            <CaretLeft size={12} aria-hidden="true" /> Newer
          </button>
          <button
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage}
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-white/10 text-cream/70 text-xs font-bold hover:bg-white/5 disabled:opacity-40"
          >
            Older <CaretRight size={12} aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-cream/35">
        Only a safe subset of each event&apos;s metadata is shown. Passwords,
        reset links, and other secrets are never written to the audit log or
        rendered here.
      </p>
    </div>
  );
}
