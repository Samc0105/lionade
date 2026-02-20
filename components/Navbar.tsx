"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { formatCoins } from "@/lib/mockData";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/quiz", label: "Quiz" },
  { href: "/duel", label: "Duel" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/profile", label: "Profile" },
];

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const isLanding = pathname === "/";
  const isLogin = pathname === "/login";
  const showAppNav = !!user && !isLanding && !isLogin;

  const handleLogout = () => {
    logout();
    setShowUserMenu(false);
    setMenuOpen(false);
    router.push("/");
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-electric/20 backdrop-blur-md"
      style={{ background: "rgba(4, 8, 15, 0.85)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href={user ? "/dashboard" : "/"} className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-electric flex items-center justify-center
              shadow-lg shadow-electric/40 group-hover:shadow-electric/60 transition-all duration-300">
              <span className="text-white font-bebas text-lg leading-none">L</span>
            </div>
            <span className="font-bebas text-2xl tracking-wider text-cream group-hover:text-electric
              transition-colors duration-300">
              LIONADE
            </span>
          </Link>

          {/* Desktop Nav — app links when logged in, landing links on homepage */}
          {showAppNav && (
            <div className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((link) => {
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200
                      ${active
                        ? "bg-electric/20 text-electric border border-electric/40"
                        : "text-cream/70 hover:text-cream hover:bg-white/5"
                      }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          )}
          {isLanding && !user && (
            <div className="hidden md:flex items-center gap-1">
              {[
                { href: "#how-it-works", label: "How It Works" },
                { href: "#features", label: "Features" },
                { href: "#about", label: "About" },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-cream/70 hover:text-cream hover:bg-white/5 transition-all duration-200"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}

          {/* Right Section */}
          <div className="flex items-center gap-3">
            {showAppNav && user && (
              <>
                {/* Coin Balance */}
                <div className="hidden sm:flex items-center gap-2 bg-gold/10 border border-gold/30
                  rounded-full px-4 py-1.5">
                  <span className="text-lg">🪙</span>
                  <span className="font-bebas text-xl text-gold tracking-wider">
                    {formatCoins(user.coins)}
                  </span>
                </div>

                {/* Streak */}
                <div className="hidden sm:flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/30
                  rounded-full px-3 py-1.5">
                  <span className="text-base animate-streak-fire inline-block">🔥</span>
                  <span className="font-bebas text-lg text-orange-400 tracking-wider">
                    {user.streak}
                  </span>
                </div>

                {/* Avatar + User Menu */}
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="w-9 h-9 rounded-full border-2 border-electric/50 overflow-hidden
                      hover:border-electric transition-colors duration-200 cursor-pointer"
                  >
                    <img
                      src={user.avatar}
                      alt={user.username}
                      className="w-full h-full object-cover bg-navy-50"
                    />
                  </button>

                  {showUserMenu && (
                    <div
                      className="absolute right-0 top-12 w-48 rounded-xl border border-electric/20 py-1 z-50"
                      style={{ background: "#060c18" }}
                    >
                      <div className="px-4 py-2.5 border-b border-electric/10">
                        <p className="text-cream font-bold text-sm">{user.username}</p>
                        <p className="text-cream/40 text-xs">Level {user.level}</p>
                      </div>
                      <Link href="/profile" onClick={() => setShowUserMenu(false)}>
                        <div className="px-4 py-2.5 text-cream/70 text-sm hover:text-cream hover:bg-white/5 transition-colors">
                          👤 Profile
                        </div>
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2.5 text-red-400 text-sm hover:bg-red-400/5 transition-colors"
                      >
                        🚪 Log Out
                      </button>
                    </div>
                  )}
                </div>

                {/* Mobile Menu Button */}
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="md:hidden p-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <div className="w-5 h-0.5 bg-cream mb-1" />
                  <div className="w-5 h-0.5 bg-cream mb-1" />
                  <div className="w-5 h-0.5 bg-cream" />
                </button>
              </>
            )}

            {/* Not logged in */}
            {!user && !isLogin && (
              <div className="flex items-center gap-2">
                <Link href="/login"
                  className="hidden sm:block btn-outline text-sm py-2 px-4">
                  Log In
                </Link>
                <Link href="/login">
                  <button className={`text-sm py-2 px-4 rounded-xl font-bold transition-all duration-200 ${isLanding ? "btn-gold" : "btn-primary"}`}>
                    Start Free
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && showAppNav && (
        <div className="md:hidden border-t border-electric/20 bg-navy/95 backdrop-blur-md">
          <div className="px-4 py-3 space-y-1">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className={`block px-4 py-3 rounded-lg text-sm font-semibold transition-all duration-200
                    ${active
                      ? "bg-electric/20 text-electric border border-electric/40"
                      : "text-cream/70 hover:text-cream hover:bg-white/5"
                    }`}
                >
                  {link.label}
                </Link>
              );
            })}

            {user && (
              <div className="pt-3 border-t border-electric/20 mt-2 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 bg-gold/10 border border-gold/30
                    rounded-full px-3 py-1.5">
                    <span>🪙</span>
                    <span className="font-bebas text-lg text-gold">{formatCoins(user.coins)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/30
                    rounded-full px-3 py-1.5">
                    <span>🔥</span>
                    <span className="font-bebas text-lg text-orange-400">{user.streak}</span>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-3 rounded-lg text-red-400 text-sm
                    font-semibold hover:bg-red-400/5 transition-colors"
                >
                  🚪 Log Out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
