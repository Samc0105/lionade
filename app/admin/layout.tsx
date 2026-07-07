"use client";

/**
 * Admin Console shell — role gate + sidebar.
 *
 * Renders NOTHING until the caller's role resolves; regular users are
 * redirected to /dashboard (signed-out visitors to /login) without ever
 * seeing a frame of admin UI. This gate is UX only: every /api/admin/*
 * route independently re-verifies the role server-side (lib/admin-auth.ts).
 *
 * Sidebar: Overview + Users for all staff; Audit Log is admin-only.
 * Desktop-focused by design (internal tool).
 */

import { ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useAdminRole } from "@/lib/use-admin-role";
import { ChartBar, Users, ListMagnifyingGlass, ShieldCheck, ShieldWarning, UsersThree, Vault, Flag, Stack, Heartbeat } from "@phosphor-icons/react";
import { CARD_BG, RoleBadge } from "@/components/admin/shared";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading: authLoading } = useAuth();
  const { role, isStaff, isAdmin, loading: roleLoading } = useAdminRole();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!roleLoading && !isStaff) {
      router.replace("/dashboard");
    }
  }, [authLoading, user, roleLoading, isStaff, router]);

  // Hard gate: no admin chrome renders for anyone unverified.
  if (authLoading || !user || roleLoading || !isStaff) return null;

  const navItems = [
    { href: "/admin", label: "Overview", Icon: ChartBar, exact: true },
    { href: "/admin/users", label: "Users", Icon: Users, exact: false },
    ...(isAdmin
      ? [
          { href: "/admin/audit", label: "Audit Log", Icon: ListMagnifyingGlass, exact: false },
          { href: "/admin/security", label: "Security", Icon: ShieldWarning, exact: false },
          { href: "/admin/team", label: "Team", Icon: UsersThree, exact: false },
          { href: "/admin/features", label: "Features", Icon: Flag, exact: false },
          { href: "/admin/health", label: "Systems Health", Icon: Heartbeat, exact: false },
          { href: "/admin/question-bank", label: "Question Bank", Icon: Stack, exact: false },
          { href: "/admin/vault", label: "Vault", Icon: Vault, exact: false },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen pt-24 pb-16 px-6">
      <div className="max-w-7xl mx-auto flex gap-6 items-start">
        {/* Sidebar */}
        <aside
          className="w-56 shrink-0 rounded-2xl border border-white/[0.08] p-4 sticky top-24"
          style={{ background: CARD_BG }}
        >
          <div className="flex items-center gap-2 px-2 mb-4">
            <ShieldCheck size={20} weight="fill" className="text-gold" aria-hidden="true" />
            <span className="font-bebas text-xl tracking-wider text-cream">Admin</span>
            <span className="ml-auto">
              <RoleBadge role={role} />
            </span>
          </div>
          <nav className="flex flex-col gap-1">
            {navItems.map(({ href, label, Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    active
                      ? "bg-white/[0.07] text-cream"
                      : "text-cream/55 hover:text-cream/85 hover:bg-white/[0.04]"
                  }`}
                >
                  <Icon size={17} weight={active ? "fill" : "regular"} aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <p className="mt-6 px-2 text-[11px] leading-relaxed text-cream/35">
            Every action here is written to the audit log.
          </p>
        </aside>

        {/* Page content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
