"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { formatCoins } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import Link from "next/link";
import { cdnUrl } from "@/lib/cdn";
import { supabase } from "@/lib/supabase";

// Type icons by transaction type
const TXN_ICONS: Record<string, string> = {
  quiz_reward: "\u{1F4DA}",
  duel_win: "\u{2694}\u{FE0F}",
  duel_loss: "\u{2694}\u{FE0F}",
  bet_placed: "\u{1F3B2}",
  bet_won: "\u{1F3B2}",
  bounty_reward: "\u{1F3AF}",
  streak_milestone: "\u{1F525}",
  streak_bonus: "\u{1F525}",
  signup_bonus: "\u{1F381}",
  badge_bonus: "\u{1F3C5}",
  shop_purchase: "\u{1F6CD}\u{FE0F}",
  game_reward: "\u{1F3AE}",
  ninny_session: "\u{1F916}",
  ninny_unlock: "\u{1F916}",
  ninny_refund: "\u{1F916}",
  ninny_abandon: "\u{1F916}",
  login_bonus: "\u{2600}\u{FE0F}",
};

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export default function WalletPage() {
  const { user } = useAuth();
  const { stats } = useUserStats(user?.id);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(true);

  const coins = stats?.coins ?? user?.coins ?? 0;
  const xp = stats?.xp ?? user?.xp ?? 0;
  const level = stats?.level ?? user?.level ?? 1;
  const streak = stats?.streak ?? user?.streak ?? 0;

  // Fetch recent transactions
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase
        .from("coin_transactions")
        .select("id, amount, type, description, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setTransactions((data ?? []) as Transaction[]);
      setTxnLoading(false);
    })();
  }, [user?.id]);

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
        <BackButton />

        <div className="text-center mb-10 animate-slide-up">
          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-14 h-14 object-contain mx-auto mb-3" />
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider mb-2">WALLET</h1>
          <p className="text-cream/50 text-sm">Your Fangs balance and rewards</p>
        </div>

        {/* Balance Card */}
        <div className="rounded-2xl border border-gold/20 p-8 mb-6 text-center animate-slide-up"
          style={{ animationDelay: "0.05s", background: "var(--card-solid-bg)", boxShadow: "0 0 30px rgba(255,215,0,0.08)" }}>
          <p className="text-cream/40 text-xs uppercase tracking-widest font-semibold mb-3">Current Balance</p>
          <div className="flex items-center justify-center gap-4 mb-4">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-20 h-20 sm:w-24 sm:h-24 object-contain" />
            <span className="font-bebas text-7xl sm:text-8xl text-gold leading-none glow-gold">{formatCoins(coins)}</span>
          </div>
          <p className="text-cream/30 text-sm">Fangs</p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-4 mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
          {[
            { label: "Total XP", value: xp.toLocaleString(), icon: "\u26A1", color: "#4A90D9" },
            { label: "Level", value: `Lv ${level}`, icon: "\u{1F4C8}", color: "#9B59B6" },
            { label: "Streak", value: `${streak} days`, icon: "\u{1F525}", color: "#E67E22" },
          ].map(s => (
            <div key={s.label} className="rounded-xl border p-4 text-center"
              style={{ background: "var(--card-solid-bg)", borderColor: `${s.color}20` }}>
              <span className="text-2xl block mb-1">{s.icon}</span>
              <p className="font-bebas text-2xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="text-cream/40 text-[10px] uppercase tracking-widest mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Transaction History — now populated from coin_transactions */}
        <div className="rounded-2xl p-6 mb-6 animate-slide-up"
          style={{ animationDelay: "0.15s", background: "var(--card-solid-bg)", border: "1px solid var(--card-solid-border)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bebas text-xl text-cream tracking-wider">TRANSACTION HISTORY</h2>
            <span className="text-cream/20 text-xs">Last 20</span>
          </div>

          {txnLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-10">
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-8 h-8 object-contain mx-auto mb-3 opacity-30" />
              <p className="font-bebas text-lg text-cream/30 tracking-wider mb-1">No transactions yet</p>
              <p className="text-cream/20 text-xs">Earn Fangs by completing quizzes, duels, and bounties.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((txn) => {
                const isPositive = txn.amount > 0;
                const icon = TXN_ICONS[txn.type] ?? "\u{1FA99}";
                return (
                  <div
                    key={txn.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors hover:bg-white/5"
                    style={{ borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <span className="text-lg w-8 text-center shrink-0">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-syne text-cream text-sm truncate">
                        {txn.description ?? txn.type.replace(/_/g, " ")}
                      </p>
                      <p className="text-cream/30 text-[10px] font-syne">
                        {timeAgo(txn.created_at)}
                      </p>
                    </div>
                    <span
                      className="font-bebas text-lg tracking-wider shrink-0"
                      style={{ color: isPositive ? "#22C55E" : "#EF4444" }}
                    >
                      {isPositive ? "+" : ""}{txn.amount}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Redeem Rewards */}
        <div className="rounded-2xl border border-purple-500/15 p-6 animate-slide-up"
          style={{ animationDelay: "0.2s", background: "var(--card-solid-bg)" }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">&#x1F381;</span>
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
