"use client";

/**
 * /admin/team — team member directory (IAM). ADMIN ONLY.
 *
 * Lists every team_members row from GET /api/admin/team: name, team mailbox,
 * role, Lionade access level, lifecycle status, and when they were invited.
 * Click a row to open the per-member detail + actions at /admin/team/[id].
 * Provisioning a new member links out to /admin/team/new; the team-scoped
 * audit trail is at /admin/team/audit.
 *
 * The layout already hard-gates /admin to staff; this page additionally
 * self-gates to admins (the API returns 403 to support staff) and shows an
 * access note instead of an empty table.
 */

import Link from "next/link";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import type { TeamMember } from "@/lib/team/types";
import { UserPlus, ListMagnifyingGlass } from "@phosphor-icons/react";
import { CARD_BG } from "@/components/admin/shared";

// ── status pill colors (active green / suspended amber / offboarded muted /
//    pending blue), matching the audit-page chip convention. ───────────────
const STATUS_PILL: Record<TeamMember["status"], string> = {
  active: "bg-green-400/15 text-green-300 border-green-400/30",
  suspended: "bg-amber-400/15 text-amber-300 border-amber-400/30",
  offboarded: "bg-white/10 text-cream/45 border-white/15",
  pending: "bg-electric/15 text-electric border-electric/30",
};

// ── access-level pill colors. none = muted; viewer/editor/admin escalate. ──
const ACCESS_PILL: Record<TeamMember["lionade_access"], string> = {
  none: "bg-white/10 text-cream/45 border-white/15",
  viewer: "bg-electric/15 text-electric border-electric/30",
  editor: "bg-purple-400/15 text-purple-300 border-purple-400/30",
  admin: "bg-gold/15 text-gold border-gold/30",
};

function StatusPill({ status }: { status: TeamMember["status"] }) {
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_PILL[status]}`}
    >
      {status}
    </span>
  );
}

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default function AdminTeamPage() {
  const { isAdmin } = useAdminRole();

  const { data, error, isLoading } = useSWR<{ members: TeamMember[] }>(
    isAdmin ? "/api/admin/team" : null,
    swrFetcher,
    { keepPreviousData: true },
  );

  if (!isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        Team management is admin only.
      </div>
    );
  }

  const members = data?.members ?? [];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1">Team</h1>
          <p className="text-sm text-cream/50">
            Everyone with a Lionade mailbox or login. Provisioning, suspension,
            and offboarding all live here.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/admin/team/audit"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 transition-all"
          >
            <ListMagnifyingGlass size={15} aria-hidden="true" /> View audit log
          </Link>
          <Link
            href="/admin/team/new"
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all hover:brightness-110"
            style={{
              background:
                "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
              color: "#04080F",
            }}
          >
            <UserPlus size={15} aria-hidden="true" /> Provision team member
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-5">
          Could not load the team. If migration 20260616121503 has not been run
          yet, run it first.
        </div>
      )}

      {/* Loading skeleton — no flash-of-zero. */}
      {isLoading && !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-2xl bg-white/[0.04] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div
          className="rounded-2xl border border-white/[0.08] overflow-hidden"
          style={{ background: CARD_BG }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-cream/40 border-b border-white/[0.06]">
                <th className="px-4 py-3 font-bold">Member</th>
                <th className="px-4 py-3 font-bold">Team email</th>
                <th className="px-4 py-3 font-bold">Role</th>
                <th className="px-4 py-3 font-bold">Access</th>
                <th className="px-4 py-3 font-bold">Status</th>
                <th className="px-4 py-3 font-bold">Invited</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.04] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/team/${m.id}`} className="block">
                      <span className="font-semibold text-cream">
                        {m.full_name}
                      </span>
                      <div className="text-xs text-cream/40 font-mono">
                        @{m.username}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-cream/60 font-mono text-xs">
                    {m.email_address}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/[0.06] text-cream/70 border border-white/15">
                      {m.role.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${ACCESS_PILL[m.lionade_access]}`}
                    >
                      {m.lionade_access}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-cream/50 text-xs">
                    {fmtDate(m.invited_at)}
                  </td>
                </tr>
              ))}
              {!isLoading && members.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-cream/40">
                    No team members yet. Provision the first one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-cream/35">
        Provisioning mints a real @getlionade.com forwarding mailbox and, when
        access is granted, a Lionade login. Every action is audited.
      </p>
    </div>
  );
}
