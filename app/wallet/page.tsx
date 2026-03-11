"use client";

import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { formatCoins } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import Link from "next/link";

export default function WalletPage() {
  const { user } = useAuth();
  const { stats } = useUserStats(user?.id);

  const coins = stats?.coins ?? user?.coins ?? 0;
  const xp = stats?.xp ?? user?.xp ?? 0;
  const level = stats?.level ?? user?.level ?? 1;
  const streak = stats?.streak ?? user?.streak ?? 0;

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
        <BackButton />

        <div className="text-center mb-10 animate-slide-up">
          <img src="/fangs.png" alt="Fangs" className="w-14 h-14 object-contain mx-auto mb-3" />
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider mb-2">WALLET</h1>
          <p className="text-cream/50 text-sm">Your Fangs balance and rewards</p>
        </div>

        {/* Balance Card */}
        <div className="rounded-2xl border border-gold/20 p-8 mb-6 text-center animate-slide-up"
          style={{ animationDelay: "0.05s", background: "var(--card-solid-bg)", boxShadow: "0 0 30px rgba(255,215,0,0.08)" }}>
          <p className="text-cream/40 text-xs uppercase tracking-widest font-semibold mb-3">Current Balance</p>
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src="/fangs.png" alt="Fangs" className="w-10 h-10 object-contain" />
            <span className="font-bebas text-7xl sm:text-8xl text-gold leading-none glow-gold">{formatCoins(coins)}</span>
          </div>
          <p className="text-cream/30 text-sm">Fangs</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-4 mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
          {[
            { label: "Total XP", value: xp.toLocaleString(), icon: "⚡", color: "#4A90D9" },
            { label: "Level", value: `Lv ${level}`, icon: "📈", color: "#9B59B6" },
            { label: "Streak", value: `${streak} days`, icon: "🔥", color: "#E67E22" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border p-4 text-center"
              style={{ background: "var(--card-solid-bg)", borderColor: `${s.color}20` }}>
              <span className="text-2xl block mb-1">{s.icon}</span>
              <p className="font-bebas text-2xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="text-cream/40 text-[10px] uppercase tracking-widest mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Transaction History */}
        <div className="rounded-2xl p-6 mb-6 animate-slide-up"
          style={{ animationDelay: "0.15s", background: "var(--card-solid-bg)", border: "1px solid var(--card-solid-border)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bebas text-xl text-cream tracking-wider">TRANSACTION HISTORY</h2>
            <span className="text-cream/20 text-xs">Recent</span>
          </div>
          <div className="text-center py-10">
            <img src="/fangs.png" alt="Fangs" className="w-8 h-8 object-contain mx-auto mb-3 opacity-30" />
            <p className="font-bebas text-lg text-cream/30 tracking-wider mb-1">No transactions yet</p>
            <p className="text-cream/20 text-xs">Earn Fangs by completing quizzes, duels, and bounties.</p>
          </div>
        </div>

        {/* Redeem Rewards */}
        <div className="rounded-2xl border border-purple-500/15 p-6 animate-slide-up"
          style={{ animationDelay: "0.2s", background: "var(--card-solid-bg)" }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">🎁</span>
            <div>
              <h2 className="font-bebas text-xl text-cream tracking-wider">REDEEM REWARDS</h2>
              <p className="text-cream/40 text-xs">Convert your Fangs into real rewards</p>
            </div>
          </div>
          <div className="text-center py-8 rounded-xl" style={{ background: "rgba(168,85,247,0.05)", border: "1px dashed rgba(168,85,247,0.2)" }}>
            <p className="text-purple-400/60 text-sm font-semibold mb-1">Coming Soon</p>
            <p className="text-cream/20 text-xs">Reward redemptions will be available in V2</p>
          </div>
          <div className="mt-4 text-center">
            <Link href="/shop">
              <button className="font-syne font-semibold text-xs px-6 py-2.5 rounded-full transition-all duration-200 active:scale-95 border border-gold/30 text-gold hover:bg-gold/10">
                Visit the Shop
              </button>
            </Link>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
