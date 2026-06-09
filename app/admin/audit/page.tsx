"use client";

/**
 * /admin/audit — the audit log viewer. ADMIN ONLY.
 *
 * Who did what to whom and when. Filter by action type or by a user uuid
 * (matches performer OR target). 50 rows per page. The layout hides the
 * sidebar link from support staff; the API returns 403 if they navigate
 * here directly, and we render an access note instead of a broken table.
 */

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "password_reset", label: "Password reset" },
  { value: "fangs_adjust", label: "Fang adjustment" },
  { value: "role_change", label: "Role change" },
  { value: "suspend", label: "Suspend" },
  { value: "unsuspend", label: "Reinstate" },
  { value: "view_email", label: "Email reveal" },
];

const ACTION_COLORS: Record<string, string> = {
  password_reset: "text-electric bg-electric/10 border-electric/30",
  fangs_adjust: "text-gold bg-gold/10 border-gold/30",
  role_change: "text-purple-300 bg-purple-400/10 border-purple-400/30",
  suspend: "text-red-400 bg-red-400/10 border-red-400/30",
  unsuspend: "text-green-300 bg-green-400/10 border-green-400/30",
  view_email: "text-cream/70 bg-white/[0.06] border-white/15",
};

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

export default function AdminAuditPage() {
  const { isAdmin } = useAdminRole();
  const [action, setAction] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [page, setPage] = useState(0);

  const qs = new URLSearchParams();
  if (action) qs.set("action", action);
  if (/^[0-9a-f-]{36}$/i.test(userFilter.trim())) qs.set("user", userFilter.trim());
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
      <div className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center" style={{ background: CARD_BG }}>
        The audit log is admin only.
      </div>
    );
  }

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  return (
    <div>
      <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1">Audit Log</h1>
      <p className="text-sm text-cream/50 mb-6">
        Every admin action: who did what to whom, and when.
      </p>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <select
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(0);
          }}
          className="px-3 py-2.5 rounded-xl border border-white/10 text-sm text-cream outline-none focus:border-electric/40 [&>option]:bg-[#0a1020]"
          style={{ background: CARD_BG }}
          aria-label="Filter by action"
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          value={userFilter}
          onChange={(e) => {
            setUserFilter(e.target.value);
            setPage(0);
          }}
          placeholder="Filter by user ID (performer or target)"
          className="flex-1 px-3 py-2.5 rounded-xl border border-white/10 text-sm text-cream font-mono placeholder:text-cream/25 placeholder:font-sans outline-none focus:border-electric/40"
          style={{ background: CARD_BG }}
          aria-label="Filter by user id"
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-5">
          Could not load the audit log.
        </div>
      )}

      <div
        className="rounded-2xl border border-white/[0.08] overflow-hidden"
        style={{ background: CARD_BG }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-cream/40 border-b border-white/[0.06]">
              <th className="px-4 py-3 font-bold">When</th>
              <th className="px-4 py-3 font-bold">Who</th>
              <th className="px-4 py-3 font-bold">Action</th>
              <th className="px-4 py-3 font-bold">Target</th>
              <th className="px-4 py-3 font-bold">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-white/[0.04] last:border-0">
                <td className="px-4 py-3 text-cream/50 text-xs whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 font-semibold text-cream">
                  {e.performedByName}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`font-mono text-[11px] px-2 py-0.5 rounded border ${
                      ACTION_COLORS[e.action] ?? "text-cream/70 bg-white/[0.06] border-white/15"
                    }`}
                  >
                    {e.action}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {e.targetUserId ? (
                    <Link
                      href={`/admin/users/${e.targetUserId}`}
                      className="text-electric hover:underline"
                    >
                      {e.targetName}
                    </Link>
                  ) : (
                    <span className="text-cream/30">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-cream/50 font-mono max-w-md truncate">
                  {Object.keys(e.metadata ?? {}).length > 0
                    ? JSON.stringify(e.metadata)
                    : "—"}
                </td>
              </tr>
            ))}
            {!isLoading && entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-cream/40">
                  No audit entries match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-cream/40">
          {total.toLocaleString()} entries · page {page + 1} of {lastPage + 1}
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
    </div>
  );
}
