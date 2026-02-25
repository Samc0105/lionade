"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { formatCoins } from "@/lib/mockData";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/learn", label: "Learn" },
  { href: "/compete", label: "Compete" },
];

const DROPDOWN_ITEMS = [
  { href: "/profile", label: "Profile", icon: "\u{1F464}" },
  { href: "/profile?section=overview", label: "Badges", icon: "\u{1F396}\uFE0F" },
  { href: "/profile?section=personalization", label: "Wallet / Rewards", icon: "\u{1FA99}" },
  { href: "/profile?section=security", label: "Settings", icon: "\u2699\uFE0F" },
  { href: "/profile?section=notifications", label: "Help / Support", icon: "\u2753" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isComingSoon = pathname === "/";
  const isLanding = pathname === "/home";
  const isLogin = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";
  const showAppNav = !!user && !isComingSoon && !isLanding && !isLogin && !isOnboarding;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDropdown]);

  // Close dropdown on Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setShowDropdown(false);
    }
    if (showDropdown) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showDropdown]);

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
    router.push("/");
  };

  const isTabActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    if (href === "/learn") return pathname === "/learn" || pathname === "/quiz";
    if (href === "/compete") return pathname === "/compete" || pathname === "/duel" || pathname === "/leaderboard";
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
                <img src="/logo-icon.png" alt="Lionade" className="h-8 rounded-md relative z-10" />
                <div className="logo-shimmer" />
              </div>
              <div className="relative overflow-hidden rounded-md logo-glow hidden sm:block">
                <img src="/logo-full.png" alt="Lionade" className="h-9 rounded-md relative z-10" />
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
                          : "text-cream/60 hover:text-cream hover:bg-white/5"
                        }`}
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
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold text-cream/60 hover:text-cream hover:bg-white/5 transition-all duration-200"
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
                  <div className="hidden sm:flex items-center gap-1.5 bg-gold/10 border border-gold/20
                    rounded-full px-2.5 py-1 cursor-default group relative">
                    <span className="text-sm">&#x1FA99;</span>
                    <span className="font-bebas text-base text-gold tracking-wider leading-none">
                      {formatCoins(user.coins)}
                    </span>
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-navy-100
                      border border-electric/20 text-xs text-cream/70 opacity-0 group-hover:opacity-100
                      transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                      Coins
                    </div>
                  </div>

                  {/* Streak Pill */}
                  <div className="hidden sm:flex items-center gap-1 bg-orange-500/10 border border-orange-500/20
                    rounded-full px-2.5 py-1 cursor-default group relative">
                    <span className="text-sm">&#x1F525;</span>
                    <span className="font-bebas text-base text-orange-400 tracking-wider leading-none">
                      {user.streak}
                    </span>
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-navy-100
                      border border-electric/20 text-xs text-cream/70 opacity-0 group-hover:opacity-100
                      transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                      Streak
                    </div>
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
                      onClick={() => setShowDropdown(!showDropdown)}
                      className="w-8 h-8 rounded-full border-2 border-electric/40 overflow-hidden
                        hover:border-electric transition-colors duration-200 cursor-pointer flex-shrink-0"
                    >
                      <img
                        src={user.avatar}
                        alt={user.username}
                        className="w-full h-full object-cover bg-navy-50"
                      />
                    </button>

                    {showDropdown && (
                      <div
                        className="absolute right-0 top-11 w-52 rounded-xl border border-electric/20 py-1 z-50 shadow-xl"
                        style={{ background: "#060c18" }}
                      >
                        {/* User info header */}
                        <div className="px-4 py-2.5 border-b border-electric/10">
                          <p className="text-cream font-bold text-sm">{user.username}</p>
                          <p className="text-cream/40 text-xs">Level {user.level}</p>
                        </div>

                        {/* Menu items */}
                        {DROPDOWN_ITEMS.map((item) => (
                          <Link
                            key={item.label}
                            href={item.href}
                            onClick={() => setShowDropdown(false)}
                          >
                            <div className="px-4 py-2.5 text-cream/70 text-sm hover:text-cream hover:bg-white/5 transition-colors flex items-center gap-2.5">
                              <span className="text-base w-5 text-center">{item.icon}</span>
                              {item.label}
                            </div>
                          </Link>
                        ))}

                        {/* Divider + Logout */}
                        <div className="border-t border-electric/10 mt-1">
                          <button
                            onClick={handleLogout}
                            className="w-full text-left px-4 py-2.5 text-red-400 text-sm hover:bg-red-400/5 transition-colors flex items-center gap-2.5"
                          >
                            <span className="text-base w-5 text-center">&#x1F6AA;</span>
                            Log Out
                          </button>
                        </div>
                      </div>
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
