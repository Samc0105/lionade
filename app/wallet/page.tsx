"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
  ArrowUpRight,
  ArrowDownRight,
  ArrowsClockwise,
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

const NINNY_TYPES = new Set(["ninny_session", "ninny_unlock", "ninny_refund", "ninny_abandon"]);

// Tuned palette for the ledger rows. Income rows pop electric-green; spends
// stay in the muted-gold family so the page reads as "trust ledger" not
// "loss leaderboard." Ninny keeps its purple identity.
const INCOME_ACCENT = "#00E6A3"; // electric green
const SPEND_ACCENT  = "#C9A227"; // muted gold
const NINNY_ACCENT  = "#A855F7";

function txnAccent(txn: Transaction): string {
  if (NINNY_TYPES.has(txn.type)) return NINNY_ACCENT;
  return txn.amount >= 0 ? INCOME_ACCENT : SPEND_ACCENT;
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

function BalanceSparkline({ balance, txns }: { balance: number; txns: Transaction[] }) {
  const points = useMemo(() => {
    const ordered = [...txns].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    if (ordered.length < 2) return null;
    const series: number[] = [];
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

// Weekly delta derived purely from the already-loaded transactions. Returns
// nulls when the ledger is empty so the UI can hide the chip entirely rather
// than show a meaningless "+0".
function useWeeklyDelta(txns: Transaction[]) {
  return useMemo(() => {
    if (!txns.length) return { earned: null as number | null, spent: null as number | null, hasData: false };
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let earned = 0;
    let spent = 0;
    for (const t of txns) {
      if (new Date(t.created_at).getTime() < weekAgo) continue;
      if (t.amount > 0) earned += t.amount;
      else spent += -t.amount;
    }
    return { earned, spent, hasData: earned > 0 || spent > 0 };
  }, [txns]);
}

// Today-only earned chip for the hero. Hidden when zero.
function useTodayEarned(txns: Transaction[]) {
  return useMemo(() => {
    if (!txns.length) return 0;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let earned = 0;
    for (const t of txns) {
      if (new Date(t.created_at).getTime() < dayAgo) continue;
      if (t.amount > 0) earned += t.amount;
    }
    return earned;
  }, [txns]);
}

export default function WalletPage() {
  const { user } = useAuth();
  const { stats } = useUserStats(user?.id);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txnLoading, setTxnLoading] = useState(true);
  const [txnError, setTxnError] = useState(false);

  const coins = stats?.coins ?? user?.coins ?? null;
  const xp = stats?.xp ?? user?.xp ?? null;
  const level = stats?.level ?? user?.level ?? null;
  const streak = stats?.streak ?? user?.streak ?? null;
  const ready = coins !== null;

  // Manual fetch (not SWR) so the Retry button can re-invoke the exact same
  // call. A failed query must surface as an error, never as "no transactions."
  const fetchTransactions = useCallback(async () => {
    if (!user?.id) return;
    setTxnLoading(true);
    setTxnError(false);
    const { data, error } = await supabase
      .from("coin_transactions")
      .select("id, amount, type, description, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("[wallet:transactions] fetch failed", error);
      setTxnError(true);
      setTxnLoading(false);
      return;
    }
    setTransactions((data ?? []) as Transaction[]);
    setTxnLoading(false);
  }, [user?.id]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const weekly = useWeeklyDelta(transactions);
  const todayEarned = useTodayEarned(transactions);

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

          {/* Header */}
          <div className="flex items-center gap-3 mb-8 animate-slide-up">
            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-11 h-11 object-contain" />
            <div>
              <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider leading-none">WALLET</h1>
              <p className="text-cream/50 text-sm mt-1">Your Fangs balance and rewards</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">

            {/* LEFT RAIL */}
            <div className="lg:col-span-2 space-y-5">
              {/* Hero balance card */}
              <div className="wallet-hero rounded-2xl border border-gold/25 p-7 animate-slide-up relative overflow-hidden"
                style={{ animationDelay: "0.05s", background: "var(--card-solid-bg)", boxShadow: "0 0 40px rgba(255,215,0,0.08)" }}>
                {/* Gold-particle drift layer — revealed on hover */}
                <div className="wallet-hero-particles" aria-hidden="true">
                  <span className="wp wp-1" />
                  <span className="wp wp-2" />
                  <span className="wp wp-3" />
                  <span className="wp wp-4" />
                  <span className="wp wp-5" />
                </div>

                <div className="relative flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-cream/40 text-xs uppercase tracking-widest font-semibold">Your stash</p>
                    <p className="text-cream/25 text-[10px] uppercase tracking-widest mt-1 font-mono">Current Balance</p>
                  </div>
                  {ready && todayEarned > 0 && (
                    <span className="balance-delta-chip inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-widest"
                      style={{ background: `${INCOME_ACCENT}14`, border: `1px solid ${INCOME_ACCENT}40`, color: INCOME_ACCENT }}>
                      <ArrowUpRight size={11} weight="bold" aria-hidden="true" />
                      +{todayEarned.toLocaleString()} today
                    </span>
                  )}
                </div>

                <div className="relative flex items-center gap-3 mb-5">
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-14 h-14 sm:w-16 sm:h-16 object-contain shrink-0" />
                  {ready ? (
                    <span className="font-bebas text-6xl sm:text-7xl text-gold leading-none balance-breathe">
                      <CountUp id="user-coins" value={coins} format={formatCoins} duration={1100} />
                    </span>
                  ) : (
                    <div className="h-14 w-40 rounded-lg bg-white/10 animate-pulse" />
                  )}
                </div>
                <p className="relative text-cream/30 text-xs uppercase tracking-widest mb-3">Fangs</p>

                <div className="relative rounded-xl px-3 pt-3 pb-2"
                  style={{ background: "rgba(255,215,0,0.04)", border: "1px solid rgba(255,215,0,0.10)" }}>
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

              {/* Spend Fangs CTA */}
              <Link href="/shop" className="block animate-slide-up" style={{ animationDelay: "0.15s" }}>
                <div className="rounded-2xl border border-gold/25 p-4 transition-all hover:border-gold/45 hover:bg-gold/[0.04]"
                  style={{ background: "var(--card-solid-bg)" }}>
                  <div className="flex items-center gap-3">
                    <Gift size={22} weight="fill" color="#FFD700" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bebas text-base text-cream tracking-wider leading-none">SPEND YOUR FANGS</p>
                      <p className="text-cream/45 text-xs mt-1">Cosmetics, boosters, premium SKUs</p>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold/85">
                      Shop <span aria-hidden="true">→</span>
                    </span>
                  </div>
                </div>
              </Link>
            </div>

            {/* RIGHT: transaction ledger */}
            <div className="lg:col-span-3 rounded-2xl p-6 animate-slide-up"
              style={{ animationDelay: "0.1s", background: "var(--card-solid-bg)", border: "1px solid var(--card-solid-border)", minHeight: "100%" }}>
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-bebas text-xl text-cream tracking-wider">TRANSACTION HISTORY</h2>
                <span className="text-cream/25 text-xs uppercase tracking-widest">Last 20</span>
              </div>

              {/* Weekly summary tiles — only when there's something to summarize */}
              {!txnLoading && weekly.hasData && (
                <div className="grid grid-cols-2 gap-3 mb-5 animate-slide-up" style={{ animationDelay: "0.18s" }}>
                  <div className="rounded-xl border p-3 flex items-center gap-3"
                    style={{ background: `${INCOME_ACCENT}08`, borderColor: `${INCOME_ACCENT}28` }}>
                    <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: `${INCOME_ACCENT}14`, border: `1px solid ${INCOME_ACCENT}30` }}>
                      <ArrowUpRight size={16} weight="bold" color={INCOME_ACCENT} aria-hidden="true" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-cream/45 text-[10px] uppercase tracking-widest font-mono">Earned this week</p>
                      <p className="font-bebas text-2xl leading-none mt-0.5" style={{ color: INCOME_ACCENT }}>
                        +{(weekly.earned ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-xl border p-3 flex items-center gap-3"
                    style={{ background: `${SPEND_ACCENT}08`, borderColor: `${SPEND_ACCENT}28` }}>
                    <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: `${SPEND_ACCENT}14`, border: `1px solid ${SPEND_ACCENT}30` }}>
                      <ArrowDownRight size={16} weight="bold" color={SPEND_ACCENT} aria-hidden="true" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-cream/45 text-[10px] uppercase tracking-widest font-mono">Spent this week</p>
                      <p className="font-bebas text-2xl leading-none mt-0.5" style={{ color: SPEND_ACCENT }}>
                        {(weekly.spent ?? 0) > 0 ? "-" : ""}{(weekly.spent ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {txnLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="h-14 rounded-xl bg-white/5 animate-pulse" />
                  ))}
                </div>
              ) : txnError ? (
                <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
                  <p className="font-syne text-sm text-red-300 mb-3">
                    Couldn't load your ledger. Your Fangs are safe, the connection isn't.
                  </p>
                  <button
                    type="button"
                    onClick={fetchTransactions}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
                  >
                    <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
                    Try again
                  </button>
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-20">
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-10 h-10 object-contain mx-auto mb-3 opacity-30" />
                  <p className="font-bebas text-lg text-cream/30 tracking-wider mb-1">No transactions yet</p>
                  <p className="text-cream/20 text-xs mb-5">Earn Fangs by completing quizzes, duels, and bounties.</p>
                  <Link href="/quiz" className="inline-block font-syne font-bold text-xs px-5 py-2 rounded-full border border-gold/40 text-gold hover:bg-gold/10 transition-colors">
                    Earn your first Fangs
                  </Link>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {transactions.map((txn, i) => {
                    const isPositive = txn.amount > 0;
                    const accent = txnAccent(txn);
                    const TxnIcon = TXN_ICONS[txn.type] ?? Coin;
                    const label = txn.description ?? txn.type.replace(/_/g, " ");
                    const source = txn.type.replace(/_/g, " ");
                    return (
                      <div
                        key={txn.id}
                        className="txn-row flex items-center gap-3 pl-1 pr-3 py-3 rounded-xl border overflow-hidden relative animate-slide-up"
                        style={{
                          animationDelay: `${0.15 + i * 0.03}s`,
                          borderColor: `${accent}1c`,
                          background: "rgba(255,255,255,0.012)",
                        }}
                      >
                        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-full" style={{ background: accent }} />
                        <span
                          className="w-9 h-9 ml-2 flex items-center justify-center rounded-full shrink-0"
                          style={{ background: `${accent}14`, border: `1px solid ${accent}28`, color: accent }}
                        >
                          <TxnIcon size={17} weight="regular" color="currentColor" aria-hidden="true" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-syne text-cream text-sm truncate capitalize leading-tight">
                            {label}
                          </p>
                          <p className="text-cream/40 text-[10px] font-mono tracking-wider mt-0.5 truncate">
                            {source.toLowerCase()} · {timeAgo(txn.created_at)}
                          </p>
                        </div>
                        <span className="font-bebas text-2xl tracking-wider shrink-0 tabular-nums" style={{ color: accent }}>
                          {isPositive ? "+" : ""}{txn.amount.toLocaleString()}
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
