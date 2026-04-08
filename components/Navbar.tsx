"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useUserStats, useStreakInfo, isStreakExpired, resetExpiredStreak, mutateUserStats } from "@/lib/hooks";
import { formatCoins } from "@/lib/mockData";
import { supabase } from "@/lib/supabase";
import { cdnUrl } from "@/lib/cdn";

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

const NOTIF_ICONS: Record<string, string> = {
  friend_request: "\uD83D\uDC65",
  friend_accepted: "\u2705",
  arena_challenge: "\u2694\uFE0F",
  arena_result: "\uD83C\uDFC6",
  rank_up: "\uD83E\uDD47",
};

function StatSkeleton({ width = "w-8" }: { width?: string }) {
  return <span className={`inline-block ${width} h-4 bg-white/10 rounded animate-pulse`} />;
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/learn", label: "Learn" },
  { href: "/compete", label: "Compete" },
  { href: "/social", label: "Social" },
  { href: "/games", label: "Games" },
  { href: "/shop", label: "Shop" },
];

// SVG icon components for dropdown
function IconUser() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IconMedal() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>; }
function IconWallet() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>; }
function IconSettings() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IconHelp() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>; }
function IconLogOut() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>; }

const DROPDOWN_ITEMS = [
  { href: "/profile", label: "Profile", Icon: IconUser, color: "rgba(74,144,217,0.15)", textColor: "text-electric" },
  { href: "/badges", label: "Badges", Icon: IconMedal, color: "rgba(251,191,36,0.15)", textColor: "text-amber-400" },
  { href: "/wallet", label: "Wallet / Rewards", Icon: IconWallet, color: "rgba(168,85,247,0.15)", textColor: "text-purple-400" },
  { href: "/settings", label: "Settings", Icon: IconSettings, color: "rgba(156,163,175,0.15)", textColor: "text-gray-400" },
  { href: "/contact", label: "Help / Support", Icon: IconHelp, color: "rgba(34,197,94,0.15)", textColor: "text-green-400" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { stats, mutate: mutateStats } = useUserStats(user?.id);
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

  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/notifications?userId=${user.id}`);
      if (!res.ok) return; // table may not exist yet
      const data = await res.json();
      if (data.notifications) setNotifications(data.notifications);
      if (typeof data.unreadCount === "number") setUnreadCount(data.unreadCount);
    } catch { /* table may not exist — silently ignore */ }
  }, [user?.id]);

  // Load notifications on mount + poll
  useEffect(() => {
    if (!user?.id) return;
    loadNotifications();
    const iv = setInterval(loadNotifications, 15000);
    return () => clearInterval(iv);
  }, [user?.id, loadNotifications]);

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!user?.id) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`notifs-${user.id}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        }, () => {
          loadNotifications();
        })
        .subscribe();
    } catch { /* ignore if table doesn't exist */ }
    return () => { channel?.unsubscribe(); };
  }, [user?.id, loadNotifications]);

  // Mark all as read when opening panel
  const openNotifPanel = useCallback(async () => {
    setShowNotifPanel(prev => !prev);
    if (!showNotifPanel && user?.id && (unreadCount ?? 0) > 0) {
      try {
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
      } catch { /* ignore */ }
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    }
  }, [showNotifPanel, user?.id, unreadCount]);

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
  const showAppNav = !!user && !isComingSoon && !isLanding && !isLogin && !isOnboarding;

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

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
    router.push("/");
  };

  const isTabActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/learn") return pathname === "/learn" || pathname === "/quiz";
    if (href === "/compete") return pathname === "/compete" || pathname === "/duel" || pathname === "/leaderboard";
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
            {/* Logo */}
            <Link href="/dashboard" className="flex items-center">
              <div className="relative overflow-hidden rounded-md logo-glow sm:hidden">
                <img src={cdnUrl("/logo-icon.png")} alt="Lionade" className="h-8 rounded-md relative z-10" />
                <div className="logo-shimmer" />
              </div>
              <div className="relative overflow-hidden rounded-md logo-glow hidden sm:block">
                <img src={cdnUrl("/logo-full.png")} alt="Lionade" className="h-9 rounded-md relative z-10" />
                <div className="logo-shimmer" />
              </div>
            </Link>

            {/* Desktop Tabs — Dashboard | Learn | Compete */}
            {showAppNav && (
              <div className="hidden md:flex items-center gap-1">
                {NAV_LINKS.map((link) => {
                  const active = isTabActive(link.href);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200
                        ${active
                          ? "bg-electric/15 text-electric"
                          : "hover:bg-white/5"
                        }`}
                      style={active ? {} : { color: "var(--nav-text)" }}
                    >
                      {link.label}
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

            {/* Right Section */}
            <div className="flex items-center gap-2">
              {showAppNav && user && (
                <>
                  {/* Coin Pill */}
                  <Link href="/wallet" className="hidden sm:flex items-center gap-2 rounded-lg px-4 py-1.5
                    cursor-pointer group relative transition-all duration-200 active:scale-95
                    shadow-md shadow-gold/30 hover:shadow-gold/50"
                    style={{ background: "linear-gradient(135deg, #FFD700, #F59E0B)" }}>
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-base text-navy tracking-wider leading-none font-bold">
                      {stats ? formatCoins(stats.coins) : user.statsLoaded ? formatCoins(user.coins) : <StatSkeleton />}
                    </span>
                  </Link>

                  {/* Streak Pill */}
                  <button
                    onClick={() => setShowStreakModal(true)}
                    className="hidden sm:flex items-center gap-1 bg-orange-500/10 border border-orange-500/20
                      rounded-full px-2.5 py-1 cursor-pointer group relative hover:bg-orange-500/15 transition-colors"
                  >
                    <span className="text-sm">&#x1F525;</span>
                    <span className="font-bebas text-base text-orange-400 tracking-wider leading-none">
                      {stats !== null
                        ? (isStreakExpired(streakInfo?.lastQuizAt ?? null) ? 0 : stats.streak)
                        : user.statsLoaded
                        ? (isStreakExpired(streakInfo?.lastQuizAt ?? null) ? 0 : user.streak)
                        : <StatSkeleton width="w-5" />}
                    </span>
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-navy-100
                      border border-electric/20 text-xs text-cream/70 opacity-0 group-hover:opacity-100
                      transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                      Streak
                    </div>
                  </button>

                  {/* Notification Bell */}
                  <div className="relative hidden sm:block" ref={notifRef}>
                    <button
                      onClick={openNotifPanel}
                      className="relative flex items-center justify-center w-8 h-8 rounded-full hover:bg-white/10 transition-colors"
                    >
                      <span className="text-base">🔔</span>
                      {(unreadCount ?? 0) > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center px-1 text-[9px] font-bold notif-badge-pulse"
                          style={{ background: "#EF4444", color: "#fff" }}>
                          {unreadCount}
                        </span>
                      )}
                    </button>

                    {/* Notification Dropdown */}
                    {showNotifPanel && (
                      <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-xl z-50"
                        style={{
                          background: "linear-gradient(135deg, #0c1020 0%, #080c18 100%)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                        }}>
                        <div className="px-4 py-3 border-b border-white/[0.06]">
                          <p className="font-bebas text-sm text-cream tracking-wider">NOTIFICATIONS</p>
                        </div>
                        {notifications.length === 0 ? (
                          <div className="py-8 text-center">
                            <p className="text-cream/20 text-xs">No notifications</p>
                          </div>
                        ) : (
                          notifications.map(n => (
                            <button
                              key={n.id}
                              onClick={() => {
                                setShowNotifPanel(false);
                                if (n.action_url) router.push(n.action_url);
                              }}
                              className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/[0.04] transition-colors"
                              style={!n.read ? { borderLeft: "2px solid #FFD700" } : { borderLeft: "2px solid transparent" }}
                            >
                              <span className="text-base flex-shrink-0 mt-0.5">
                                {NOTIF_ICONS[n.type] ?? "📢"}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-semibold truncate ${n.read ? "text-cream/60" : "text-cream"}`}>
                                  {n.title}
                                </p>
                                {n.message && (
                                  <p className="text-[10px] text-cream/30 mt-0.5 truncate">{n.message}</p>
                                )}
                                <p className="text-[9px] text-cream/20 mt-1">{timeAgoShort(n.created_at)}</p>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* CTA Button — Clock In */}
                  <Link href="/quiz">
                    <button className="font-syne font-bold text-sm px-4 py-1.5 rounded-lg transition-all duration-200
                      active:scale-95 text-navy bg-electric hover:bg-electric-light
                      shadow-md shadow-electric/30 hover:shadow-electric/50">
                      Clock In
                    </button>
                  </Link>

                  {/* Avatar + Dropdown */}
                  <div className="relative" ref={dropdownRef}>
                    <button
                      onClick={toggleDropdown}
                      className="w-8 h-8 rounded-full border-2 border-electric/40 overflow-hidden
                        hover:border-electric transition-colors duration-200 cursor-pointer flex-shrink-0"
                      style={{ backgroundColor: "rgba(74, 144, 217, 0.25)" }}
                    >
                      <img
                        src={stats?.avatar ?? user.avatar}
                        alt={user.username}
                        className="w-full h-full object-cover"
                      />
                    </button>

                    {showDropdown && (
                      <>
                        {/* Backdrop */}
                        <div
                          className={`fixed inset-0 z-40 ${dropdownClosing ? "animate-fade-out" : "animate-fade-in"}`}
                          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }}
                          onClick={closeDropdown}
                        />

                        {/* Dropdown panel */}
                        <div
                          className={`absolute right-0 top-12 w-[280px] rounded-2xl z-50 overflow-hidden origin-top-right
                            ${dropdownClosing ? "dropdown-menu-exit" : "dropdown-menu-enter"}`}
                          style={{
                            background: "linear-gradient(135deg, rgba(12,16,32,0.98), rgba(8,12,24,0.98))",
                            border: "1px solid rgba(255,255,255,0.1)",
                            boxShadow: "0 0 30px rgba(0,0,0,0.5), 0 0 60px rgba(74,144,217,0.08)",
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
                                <img src={stats?.avatar ?? user.avatar} alt="" className="w-full h-full object-cover" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-cream font-bold text-[15px] truncate">{user.username}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-gold text-xs font-semibold">
                                    {stats ? `Level ${stats.level}` : user.statsLoaded ? `Level ${user.level}` : <StatSkeleton width="w-10" />}
                                  </span>
                                  <span className="text-cream/20">·</span>
                                  <span className="text-cream/40 text-xs">
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
                  <Link href="/login">
                    <button className={`text-sm py-1.5 px-4 rounded-xl font-bold transition-all duration-200 ${isLanding ? "btn-gold" : "btn-primary"}`}>
                      Start Free
                    </button>
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
          streak <= 2 ? "Great start — keep it going!" :
          streak <= 6 ? "You're building momentum!" :
          streak <= 13 ? "Impressive dedication!" :
          streak <= 29 ? "You're on fire! Don't stop now!" :
          "Legendary streak — absolute beast!";
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" onClick={() => setShowStreakModal(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="relative w-full max-w-sm rounded-2xl border border-orange-500/20 p-6 animate-slide-up"
              style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Icon + Streak Number */}
              <div className="text-center mb-4">
                {expired ? (
                  <>
                    <div className="text-6xl mb-2" style={{ filter: "drop-shadow(0 0 20px rgba(220,38,38,0.4))" }}>&#x1F480;</div>
                    <h2 className="font-bebas text-4xl text-red-400 tracking-wider">
                      Streak Lost!
                    </h2>
                  </>
                ) : (
                  <>
                    <div className="text-6xl mb-2" style={{ filter: "drop-shadow(0 0 20px rgba(249,115,22,0.5))" }}>&#x1F525;</div>
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
                    <p className="text-orange-400 font-bold text-lg">&#x1F525; Daily goal crushed!</p>
                    <p className="text-cream/40 text-xs mt-1">You&apos;re all caught up — come back tomorrow to keep your streak alive.</p>
                  </div>
                ) : (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-xs text-cream/40 mb-1.5">
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
                  <span>&#x1F6E1;&#xFE0F;</span>
                  <span className="text-blue-400 text-xs font-semibold">Streak Shield Active — you&apos;re protected for 1 missed day</span>
                </div>
              )}

              {/* Go Study Button */}
              <Link href="/learn" onClick={() => setShowStreakModal(false)}>
                <button className="w-full font-syne font-bold text-sm px-4 py-3 rounded-xl transition-all duration-200
                  active:scale-95 text-navy bg-electric hover:bg-electric-light
                  shadow-md shadow-electric/30 hover:shadow-electric/50">
                  Go Study
                </button>
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
            {[
              { href: "/dashboard", label: "Home", icon: "\u{1F3E0}" },
              { href: "/learn", label: "Learn", icon: "\u{1F4DA}" },
              { href: "/compete", label: "Compete", icon: "\u2694\uFE0F" },
              { href: "/shop", label: "Shop", icon: "\u{1F6CD}\uFE0F" },
            ].map((item) => {
              const active = isTabActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center gap-0.5 py-1.5 px-4 rounded-lg transition-all duration-200
                    ${active
                      ? "text-electric"
                      : "text-cream/40 hover:text-cream/70"
                    }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-[10px] font-semibold tracking-wide">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
