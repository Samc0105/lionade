"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useUserStats } from "@/lib/hooks";
import { formatCoins } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import AmbientOrbs from "@/components/AmbientOrbs";
import CountUp from "@/components/CountUp";
import Link from "next/link";
import { cdnUrl } from "@/lib/cdn";
import { supabase } from "@/lib/supabase";
import {
  BookOpen,
  Sword,
  DiceFive,
  Target,
  Fire,
  Gift,
  Medal,
  Storefront,
  GameController,
  Robot,
  Sun,
  Coin,
  Lightning,
  TrendUp,
  type Icon,
} from "@phosphor-icons/react";

// Phosphor icon by transaction type
const TXN_ICONS: Record<string, Icon> = {
  quiz_reward:      BookOpen,
  duel_win:         Sword,
  duel_loss:        Sword,
  bet_placed:       DiceFive,
  bet_won:          DiceFive,
  bounty_reward:    Target,
  streak_milestone: Fire,
  streak_bonus:     Fire,
  signup_bonus:     Gift,
  badge_bonus:      Medal,
  shop_purchase:    Storefront,
  game_reward:      GameController,
  ninny_session:    Robot,
  ninny_unlock:     Robot,
  ninny_refund:     Robot,
  ninny_abandon:    Robot,
  login_bonus:      Sun,
};

// Ninny-related types render with a purple accent rather than the default
// green/red reward/spend coloring.
const NINNY_TYPES = new Set(["ninny_session", "ninny_unlock", "ninny_refund", "ninny_abandon"]);

function txnAccent(txn: Transaction): string {
  if (NINNY_TYPES.has(txn.type)) return "#A855F7"; // Ninny → purple
  return txn.amount >= 0 ? "#22C55E" : "#EF4444";  // reward → green, spend → red
}

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

/* ── Balance sparkline ─────────────────────────────────────────
   Derives a balance-over-time curve by walking the recent transactions
   backwards from the current balance. No new data source — purely a
   presentation of the ledger we already fetch. Falls back to a flat
   placeholder line when there's not enough history. */
function BalanceSparkline({ balance, txns }: { balance: number; txns: Transaction[] }) {
  const points = useMemo(() => {
    // Oldest → newest running balance, ending at the current balance.
    const ordered = [...txns].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    if (ordered.length < 2) return null;
    const series: number[] = [];
    // Reconstruct: current balance minus the sum of all txns = starting balance.
    const totalDelta = ordered.reduce((s, t) => s + t.amount, 0);
    let running = balance - totalDelta;
    series.push(running);
    for (const t of ordered) {
      running += t.amount;
      series.push(running);
    }
    return series;
  }, [balance, txns]);

  const W = 100;
  const H = 32;

  if (!points) {
    // Tasteful flat placeholder — a faint dashed baseline.
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2}
          stroke="rgba(255,215,0,0.18)" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = W / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = H - 2 - ((v - min) / range) * (H - 4);
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  // Approximate path length for the draw-on dash trick.
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += Math.hypot(coords[i][0] - coords[i - 1][0], coords[i][1] - coords[i - 1][1]);
  }
  const areaD = `${d} L${W} ${H} L0 ${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,215,0,0.22)" />
          <stop offset="100%" stopColor="rgba(255,215,0,0)" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#spark-fill)" />
      <path
        d={d}
        fill="none"
        stroke="#FFD700"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sparkline-path"
        style={{ "--spark-len": len } as React.CSSProperties}
      />
    </svg>
  );
}

export default function WalletPage() {
  const { user } = useAuth();
  const { stats } = useUserStats(user?.id);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(true);

  // No-flash-of-zero: hold the numeric stats as null until either the shared
  // stats hook or the auth user provide a real value.
  const coins = stats?.coins ?? user?.coins ?? null;
  const xp = stats?.xp ?? user?.xp ?? null;
  const level = stats?.level ?? user?.level ?? null;
  const streak = stats?.streak ?? user?.streak ?? null;
  const ready = coins !== null;

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
      <div className="relative min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden" style={{ isolation: "isolate" }}>
        <AmbientOrbs
          orbs={[
            { color: "#00BFFF", pos: "top-[10%] left-[14%]", size: 540, opacity: 0.06 },
            { color: "#4A90D9", pos: "bottom-[16%] right-[10%]", size: 460, opacity: 0.045 },
            { color: "#A855F7", pos: "top-[50%] left-[55%]", size: 560, opacity: 0.03 },
          ]}
        />

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <BackButton />

          {/* Header — left-aligned, no centered hero */}
          <div className="flex items-center gap-3 mb-8 animate-slide-up">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-11 h-11 object-contain" />
            <div>
              <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider leading-none">WALLET</h1>
              <p className="text-cream/50 text-sm mt-1">Your Fangs balance and rewards</p>
            </div>
          </div>

          {/* ═══ 2-COLUMN BENTO ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

            {/* ── LEFT RAIL (2/5): hero balance + stat tiles ── */}
            <div className="lg:col-span-2 space-y-5">
              {/* Hero balance card */}
              <div className="rounded-2xl border border-gold/25 p-7 animate-slide-up"
                style={{ animationDelay: "0.05s", background: "var(--card-solid-bg)", boxShadow: "0 0 40px rgba(255,215,0,0.08)" }}>
                <p className="text-cream/40 text-xs uppercase tracking-widest font-semibold mb-4">Current Balance</p>
                <div className="flex items-center gap-3 mb-5">
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-14 h-14 sm:w-16 sm:h-16 object-contain shrink-0" />
                  {ready ? (
                    <span className="font-bebas text-6xl sm:text-7xl text-gold leading-none balance-breathe">
                      <CountUp id="user-coins" value={coins} format={formatCoins} duration={1100} />
                    </span>
                  ) : (
                    <div className="h-14 w-40 rounded-lg bg-white/10 animate-pulse" />
                  )}
                </div>
                <p className="text-cream/30 text-xs uppercase tracking-widest mb-3">Fangs</p>
                {/* Sparkline — balance over recent activity */}
                <div className="rounded-xl px-3 pt-3 pb-2" style={{ background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.10)" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-cream/35 text-[10px] uppercase tracking-widest">Balance trend</span>
                    <span className="text-cream/25 text-[10px]">recent</span>
                  </div>
                  {ready ? (
                    <BalanceSparkline balance={coins} txns={transactions} />
                  ) : (
                    <div className="h-8 rounded bg-white/5 animate-pulse" />
                  )}
                </div>
              </div>

              {/* Stat tiles rail */}
              <div className="grid grid-cols-3 gap-3 animate-slide-up" style={{ animationDelay: "0.1s" }}>
                {[
                  { label: "Total XP", value: xp,    display: (v: number) => v.toLocaleString(), Icon: Lightning, color: "#4A90D9" },
                  { label: "Level",    value: level,  display: (v: number) => `Lv ${v}`,         Icon: TrendUp,   color: "#9B59B6" },
                  { label: "Streak",   value: streak, display: (v: number) => `${v}d`,           Icon: Fire,      color: "#E67E22" },
                ].map((s) => {
                  const StatIcon = s.Icon;
                  return (
                    <div key={s.label} className="rounded-xl border p-3 text-center"
                      style={{ background: "var(--card-solid-bg)", borderColor: `${s.color}25` }}>
                      <StatIcon size={24} weight="fill" color={s.color} className="mx-auto mb-1" aria-hidden="true" />
                      {s.value !== null ? (
                        <p className="font-bebas text-xl leading-none" style={{ color: s.color }}>{s.display(s.value)}</p>
                      ) : (
                        <div className="h-5 w-10 mx-auto rounded bg-white/10 animate-pulse" />
                      )}
                      <p className="text-cream/40 text-[9px] uppercase tracking-widest mt-1.5">{s.label}</p>
                    </div>
                  );
                })}
              </div>

              {/* Redeem rewards — fills the bottom of the left rail */}
              <div className="rounded-2xl border border-purple-500/15 p-5 animate-slide-up"
                style={{ animationDelay: "0.15s", background: "var(--card-solid-bg)" }}>
                <div className="flex items-center gap-3 mb-3">
                  <Gift size={26} weight="fill" color="#FFD700" aria-hidden="true" />
                  <div>
                    <h2 className="font-bebas text-lg text-cream tracking-wider leading-none">REDEEM REWARDS</h2>
                    <p className="text-cream/40 text-xs mt-1">Convert your Fangs into real rewards</p>
                  </div>
                </div>
                <div className="text-center py-5 rounded-xl mb-3" style={{ background: "rgba(168,85,247,0.05)", border: "1px dashed rgba(168,85,247,0.2)" }}>
                  <p className="text-purple-400/60 text-sm font-semibold mb-0.5">Coming Soon</p>
                  <p className="text-cream/20 text-xs">Reward redemptions arrive in V2</p>
                </div>
                <Link href="/shop" className="block">
                  <button className="w-full font-syne font-semibold text-xs px-6 py-2.5 rounded-full transition-all duration-200 active:scale-95 border border-gold/30 text-gold hover:bg-gold/10">
                    Visit the Shop
                  </button>
                </Link>
              </div>
            </div>

            {/* ── RIGHT (3/5): transaction ledger filling the column ── */}
            <div className="lg:col-span-3 rounded-2xl p-6 animate-slide-up"
              style={{ animationDelay: "0.1s", background: "var(--card-solid-bg)", border: "1px solid var(--card-solid-border)", minHeight: "100%" }}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-bebas text-xl text-cream tracking-wider">TRANSACTION HISTORY</h2>
                <span className="text-cream/25 text-xs uppercase tracking-widest">Last 20</span>
              </div>

              {txnLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-20">
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-10 h-10 object-contain mx-auto mb-3 opacity-30" />
                  <p className="font-bebas text-lg text-cream/30 tracking-wider mb-1">No transactions yet</p>
                  <p className="text-cream/20 text-xs">Earn Fangs by completing quizzes, duels, and bounties.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((txn, i) => {
                    const isPositive = txn.amount > 0;
                    const accent = txnAccent(txn);
                    const TxnIcon = TXN_ICONS[txn.type] ?? Coin;
                    return (
                      <div
                        key={txn.id}
                        className="txn-row flex items-center gap-3 pl-1 pr-3 py-3 rounded-xl border overflow-hidden relative animate-slide-up"
                        style={{
                          animationDelay: `${0.15 + i * 0.04}s`,
                          borderColor: `${accent}20`,
                          background: "rgba(255,255,255,0.015)",
                        }}
                      >
                        {/* Left accent bar keyed to txn type */}
                        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full" style={{ background: accent }} />
                        <span className="w-9 h-9 ml-2 flex items-center justify-center rounded-lg shrink-0"
                          style={{ background: `${accent}14`, color: accent }}>
                          <TxnIcon size={18} weight="fill" color="currentColor" aria-hidden="true" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-syne text-cream text-sm truncate capitalize">
                            {txn.description ?? txn.type.replace(/_/g, " ")}
                          </p>
                          <p className="text-cream/30 text-[10px] font-syne">
                            {timeAgo(txn.created_at)}
                          </p>
                        </div>
                        <span className="font-bebas text-lg tracking-wider shrink-0" style={{ color: accent }}>
                          {isPositive ? "+" : ""}{txn.amount}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
