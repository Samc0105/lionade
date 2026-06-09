"use client";

/**
 * /admin/users — user search + list. Staff only.
 *
 * Debounced search across email / username / display name / exact UUID via
 * GET /api/admin/users. Emails arrive pre-masked from the server. Click a
 * row to open the full support profile at /admin/users/[id].
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { swrFetcher } from "@/lib/api-client";
import { MagnifyingGlass } from "@phosphor-icons/react";

const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";

interface AdminUserRow {
  id: string;
  username: string | null;
  displayName: string | null;
  emailMasked: string | null;
  role: string;
  coins: number;
  level: number;
  plan: string;
  createdAt: string;
  lastSeen: string | null;
  suspended: boolean;
}

function RoleBadge({ role }: { role: string }) {
  if (role === "user") return <span className="text-cream/40">user</span>;
  const admin = role === "admin";
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
        admin
          ? "bg-gold/15 text-gold border border-gold/30"
          : "bg-electric/15 text-electric border border-electric/30"
      }`}
    >
      {role}
    </span>
  );
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");

  // 350ms debounce so we don't fire a search per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 350);
    return () => clearTimeout(t);
  }, [input]);

  const { data, error, isLoading } = useSWR<{ users: AdminUserRow[] }>(
    `/api/admin/users?q=${encodeURIComponent(q)}`,
    swrFetcher,
    { keepPreviousData: true },
  );

  const users = data?.users ?? [];

  return (
    <div>
      <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1">Users</h1>
      <p className="text-sm text-cream/50 mb-6">
        Search by email, username, display name, or paste a user ID.
      </p>

      <div
        className="flex items-center gap-3 rounded-xl border border-white/[0.08] px-4 py-3 mb-5 focus-within:border-electric/40 transition-colors"
        style={{ background: CARD_BG }}
      >
        <MagnifyingGlass size={18} className="text-cream/40" aria-hidden="true" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search users..."
          autoFocus
          className="flex-1 bg-transparent text-sm text-cream placeholder:text-cream/30 outline-none"
          aria-label="Search users"
        />
        {isLoading && (
          <span className="w-4 h-4 rounded-full border-2 border-cream/20 border-t-cream/60 animate-spin" aria-hidden="true" />
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-5">
          Search failed. If migration 057 has not been run yet, run it first.
        </div>
      )}

      <div
        className="rounded-2xl border border-white/[0.08] overflow-hidden"
        style={{ background: CARD_BG }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-cream/40 border-b border-white/[0.06]">
              <th className="px-4 py-3 font-bold">User</th>
              <th className="px-4 py-3 font-bold">Email</th>
              <th className="px-4 py-3 font-bold">Role</th>
              <th className="px-4 py-3 font-bold text-right">Level</th>
              <th className="px-4 py-3 font-bold text-right">Fangs</th>
              <th className="px-4 py-3 font-bold">Plan</th>
              <th className="px-4 py-3 font-bold">Joined</th>
              <th className="px-4 py-3 font-bold">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                onClick={() => router.push(`/admin/users/${u.id}`)}
                className="border-b border-white/[0.04] last:border-0 cursor-pointer hover:bg-white/[0.04] transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-cream">
                      {u.username ?? "(no username)"}
                    </span>
                    {u.suspended && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-red-400/15 text-red-400 border border-red-400/30">
                        suspended
                      </span>
                    )}
                  </div>
                  {u.displayName && u.displayName !== u.username && (
                    <div className="text-xs text-cream/40">{u.displayName}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-cream/60 font-mono text-xs">
                  {u.emailMasked ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <RoleBadge role={u.role} />
                </td>
                <td className="px-4 py-3 text-right text-cream/70">{u.level}</td>
                <td className="px-4 py-3 text-right text-cream/70">
                  {u.coins.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-cream/60">{u.plan}</td>
                <td className="px-4 py-3 text-cream/50 text-xs">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-cream/50 text-xs">
                  {u.lastSeen ? new Date(u.lastSeen).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-cream/40">
                  No users match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-cream/35">
        Showing up to 25 results, newest accounts first. Emails stay masked here;
        revealing a raw email is an audited admin action on the user page.
      </p>
    </div>
  );
}
