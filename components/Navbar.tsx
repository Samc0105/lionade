"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { useUserStats, useStreakInfo, isStreakExpired, resetExpiredStreak, mutateUserStats } from "@/lib/hooks";
import { formatCoins } from "@/lib/mockData";
import { supabase } from "@/lib/supabase";
import { cdnUrl } from "@/lib/cdn";
import useSWR, { useSWRConfig } from "swr";
import { apiGet, apiPatch } from "@/lib/api-client";
import CountUp from "@/components/CountUp";
import ClockInButton from "@/components/ClockInButton";
import PlanBadge, { UpgradePill } from "@/components/PlanBadge";
import AnimatedUsername from "@/components/AnimatedUsername";
import { useEquippedUsernameEffect } from "@/lib/use-username-effect";
import { usePlan } from "@/lib/use-plan";
import {
  Bell,
  Users,
  Check,
  Envelope,
  EnvelopeOpen,
  Sword,
  Trophy,
  Medal,
  Megaphone,
  Fire,
  Skull,
  Shield,
  House,
  BookOpen,
  Storefront,
  Confetti,
  type Icon,
} from "@phosphor-icons/react";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  action_url: string | null;
  created_at: string;
}

function timeAgoShort(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const NOTIF_ICONS: Record<string, Icon> = {
  friend_request: Users,
  friend_accepted: Check,
  arena_challenge: Sword,
  arena_result: Trophy,
  rank_up: Medal,
  party_invite: Confetti,
};

function StatSkeleton({ width = "w-8" }: { width?: string }) {
  return <span className={`inline-block ${width} h-4 bg-white/10 rounded animate-pulse`} />;
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/academia", label: "Academia" },
  { href: "/learn", label: "Learn" },
  { href: "/compete", label: "Compete" },
  { href: "/social", label: "Social" },
  { href: "/games", label: "Arcade" },
  { href: "/shop", label: "Shop" },
];

// SVG icon components for dropdown
function IconUser() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IconMedal() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>; }
function IconWallet() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>; }
function IconSettings() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IconStar() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27l5.15 3.12-1.36-5.89L20 10.5l-5.92-.51L12 4.5 9.92 9.99 4 10.5l4.21 3.99-1.36 5.89L12 17.27z"/></svg>; }
function IconHelp() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>; }
function IconLogOut() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>; }

const DROPDOWN_ITEMS = [
  { href: "/profile", label: "Profile", Icon: IconUser, color: "rgba(74,144,217,0.15)", textColor: "text-electric" },
  { href: "/badges", label: "Badges", Icon: IconMedal, color: "rgba(251,191,36,0.15)", textColor: "text-amber-400" },
  { href: "/wallet", label: "Wallet / Rewards", Icon: IconWallet, color: "rgba(168,85,247,0.15)", textColor: "text-purple-400" },
  { href: "/settings/subscription", label: "Subscription", Icon: IconStar, color: "rgba(255,215,0,0.15)", textColor: "text-gold" },
  { href: "/settings", label: "Settings", Icon: IconSettings, color: "rgba(156,163,175,0.15)", textColor: "text-gray-400" },
  { href: "/contact", label: "Help / Support", Icon: IconHelp, color: "rgba(34,197,94,0.15)", textColor: "text-green-400" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { stats, mutate: mutateStats } = useUserStats(user?.id);
  const { plan: userPlan, isPaid } = usePlan();
  // Shop V2: drives the dropdown's username display. Safe if backend route
  // /api/cosmetics/owned hasn't shipped yet — falls back to "none" silently.
  const usernameEffect = useEquippedUsernameEffect();
  // Global SWR mutate — used by the notifications realtime channel to also
  // revalidate the Social page's friends/pending hook the instant a
  // friend-request (or accept) notification lands, instead of waiting for
  // that page's poll. Keeps the pending-requests list ~realtime.
  const { mutate: globalMutate } = useSWRConfig();

  // DiceBear avatar URL — pulled from the profile row via useUserStats,
  // with a fallback to the auth user record while stats are loading.
  // Perf 2026-05-17 (P3): memoized (mirrors app/profile/page.tsx) so `<img
  // src>` stays referentially stable across renders → no avatar hard-reload
  // / flash on tab return or unrelated state changes.
  const avatarUrl = useMemo(
    () => stats?.avatar ?? user?.avatar ?? "",
    [stats?.avatar, user?.avatar],
  );
  const { streakInfo, mutateStreakInfo } = useStreakInfo(user?.id);
  const [streakResetDone, setStreakResetDone] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownClosing, setDropdownClosing] = useState(false);

  const closeDropdown = () => {
    setDropdownClosing(true);
    setTimeout(() => {
      setShowDropdown(false);
      setDropdownClosing(false);
    }, 200);
  };

  const toggleDropdown = () => {
    if (showDropdown) closeDropdown();
    else setShowDropdown(true);
  };
  const [showStreakModal, setShowStreakModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const prevUnreadRef = useRef<number | null>(null);

  // framer-motion: respect reduced-motion preference for both micro-anims.
  const reduceMotion = useReducedMotion();

  // Bell bounce trigger — increments each time unreadCount goes UP, used as
  // a `key` on the motion.div so React re-mounts and re-runs the animation.
  // Skips the initial null -> number hydration transition (see effect below).
  const [bellBounceKey, setBellBounceKey] = useState(0);

  // Fangs +N pop — track previous coin value, push deltas into a small queue
  // of {id, amount} entries that AnimatePresence renders + reaps on exit.
  const prevCoinsRef = useRef<number | null>(null);
  const [coinPops, setCoinPops] = useState<Array<{ id: number; amount: number }>>([]);

  // 2026-05-25 (Phase A perf): manual setInterval(15s) → shared SWR hook.
  // Key is intentionally generic (`notifications/${user.id}`) so the Social
  // page reuses the SAME cache + poll (previously they were on separate
  // keys, doubling the API hit). Local `notifications` + `unreadCount`
  // state stay because they're mutated optimistically on mark-as-read;
  // SWR hydrates them via onSuccess. `loadNotifications` is kept as a
  // mutate-backed revalidator so the realtime INSERT channel and
  // openNotifPanel call sites need no changes.
  const notificationsKey = user?.id ? `notifications/${user.id}` : null;
  const { mutate: mutateNotifications } = useSWR(
    notificationsKey,
    () =>
      apiGet<{ notifications: Notification[]; unreadCount: number }>(
        "/api/notifications",
      ),
    {
      refreshInterval: 15000,
      revalidateOnFocus: true,
      keepPreviousData: true,
      onSuccess: (res) => {
        if (!res.ok || !res.data) return;
        if (res.data.notifications) setNotifications(res.data.notifications);
        if (typeof res.data.unreadCount === "number") {
          setUnreadCount(res.data.unreadCount);
        }
      },
    },
  );
  const loadNotifications = useCallback(async () => {
    await mutateNotifications();
  }, [mutateNotifications]);

  // Bounce the bell when unreadCount increases (new notif arrived). Skips the
  // initial null -> number hydration transition so we don't bounce on first
  // paint. framer-motion's useReducedMotion silences the actual animation —
  // we still bump the key (cheap), but the motion.div will not animate.
  useEffect(() => {
    const prev = prevUnreadRef.current;
    if (prev !== null && unreadCount !== null && unreadCount > prev) {
      setBellBounceKey(k => k + 1);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  // Pop a "+N" chip above the Fangs pill whenever the displayed value goes
  // UP. We compare against the same source the Fangs pill renders (stats →
  // user fallback), and skip the initial null -> number hydration so we don't
  // pop on first paint. Each pop has a unique id so AnimatePresence can
  // exit-animate prior chips while a fresh one mounts.
  const displayedCoins =
    stats?.coins ?? user?.coins ?? null;
  useEffect(() => {
    if (typeof displayedCoins !== "number") return;
    const prev = prevCoinsRef.current;
    if (prev !== null && displayedCoins > prev) {
      const delta = displayedCoins - prev;
      const id = Date.now() + Math.random();
      setCoinPops(p => [...p, { id, amount: delta }]);
      // Reap after the exit animation finishes (600ms anim + small buffer).
      window.setTimeout(() => {
        setCoinPops(p => p.filter(x => x.id !== id));
      }, 900);
    }
    prevCoinsRef.current = displayedCoins;
  }, [displayedCoins]);

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!user?.id) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`notifs-${user.id}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        }, (payload: any) => {
          loadNotifications();
          // Friend-graph notifications (a request arrived for me, or someone
          // accepted my request) mean the Social page's friends/pending list
          // is now stale. Invalidate its SWR key so the pending-requests list
          // (recipient) and friends list (sender, on accept) update in ~1s
          // instead of waiting for that page's poll interval.
          const type = payload?.new?.type;
          if (type === "friend_request" || type === "friend_accepted") {
            globalMutate(`social-friends/${user.id}`);
          }
        })
        .subscribe();
    } catch { /* ignore if table doesn't exist */ }
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [user?.id, loadNotifications, globalMutate]);

  // Toggle the notification panel. Audit 2026-06-05 Bucket C #3 — the panel
  // USED to auto-mark-everything-as-read on open. That was destructive: a user
  // who wanted to come back to an interesting notif later would lose the unread
  // affordance the moment they peeked at the dropdown. Now the panel opens
  // read-only; the user marks rows individually (per-row toggle) or all at once
  // ("Mark all read" button in the panel header).
  const openNotifPanel = useCallback(() => {
    setShowNotifPanel(prev => !prev);
  }, []);

  // Per-row read-state toggle (Bucket C #3). Optimistic: flip the visual
  // immediately, fire the PATCH in the background, revert on failure. Extended
  // /api/notifications PATCH accepts { id, read: bool }; ownership is enforced
  // server-side by user_id scoping so a forged id can't mutate someone else's
  // notification.
  const toggleNotifRead = useCallback(async (id: string, nextRead: boolean) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: nextRead } : n));
    setUnreadCount(prev => {
      if (prev === null) return prev;
      // If we just marked-read: prev - 1 (clamped). If we just marked-unread: prev + 1.
      return nextRead ? Math.max(0, prev - 1) : prev + 1;
    });
    const res = await apiPatch("/api/notifications", { id, read: nextRead });
    if (!res.ok) {
      // Revert optimistic update.
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: !nextRead } : n));
      setUnreadCount(prev => {
        if (prev === null) return prev;
        return nextRead ? prev + 1 : Math.max(0, prev - 1);
      });
    }
  }, []);

  // Mark-all-read button (Bucket C #3). Explicit user action — no longer
  // auto-fired on panel open.
  const markAllRead = useCallback(async () => {
    if ((unreadCount ?? 0) === 0) return;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    const res = await apiPatch("/api/notifications", { all: true });
    if (!res.ok) {
      // Best-effort revert: re-fetch so the cache reflects server truth.
      void loadNotifications();
    }
  }, [unreadCount, loadNotifications]);

  // Close notif panel on outside click
  useEffect(() => {
    function handleNotifOutside(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifPanel(false);
      }
    }
    document.addEventListener("mousedown", handleNotifOutside);
    return () => document.removeEventListener("mousedown", handleNotifOutside);
  }, []);

  const isComingSoon = pathname === "/";
  const isLanding = pathname === "/home";
  const isLogin = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";

  // Defer auth-driven render to after hydration. useAuth seeds from
  // localStorage on the client, so the SSR pass renders the signed-out
  // shell but the first client render renders the full navbar with all
  // its <Link>s — guaranteed mismatch without this gate.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const showAppNav = mounted && !!user && !isComingSoon && !isLanding && !isLogin && !isOnboarding;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDropdown]);

  // Close dropdown / streak modal on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDropdown();
        setShowStreakModal(false);
      }
    }
    if (showDropdown || showStreakModal) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showDropdown, showStreakModal]);

  // Streak countdown timer
  const [streakTimeLeft, setStreakTimeLeft] = useState("");
  const [streakUrgent, setStreakUrgent] = useState(false);

  useEffect(() => {
    if (!streakInfo?.lastQuizAt) return;
    function calc() {
      const expires = new Date(streakInfo!.lastQuizAt!).getTime() + 36 * 60 * 60 * 1000;
      const diff = expires - Date.now();
      if (diff <= 0) {
        setStreakTimeLeft("Expired");
        setStreakUrgent(true);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setStreakTimeLeft(`${h}h ${m}m`);
      setStreakUrgent(h < 6);
    }
    calc();
    const iv = setInterval(calc, 60000);
    return () => clearInterval(iv);
  }, [streakInfo?.lastQuizAt]);

  // Reset expired streak in the database on page load
  useEffect(() => {
    if (!user?.id || !streakInfo || streakResetDone) return;
    if (!isStreakExpired(streakInfo.lastQuizAt)) return;
    // Only reset if streak is currently > 0 in the DB
    const currentStreak = stats?.streak ?? 0;
    if (currentStreak === 0) {
      setStreakResetDone(true);
      return;
    }
    setStreakResetDone(true);
    resetExpiredStreak(user.id).then(() => {
      // Revalidate both caches so UI shows 0 everywhere
      mutateStats();
      mutateStreakInfo();
      mutateUserStats(user.id);
    });
  }, [user?.id, streakInfo, stats?.streak, streakResetDone, mutateStats, mutateStreakInfo]);

  const handleLogout = async () => {
    await logout();
    setShowDropdown(false);
    router.push("/");
  };

  const isTabActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/learn") return pathname === "/learn" || pathname === "/quiz";
    if (href === "/compete") return (pathname?.startsWith("/compete") ?? false) || pathname === "/leaderboard";
    if (href === "/shop") return pathname === "/shop";
    return pathname === href;
  };

  // Hide navbar entirely on coming soon page and onboarding
  if (isComingSoon || isOnboarding) return null;

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 border-b border-electric/20 backdrop-blur-md"
        style={{ background: "rgba(4, 8, 15, 0.9)" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-12">
            {/* Logo — wrapper carries an extra `nav-logo-link` class so the
                shared glow keyframe intensifies on hover (gold-tinted), and the
                whole brand mark lifts 1px without thrashing layout (pure GPU
                transform). prefers-reduced-motion strips the transform in CSS. */}
            <Link href="/dashboard" className="nav-logo-link flex items-center">
              <div className="relative overflow-hidden rounded-md logo-glow sm:hidden">
                <img src={cdnUrl("/logo-icon.png")} alt="Lionade" className="h-8 rounded-md relative z-10" />
                <div className="logo-shimmer" />
              </div>
              <div className="relative overflow-hidden rounded-md logo-glow hidden sm:block">
                <img src={cdnUrl("/logo-full.png")} alt="Lionade" className="h-9 rounded-md relative z-10" />
                <div className="logo-shimmer" />
              </div>
            </Link>

            {/* Desktop Tabs — limelight slider mirrors the mobile bottom-nav
                vocabulary: a shared-layoutId electric backdrop + thin top beam
                travel between tabs as pathname changes. Active state is
                pathname-driven (SSR & first client render render the same tree)
                so layoutId animates the position between renders without any
                DOM measurement. Reduced-motion: transitions collapse to 0. */}
            {showAppNav && (
              <div className="hidden md:flex items-center gap-1">
                {NAV_LINKS.map((link) => {
                  const active = isTabActive(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors duration-200
                        ${active
                          ? "text-electric"
                          : "hover:bg-white/5"
                        }`}
                      style={active ? {} : { color: "var(--nav-text)" }}
                    >
                      {active && (
                        <>
                          <motion.span
                            layoutId="navLimelightDesktop"
                            aria-hidden="true"
                            className="absolute inset-0 rounded-lg bg-electric/12 border border-electric/25"
                            style={{ boxShadow: "0 0 14px -6px rgba(74,144,217,0.55), inset 0 0 0 1px rgba(74,144,217,0.05)" }}
                            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                          />
                          <motion.span
                            layoutId="navLimelightDesktopBeam"
                            aria-hidden="true"
                            className="absolute -bottom-px inset-x-2 h-[2px] rounded-full bg-electric shadow-[0_0_10px_-2px_rgba(74,144,217,0.7)]"
                            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                          />
                        </>
                      )}
                      <span className="relative z-10">{link.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Landing links (not logged in) */}
            {isLanding && (
              <div className="hidden md:flex items-center gap-1">
                {[
                  { href: "#how-it-works", label: "How It Works" },
                  { href: "#features", label: "Features" },
                  { href: "#about", label: "About" },
                ].map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-white/5 transition-all duration-200"
                    style={{ color: "var(--nav-text)" }}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}

            {/* Right Section
                Unified silhouette: every non-avatar element settles at h-8 +
                rounded-full so the rhythm reads as a single row of equal
                pills. Static info pills (Fangs, Streak) share the same neutral
                bg / border treatment — only the icon color differentiates
                them. ClockIn keeps its gold animation as the lone CTA. */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {showAppNav && user && (
                <>
                  {/* Coin Pill — neutral pill with gold Fangs icon. Hosts the
                      animated +N chip absolutely above it. */}
                  <div className="relative hidden sm:block">
                    <Link
                      href="/wallet"
                      aria-label="Fangs balance — open wallet"
                      className="h-8 inline-flex items-center gap-1.5 rounded-full px-3
                        bg-white/[0.04] border border-white/[0.08]
                        cursor-pointer transition-colors duration-200
                        hover:bg-white/[0.07] hover:border-white/[0.14] active:scale-[0.97]"
                    >
                      <img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" />
                      <span className="font-bebas text-[15px] text-gold tracking-wider leading-none tabular-nums">
                        {stats
                          ? <CountUp id="user-coins" value={stats.coins} format={formatCoins} />
                          : user.statsLoaded
                            ? <CountUp id="user-coins" value={user.coins} format={formatCoins} />
                            : <CountUp id="user-coins" value={user.coins ?? 0} format={formatCoins} />}
                      </span>
                      {isPaid && (
                        // Quiet confirmation that the marketed Fang multiplier is live on this account.
                        <span
                          className="ml-1 px-1.5 py-px rounded-full text-[10px] font-bebas tracking-wider leading-none bg-gold/15 text-gold/90 border border-gold/25"
                          title={`${userPlan === "platinum" ? "2" : "1.5"}x Fang boost active`}
                        >
                          {userPlan === "platinum" ? "+2x" : "+1.5x"}
                        </span>
                      )}
                    </Link>

                    {/* +N pop — absolutely positioned above the pill so it
                        doesn't shift any layout. AnimatePresence reaps each
                        chip after exit. Reduced-motion: skip transition. */}
                    <div
                      className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-1 z-10"
                      aria-hidden="true"
                    >
                      <AnimatePresence>
                        {coinPops.map(pop => (
                          <motion.span
                            key={pop.id}
                            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
                            transition={
                              reduceMotion
                                ? { duration: 0 }
                                : { duration: 0.6, ease: [0.16, 1, 0.3, 1] }
                            }
                            className="absolute left-1/2 -translate-x-1/2 -top-1 whitespace-nowrap
                              font-bebas text-[15px] tracking-wider text-gold leading-none tabular-nums"
                            style={{ textShadow: "0 0 10px rgba(255,215,0,0.55)" }}
                          >
                            +{pop.amount}
                          </motion.span>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Streak Pill — same shell as Fangs. Tier colors the flame +
                      numeral so a glance reads the milestone: orange (default),
                      gold (>=7), purple (>=30), electric (>=100). When the
                      streak is "alive today" (any quiz in the 36h window) the
                      icon picks up a subtle drop-shadow glow — pure GPU,
                      reduced-motion safe (no keyframes, just a static filter). */}
                  {(() => {
                    const expired = isStreakExpired(streakInfo?.lastQuizAt ?? null);
                    const displayedStreak = expired
                      ? 0
                      : (stats?.streak ?? user.streak ?? 0);
                    const aliveToday = !!streakInfo?.lastQuizAt && !expired
                      && (Date.now() - new Date(streakInfo.lastQuizAt).getTime()) < 24 * 60 * 60 * 1000;
                    const tier =
                      displayedStreak >= 100 ? "electric"
                      : displayedStreak >= 30 ? "purple"
                      : displayedStreak >= 7 ? "gold"
                      : "orange";
                    const tierColor =
                      tier === "electric" ? "#4A90D9"
                      : tier === "purple" ? "#A855F7"
                      : tier === "gold" ? "#FFD700"
                      : "#FB923C";
                    const tierTextClass =
                      tier === "electric" ? "text-electric"
                      : tier === "purple" ? "text-purple-400"
                      : tier === "gold" ? "text-gold"
                      : "text-orange-400";
                    return (
                      <button
                        onClick={() => setShowStreakModal(true)}
                        aria-label={`Streak${displayedStreak ? ` — ${displayedStreak} days` : ""}`}
                        className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-full px-3
                          bg-white/[0.04] border border-white/[0.08]
                          cursor-pointer group relative transition-colors duration-200
                          hover:bg-white/[0.07] hover:border-white/[0.14] active:scale-[0.97]"
                      >
                        <Fire
                          size={14}
                          weight="fill"
                          color={tierColor}
                          aria-hidden="true"
                          style={aliveToday && !reduceMotion
                            ? { filter: `drop-shadow(0 0 6px ${tierColor}aa)` }
                            : undefined}
                        />
                        <span className={`font-bebas text-[15px] tracking-wider leading-none tabular-nums ${tierTextClass}`}>
                          {stats !== null
                            ? <CountUp id="user-streak" value={displayedStreak} duration={400} />
                            : user.statsLoaded
                              ? <CountUp id="user-streak" value={displayedStreak} duration={400} />
                              : <CountUp id="user-streak" value={user.streak ?? 0} duration={400} />}
                        </span>
                        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-navy-100
                          border border-electric/20 text-xs text-cream/70 opacity-0 group-hover:opacity-100
                          transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                          Streak
                        </div>
                      </button>
                    );
                  })()}

                  {/* Notification Bell — icon-only square pill, h-8 w-8 to
                      match the row. Bell wrapped in a motion.div that bounces
                      on each new arrival via the bellBounceKey re-mount. Hover
                      adds a tiny rotate "wiggle" via `nav-bell-wiggle` (CSS
                      keyframe, GPU-only, prefers-reduced-motion safe). Unread
                      badge: gold-tinted pill with Bebas numeral up to 9, then
                      collapses to a "9+" affordance to keep the pill compact. */}
                  <div className="relative hidden sm:block" ref={notifRef}>
                    <button
                      onClick={openNotifPanel}
                      aria-label={`Notifications${(unreadCount ?? 0) > 0 ? ` (${unreadCount} unread)` : ""}`}
                      className="nav-bell-btn relative h-8 w-8 grid place-items-center rounded-full
                        bg-white/[0.04] border border-white/[0.08]
                        hover:bg-white/[0.07] hover:border-white/[0.14] transition-colors duration-200"
                    >
                      <motion.div
                        key={bellBounceKey}
                        initial={false}
                        animate={
                          bellBounceKey === 0 || reduceMotion
                            ? { scale: 1 }
                            : { scale: [1, 1.2, 1] }
                        }
                        transition={
                          reduceMotion
                            ? { duration: 0 }
                            : { duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }
                        }
                        className="nav-bell-wiggle inline-flex text-cream/85"
                        aria-hidden="true"
                      >
                        <Bell size={16} weight={(unreadCount ?? 0) > 0 ? "fill" : "regular"} color="currentColor" />
                      </motion.div>
                      {(unreadCount ?? 0) > 0 && (
                        <span
                          className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full flex items-center justify-center px-1
                            font-bebas text-[10px] tracking-wider leading-none tabular-nums notif-badge-pulse"
                          style={{
                            background: "linear-gradient(135deg, #FFD700, #F0B429)",
                            color: "#0a0f1d",
                            boxShadow: "0 0 8px rgba(255,215,0,0.45)",
                          }}
                          aria-hidden="true"
                        >
                          {(unreadCount ?? 0) > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </button>
                    {/* Screen-reader live region announces unread count changes. */}
                    <span className="sr-only" aria-live="polite" aria-atomic="true">
                      {(unreadCount ?? 0) > 0 ? `${unreadCount} unread notifications` : ""}
                    </span>

                    {/* Notification Dropdown
                        Audit 2026-06-05 Bucket C #3 + Bucket A finding —
                        Gmail/Slack model: opening the panel no longer auto-
                        marks-all-read. Each row carries its own mark-read /
                        mark-unread toggle on the right; a "Mark all read"
                        button sits in the panel header. Unread rows wash gold
                        across the full body instead of carrying a 2px left
                        stripe (Bucket A: "read state is a 2px left stripe
                        only"). */}
                    {showNotifPanel && (
                      <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-xl z-50"
                        style={{
                          background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                        }}>
                        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
                          <p className="font-bebas text-sm text-cream tracking-wider">NOTIFICATIONS</p>
                          {(unreadCount ?? 0) > 0 && (
                            <button
                              onClick={markAllRead}
                              className="text-[10px] font-bold text-electric hover:text-electric-light transition-colors uppercase tracking-wider"
                              aria-label={`Mark all ${unreadCount} notifications as read`}
                            >
                              Mark all read
                            </button>
                          )}
                        </div>
                        {notifications.length === 0 ? (
                          <div className="py-8 text-center px-4">
                            <p className="text-cream/55 text-xs mb-1">You&apos;re all caught up</p>
                            <p className="text-cream/30 text-[10px]">New activity will show up here.</p>
                          </div>
                        ) : (
                          notifications.map(n => (
                            <div
                              key={n.id}
                              className="w-full px-4 py-3 flex items-start gap-3 hover:bg-white/[0.04] transition-colors group/notif"
                              style={!n.read
                                ? { background: "rgba(255,215,0,0.05)", borderLeft: "2px solid #FFD700" }
                                : { borderLeft: "2px solid transparent" }}
                            >
                              {(() => {
                                const NotifIcon = NOTIF_ICONS[n.type] ?? Megaphone;
                                return (
                                  <NotifIcon
                                    size={18}
                                    weight="regular"
                                    className="flex-shrink-0 mt-0.5"
                                    color="currentColor"
                                    aria-hidden="true"
                                  />
                                );
                              })()}
                              <button
                                onClick={() => {
                                  setShowNotifPanel(false);
                                  if (n.action_url) router.push(n.action_url);
                                  // Implicitly mark-read on navigation — same
                                  // behavior every notification UI converges
                                  // on (you read it by going to the linked
                                  // surface). No-ops if already read.
                                  if (!n.read) void toggleNotifRead(n.id, true);
                                }}
                                className="flex-1 min-w-0 text-left"
                                aria-label={n.title}
                              >
                                <p className={`text-xs font-semibold truncate ${n.read ? "text-cream/60" : "text-cream"}`}>
                                  {n.title}
                                </p>
                                {n.message && (
                                  <p className="text-[10px] text-cream/55 mt-0.5 truncate">{n.message}</p>
                                )}
                                <p className="text-[9px] text-cream/55 mt-1">{timeAgoShort(n.created_at)}</p>
                              </button>
                              {/* Per-row mark-read / mark-unread toggle. Icon
                                  doubles as state: solid envelope = unread,
                                  open envelope = read. Click flips. Hidden
                                  by default on the row; revealed on row hover
                                  so the dropdown stays calm at idle. */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void toggleNotifRead(n.id, !n.read);
                                }}
                                className="flex-shrink-0 mt-0.5 p-1 rounded-full opacity-0 group-hover/notif:opacity-100 focus:opacity-100 hover:bg-white/10 transition-all"
                                aria-label={n.read ? "Mark as unread" : "Mark as read"}
                                title={n.read ? "Mark as unread" : "Mark as read"}
                              >
                                {n.read
                                  ? <Envelope size={14} weight="regular" className="text-cream/55" aria-hidden="true" />
                                  : <EnvelopeOpen size={14} weight="fill" className="text-gold" aria-hidden="true" />}
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* CTA Button — Daily check-in. Claims Fangs via the
                      existing /api/login-bonus escalating reward (10/15/25
                      tier) rather than linking to the quiz page. Showing
                      up IS the reward — quiz entry is one tab click away
                      via the Learn nav item. */}
                  <ClockInButton />

                  {/* Subscription plan chip — only renders for paid users.
                      Free users get an Upgrade pill instead (hidden on
                      small screens to avoid pushing the avatar off). */}
                  {isPaid
                    ? <PlanBadge />
                    : <UpgradePill className="hidden lg:inline-flex" />
                  }

                  {/* Avatar + Dropdown — paired ring: a subtle electric inner
                      ring (always on) + a gold halo that fades in on hover or
                      when the dropdown is open. Whole pill nudges 1px up on
                      hover (GPU transform, reduced-motion CSS strips it). */}
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={toggleDropdown}
                      aria-label={`${user.username} — open menu`}
                      aria-expanded={showDropdown}
                      data-open={showDropdown ? "true" : "false"}
                      className="nav-avatar-btn w-8 h-8 rounded-full overflow-hidden
                        cursor-pointer flex-shrink-0 transition-transform duration-200"
                      style={{ backgroundColor: "rgba(74, 144, 217, 0.25)" }}
                    >
                      <img src={avatarUrl} alt={user.username} className="w-8 h-8 rounded-full object-cover" />
                    </button>

                    {showDropdown && (
                      <>
                        {/* Backdrop — blurs the page behind the avatar menu so the menu reads
                            as a focused modal surface. Click anywhere outside to dismiss.
                            Fades in/out on the same 200ms curve as the dropdown panel itself
                            via .dropdown-backdrop-enter / .dropdown-backdrop-exit, so they
                            appear and leave together. prefers-reduced-motion falls back to a
                            plain dim layer with no blur (see globals.css). */}
                        <div
                          className={`fixed inset-0 z-40 dropdown-backdrop
                            ${dropdownClosing ? "dropdown-backdrop-exit" : "dropdown-backdrop-enter"}`}
                          onClick={closeDropdown}
                          aria-hidden="true"
                        />

                        {/* Dropdown panel — scales from top-right so it reads as opening
                            FROM the avatar, not from nowhere. */}
                        <div
                          className={`absolute right-0 top-12 w-[280px] rounded-2xl z-50 overflow-hidden origin-top-right
                            ${dropdownClosing ? "dropdown-menu-exit" : "dropdown-menu-enter"}`}
                          style={{
                            background: "linear-gradient(135deg, rgba(12,16,32,0.98), rgba(8,12,24,0.98))",
                            border: "1px solid rgba(255,255,255,0.1)",
                            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
                            transformOrigin: "top right",
                          }}
                        >
                          {/* ── User info header ── */}
                          <div
                            className={`px-5 pt-5 pb-4 ${dropdownClosing ? "dropdown-item-exit" : "dropdown-item-enter"}`}
                            style={{ animationDelay: "0ms" }}
                          >
                            <div className="flex items-center gap-3.5">
                              <div
                                className="w-12 h-12 rounded-full overflow-hidden border-2 border-electric/50 flex-shrink-0"
                                style={{ boxShadow: "0 0 16px rgba(74,144,217,0.2)" }}
                              >
                                <img src={avatarUrl} alt={user.username} className="w-12 h-12 rounded-full object-cover" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-cream font-bold text-[15px] truncate">
                                  <AnimatedUsername username={user.username} effect={usernameEffect} size="md" />
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-gold text-xs font-semibold">
                                    {stats ? `Level ${stats.level}` : user.statsLoaded ? `Level ${user.level}` : <StatSkeleton width="w-10" />}
                                  </span>
                                  <span className="text-cream/55">·</span>
                                  <span className="text-cream/60 text-xs">
                                    {stats ? `${stats.xp.toLocaleString()} XP` : user.statsLoaded ? `${user.xp.toLocaleString()} XP` : <StatSkeleton width="w-10" />}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* ── Divider ── */}
                          <div className="mx-4 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />

                          {/* ── Menu items ── */}
                          <div className="px-2 py-2">
                            {DROPDOWN_ITEMS.map((item, i) => (
                              <Link key={item.label} href={item.href} onClick={closeDropdown}>
                                <div
                                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-cream/60
                                    hover:text-cream hover:bg-white/[0.06] transition-all duration-200 cursor-pointer
                                    ${dropdownClosing ? "dropdown-item-exit" : "dropdown-item-enter"}`}
                                  style={{ animationDelay: dropdownClosing ? "0ms" : `${(i + 1) * 40}ms` }}
                                >
                                  <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                    style={{ background: item.color }}
                                  >
                                    <span className={item.textColor}><item.Icon /></span>
                                  </div>
                                  <span className="font-medium">{item.label}</span>
                                </div>
                              </Link>
                            ))}
                          </div>

                          {/* ── Divider ── */}
                          <div className="mx-4 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />

                          {/* ── Logout ── */}
                          <div className="px-2 py-2">
                            <button
                              onClick={handleLogout}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-400/80
                                hover:text-red-400 hover:bg-red-500/[0.08] transition-all duration-200
                                ${dropdownClosing ? "dropdown-item-exit" : "dropdown-item-enter"}`}
                              style={{ animationDelay: dropdownClosing ? "0ms" : `${(DROPDOWN_ITEMS.length + 1) * 40}ms` }}
                            >
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ background: "rgba(239,68,68,0.1)" }}
                              >
                                <IconLogOut />
                              </div>
                              <span className="font-medium">Log Out</span>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Not logged in — show on /home and other non-login pages, hide on coming soon (has its own top bar) */}
              {!user && !isLogin && !isComingSoon && (
                <div className="flex items-center gap-2">
                  <Link href="/login"
                    className="hidden sm:block btn-outline text-sm py-1.5 px-4">
                    Log In
                  </Link>
                  <Link
                    href="/login"
                    className={`text-sm py-1.5 px-4 rounded-xl font-bold transition-all duration-200 ${isLanding ? "btn-gold" : "btn-primary"}`}
                  >
                    Start Free
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Streak Modal */}
      {showStreakModal && (() => {
        const expired = isStreakExpired(streakInfo?.lastQuizAt ?? null);
        const streak = expired ? 0 : (stats?.streak ?? user?.streak ?? 0);
        const goal = 10;
        const questionsToday = Math.min(streakInfo?.questionsToday ?? 0, goal);
        const progress = questionsToday / goal;
        const message = expired
          ? "Your streak has expired. Start a new one today."
          : streak === 0 ? "Start your streak today!" :
          streak <= 2 ? "Great start. Keep it going!" :
          streak <= 6 ? "You're building momentum!" :
          streak <= 13 ? "Impressive dedication!" :
          streak <= 29 ? "You're on fire! Don't stop now!" :
          "Legendary streak, absolute beast!";
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" onClick={() => setShowStreakModal(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-sm rounded-2xl border border-orange-500/20 p-6 animate-slide-up"
              style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Icon + Streak Number — illustration tiers up at 7 / 30 / 100 days */}
              <div className="text-center mb-4">
                {expired ? (
                  <>
                    <Skull size={64} weight="fill" color="#F87171" className="mx-auto mb-2" style={{ filter: "drop-shadow(0 0 20px rgba(220,38,38,0.4))" }} aria-hidden="true" />
                    <h2 className="font-bebas text-4xl text-red-400 tracking-wider">
                      Streak Lost!
                    </h2>
                  </>
                ) : (
                  <>
                    {streak >= 7 ? (
                      <img
                        src={`/illustrations/${streak >= 100 ? "streak-100-day" : streak >= 30 ? "streak-30-day" : "streak-7-day"}.png`}
                        alt=""
                        width={96}
                        height={96}
                        className="w-24 h-24 object-contain mx-auto mb-2"
                        style={{ filter: "drop-shadow(0 0 20px rgba(249,115,22,0.5))" }}
                        aria-hidden="true"
                      />
                    ) : (
                      <Fire size={64} weight="fill" color="#FB923C" className="mx-auto mb-2" style={{ filter: "drop-shadow(0 0 20px rgba(249,115,22,0.5))" }} aria-hidden="true" />
                    )}
                    <h2 className="font-bebas text-4xl text-cream tracking-wider">
                      Day {streak} Streak!
                    </h2>
                  </>
                )}
                <p className="text-cream/50 text-sm mt-1">{message}</p>
              </div>

              {/* Progress Bar or Daily Goal Crushed — hide when expired */}
              {!expired && (
                questionsToday >= goal ? (
                  <div className="mb-4 text-center py-3">
                    <p className="text-orange-400 font-bold text-lg inline-flex items-center gap-1.5"><Fire size={20} weight="fill" aria-hidden="true" /> Daily goal crushed!</p>
                    <p className="text-cream/60 text-xs mt-1">You&apos;re all caught up. Come back tomorrow to keep your streak alive.</p>
                  </div>
                ) : (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs text-cream/60 mb-1.5">
                      <span>Today&apos;s progress</span>
                      <span className="text-orange-400 font-bold">{questionsToday}/{goal} questions</span>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${progress * 100}%`,
                          background: "linear-gradient(90deg, #f97316, #fbbf24)",
                          boxShadow: "0 0 10px rgba(249,115,22,0.4)",
                        }}
                      />
                    </div>
                  </div>
                )
              )}

              {/* Countdown — only show when active, not expired */}
              {!expired && streakInfo?.lastQuizAt && (
                <div className={`text-center text-sm mb-4 font-mono ${streakUrgent ? "text-red-400" : "text-cream/50"}`}>
                  Streak expires in <span className="font-bold">{streakTimeLeft}</span>
                </div>
              )}

              {/* Streak Shield — only when not expired */}
              {!expired && streakInfo?.hasStreakShield && (
                <div className="flex items-center justify-center gap-2 mb-4 py-2 px-3 rounded-xl"
                  style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
                  <Shield size={16} weight="fill" color="#60A5FA" aria-hidden="true" />
                  <span className="text-blue-400 text-xs font-semibold">Streak Shield Active. Protected for 1 missed day</span>
                </div>
              )}

              {/* Go Study Button */}
              <Link
                href="/learn"
                onClick={() => setShowStreakModal(false)}
                className="block w-full text-center font-syne font-bold text-sm px-4 py-3 rounded-xl transition-all duration-200
                  active:scale-95 text-navy bg-electric hover:bg-electric-light
                  shadow-md shadow-electric/30 hover:shadow-electric/50"
              >
                Go Study
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Mobile Bottom Nav — only when logged in and on app pages */}
      {showAppNav && (
        <div
          className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-electric/20 backdrop-blur-md"
          style={{ background: "rgba(4, 8, 15, 0.95)" }}
        >
          <div className="flex items-center justify-around h-14 px-2">
            {([
              { href: "/dashboard", label: "Home",     Icon: House },
              { href: "/learn",     label: "Learn",    Icon: BookOpen },
              { href: "/compete",   label: "Compete",  Icon: Sword },
              { href: "/shop",      label: "Shop",     Icon: Storefront },
            ] as { href: string; label: string; Icon: Icon }[]).map((item) => {
              const active = isTabActive(item.href);
              const ItemIcon = item.Icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative overflow-hidden flex flex-col items-center gap-0.5 py-1.5 px-4 rounded-lg transition-all duration-200
                    ${active
                      ? "text-electric"
                      : "text-cream/60 hover:text-cream/70"
                    }`}
                >
                  {/* Sliding "limelight" — shared-layout backdrop + thin top
                      beam that travel to the active tab. Rendered ONLY in the
                      active item; framer-motion `layoutId` animates position
                      between tabs post-mount (no useLayoutEffect, no DOM
                      measurement — same hydration-safe technique as the
                      pricing cycle pill). `active` is pathname-driven so the
                      element tree is identical SSR & first client render.
                      aria-hidden: active state already conveyed by the
                      electric text + filled icon. */}
                  {active && (
                    <>
                      <motion.span
                        layoutId="navLimelight"
                        aria-hidden="true"
                        className="absolute inset-x-1 inset-y-0.5 rounded-lg bg-electric/10 border border-electric/20"
                        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                      />
                      <motion.span
                        layoutId="navLimelightBeam"
                        aria-hidden="true"
                        className="absolute top-0 inset-x-3 h-[2px] rounded-full bg-electric shadow-[0_0_10px_-2px_rgba(74,144,217,0.7)]"
                        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                      />
                    </>
                  )}
                  <span className="relative z-10 flex flex-col items-center gap-0.5">
                    <ItemIcon size={20} weight={active ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                    <span className="text-[10px] font-semibold tracking-wide">{item.label}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
