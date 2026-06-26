"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import {
  getAllBadges, getUserBadges, getSubjectStats,
  getQuizHistory, getRecentActivity,
  getPreferences, updatePreferences,
} from "@/lib/db";
import type { UserPreferences } from "@/lib/db";
import { getLevelProgress, formatCoins } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import BadgeCard from "@/components/BadgeCard";
import Link from "next/link";
import { cdnUrl } from "@/lib/cdn";
import { apiPost, apiPatch, apiDelete, apiGet } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  ChartBar,
  PencilSimple,
  Palette,
  Gear,
  Lock,
  Shield,
  Calendar,
  Bell,
  PawPrint,
  List,
  Warning,
  Check,
  X as XIcon,
  Fire,
  Lightning,
  NotePencil,
  Sword,
  BookOpen,
  MedalMilitary,
  MaskHappy,
  Sparkle,
  DiceFive,
  Storefront,
  Globe,
  Users,
  Prohibit,
  FloppyDisk,
  Key,
  Laptop,
  Trash,
  Coins,
  Diamond,
  CheckCircle,
  XCircle,
  Target,
  Handshake,
  Rocket,
  ShareNetwork,
  Moon,
  Sun,
  type Icon,
} from "@phosphor-icons/react";
import dynamic from "next/dynamic";
const ShareCard = dynamic(() => import("@/components/ShareCard"), { ssr: false });
import AnimatedUsername from "@/components/AnimatedUsername";
import EquippedFlair from "@/components/EquippedFlair";
import Avatar from "@/components/Avatar";
import CosmeticLocker from "@/components/CosmeticLocker";
import { useEquippedUsernameEffect, useEquippedCosmetics } from "@/lib/use-username-effect";
import { getBannerStyle } from "@/lib/cosmetics/cosmetic-styles";

// ── Types ────────────────────────────────────────────
type Section =
  | "overview" | "edit-profile" | "avatar"
  | "personalization" | "privacy" | "security"
  | "activity" | "notifications" | "about";

// ── Constants ─────────────────────────────────────────
const DICEBEAR_STYLES = [
  { id: "avataaars",    label: "Characters" },
  { id: "bottts",       label: "Robots" },
  { id: "pixel-art",    label: "Pixel" },
  { id: "lorelei",      label: "Artistic" },
  { id: "fun-emoji",    label: "Emoji" },
  { id: "micah",        label: "Minimal" },
  { id: "adventurer",   label: "Adventure" },
  { id: "croodles",     label: "Doodles" },
  { id: "notionists",   label: "Notion" },
  { id: "open-peeps",   label: "Peeps" },
];

const DEFAULT_SEEDS = ["alpha","bravo","charlie","delta","echo","foxtrot","gamma","hotel","india","juliet","kilo","lima"];


const ADVENTURER_SKIN_TONES = [
  { label: "Light",       value: "f2d3b1" },
  { label: "Fair",        value: "ecad80" },
  { label: "Medium",      value: "d08b5b" },
  { label: "Tan",         value: "ae5d29" },
  { label: "Brown",       value: "794108" },
  { label: "Dark",        value: "613407" },
];

const ADVENTURER_HAIR_STYLES = [
  "short01", "short02", "short03", "short04", "short05",
  "long01", "long02", "long03", "long04", "long05",
];

const ADVENTURER_HAIR_COLORS = [
  { label: "Black",    value: "0e0e0e" },
  { label: "Brown",    value: "6a4e35" },
  { label: "Auburn",   value: "a55728" },
  { label: "Blonde",   value: "e8d5b7" },
  { label: "Red",      value: "c93305" },
  { label: "Platinum", value: "d6c4c2" },
  { label: "Blue",     value: "4A90D9" },
  { label: "Purple",   value: "9B59B6" },
];

const ADVENTURER_BG_COLORS = [
  { label: "Navy",     value: "04080F" },
  { label: "Electric", value: "4A90D9" },
  { label: "Gold",     value: "F0B429" },
  { label: "Green",    value: "2ECC71" },
  { label: "Red",      value: "E74C3C" },
  { label: "Purple",   value: "9B59B6" },
  { label: "Teal",     value: "1ABC9C" },
  { label: "Slate",    value: "607D8B" },
];

const EDUCATION_LEVELS = [
  "Middle School","High School","Undergraduate","Graduate","Self-Taught",
];

const STUDY_GOALS = [
  "Improve Grades","Test Prep","Learn for Fun","Career Growth","Competition Prep",
];

const RESERVED = ["admin","root","lionade","support","help","ninny"];

// Broken-avatar fallback: a stable DiceBear identicon keyed off a seed so a
// dead avatar_url (404 / CDN miss) never renders a broken-image glyph.
const dicebearFallback = (seed: string) =>
  `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(seed || "lionade")}`;

// One-shot <img onError> guard: swap to the DiceBear fallback exactly once so a
// fallback that itself fails can't loop.
function avatarOnError(seed: string) {
  return (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.dataset.fellBack === "1") return;
    img.dataset.fellBack = "1";
    img.src = dicebearFallback(seed);
  };
}

const NAV: { key: Section; label: string; Icon: Icon }[] = [
  { key: "overview",        label: "Overview",            Icon: ChartBar },
  { key: "edit-profile",    label: "Edit Profile",        Icon: PencilSimple },
  { key: "avatar",          label: "Avatar & Appearance", Icon: Palette },
  { key: "personalization", label: "Personalization",     Icon: Gear },
  { key: "privacy",         label: "Privacy",             Icon: Lock },
  { key: "security",        label: "Security",            Icon: Shield },
  { key: "activity",        label: "Activity History",    Icon: Calendar },
  { key: "notifications",   label: "Notifications",       Icon: Bell },
  { key: "about",           label: "About Lionade",       Icon: PawPrint },
];

// ── Main Page ──────────────────────────────────────────
export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { stats } = useUserStats(user?.id);
  // Shop V2 — equipped username effect for the profile header.
  const usernameEffect = useEquippedUsernameEffect();
  const [section, setSection] = useState<Section>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Data
  const [allBadges, setAllBadges] = useState<any[]>([]);
  const [earnedBadges, setEarnedBadges] = useState<any[]>([]);
  const [subjectStats, setSubjectStats] = useState<any[]>([]);
  const [quizHistory, setQuizHistory] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    refreshUser();
    Promise.all([
      getAllBadges().catch(() => []),
      getUserBadges(user.id).catch(() => []),
      getSubjectStats(user.id, { lifetime: true }).catch(() => []),
      getQuizHistory(user.id, 30).catch(() => []),
      getRecentActivity(user.id, 30).catch(() => []),
    ]).then(([all, earned, stats, history, act]) => {
      setAllBadges(all);
      setEarnedBadges(earned);
      setSubjectStats(stats);
      setQuizHistory(history);
      setActivity(act);
      setLoading(false);
    });
  }, [user?.id]);

  if (!user) return null;

  // Use SWR-cached stats to prevent flash-of-zero
  const coins = stats?.coins ?? user.coins;
  const streak = stats?.streak ?? user.streak;
  const xp = stats?.xp ?? user.xp;
  // Memoize so `<img src>` stays stable across renders (prevents flash on tab return).
  const avatarUrl = useMemo(
    () => stats?.avatar ?? user.avatar,
    [stats?.avatar, user.avatar],
  );
  const statsReady = !!stats || user.statsLoaded;
  const levelInfo = getLevelProgress(xp);
  const level = levelInfo.level;
  const progress = levelInfo.progressPercent;
  const xpToNext = levelInfo.xpNeededForNext;
  const totalQuestions = subjectStats.reduce((s: number, r: any) => s + r.questionsAnswered, 0);
  const totalCorrect = subjectStats.reduce((s: number, r: any) => s + r.correctAnswers, 0);
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const duelsWon = activity.filter((a: any) => a.type === "duel_win").length;

  const sharedProps = {
    user, level, progress, xpToNext,
    coins, streak, xp, avatarUrl, statsReady,
    allBadges, earnedBadges, subjectStats, quizHistory, activity,
    loading, accuracy, totalQuestions, totalCorrect, duelsWon,
    refreshUser,
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <BackButton />

          {/* Mobile header */}
          <div className="flex items-center justify-between mb-4 md:hidden">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-electric/50">
                <img src={avatarUrl} alt={`${user.username}'s avatar`} onError={avatarOnError(user.username)} className="w-9 h-9 rounded-full object-cover" />
              </div>
              <span className="font-bebas text-xl text-cream tracking-wider">
                {NAV.find(n => n.key === section)?.label}
              </span>
            </div>
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? "Close profile menu" : "Open profile menu"}
              aria-expanded={sidebarOpen}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-electric/20 text-cream/70 hover:text-cream hover:bg-white/5 transition-colors">
              <List size={22} weight="bold" aria-hidden="true" />
            </button>
          </div>

          <div className="flex gap-6">
            {/* ── Sidebar ── */}
            <aside className={`${sidebarOpen ? "flex" : "hidden"} md:flex flex-col w-64 flex-shrink-0`}>
              <div className="rounded-2xl border border-electric/20 overflow-hidden sticky top-20"
                style={{ background: "var(--sidebar-bg)" }}>

                {/* Profile mini card */}
                <div className="p-6 border-b border-electric/10 text-center">
                  <div className="relative w-20 h-20 mx-auto mb-3">
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-electric/50"
                      style={{ boxShadow: "0 0 20px #4A90D940" }}>
                      <img src={avatarUrl} alt={`${user.username}'s avatar`} onError={avatarOnError(user.username)} className="w-20 h-20 rounded-full object-cover" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-navy
                      flex items-center justify-center font-bebas text-xs text-white"
                      style={{ background: "#4A90D9" }}>{level}</div>
                  </div>
                  <p className="font-bebas text-xl text-cream tracking-wider">@<AnimatedUsername username={user.username} effect={usernameEffect} size="md" /></p>
                  <p className="text-cream/60 text-xs mt-0.5">Level {level} · {formatCoins(coins)} Fangs</p>
                  <div className="mt-3 w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full motion-safe:transition-all motion-safe:duration-500"
                      style={{ width: statsReady ? `${progress}%` : "0%", background: "linear-gradient(90deg, #2D6BB5, #4A90D9)" }} />
                  </div>
                  <p className="text-cream/55 text-xs mt-1 min-h-[1rem]">{statsReady ? `${xpToNext} XP to Level ${level + 1}` : ""}</p>
                </div>

                {/* Nav */}
                <nav className="p-3">
                  {NAV.map((item) => (
                    <button key={item.key}
                      onClick={() => { setSection(item.key); setSidebarOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold
                        transition-all duration-200 mb-0.5 text-left
                        ${section === item.key
                          ? "bg-electric/20 text-electric border border-electric/30"
                          : "text-cream/65 hover:text-cream hover:bg-white/5"}`}
                      aria-current={section === item.key ? "page" : undefined}>
                      <item.Icon size={18} weight={section === item.key ? "fill" : "regular"} color="currentColor" aria-hidden="true" className="w-5 flex-shrink-0" />
                      {item.label}
                    </button>
                  ))}
                </nav>
              </div>
            </aside>

            {/* ── Main content ── */}
            <div className="flex-1 min-w-0">
              {section === "overview"        && <OverviewSection {...sharedProps} />}
              {section === "edit-profile"    && <EditProfileSection {...sharedProps} />}
              {section === "avatar"          && <AvatarSection {...sharedProps} />}
              {section === "personalization" && <PersonalizationSection {...sharedProps} />}
              {section === "privacy"         && <PrivacySection {...sharedProps} />}
              {section === "security"        && <SecuritySection {...sharedProps} />}
              {section === "activity"        && <ActivitySection {...sharedProps} />}
              {section === "notifications"   && <NotificationsSection />}
              {section === "about"           && <AboutLionadeSection />}
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

// ── Shared prop type ──────────────────────────────────
type SharedProps = {
  user: any; level: number; progress: number; xpToNext: number;
  coins: number; streak: number; xp: number; avatarUrl: string;
  statsReady: boolean;
  allBadges: any[]; earnedBadges: any[]; subjectStats: any[];
  quizHistory: any[]; activity: any[];
  loading: boolean; accuracy: number; totalQuestions: number;
  totalCorrect: number; duelsWon: number;
  refreshUser: () => Promise<void>;
};

// ── Section header helper ─────────────────────────────
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-bebas text-3xl text-cream tracking-wider">{title}</h2>
      {sub && <p className="text-cream/55 text-sm mt-1">{sub}</p>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-electric/20 p-5 ${className}`}
      style={{ background: "var(--sidebar-bg)" }}>
      {children}
    </div>
  );
}

function SaveToast({ msg, isError = false }: { msg: string; isError?: boolean }) {
  return (
    <div role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"}
      className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold motion-safe:animate-slide-up
      ${isError ? "bg-red-400/10 border border-red-400/30 text-red-300" : "bg-green-400/10 border border-green-400/30 text-green-300"}`}>
      <span className="inline-flex items-center gap-1.5">{isError ? <Warning size={16} weight="fill" aria-hidden="true" /> : <Check size={16} weight="bold" aria-hidden="true" />} {msg}</span>
    </div>
  );
}

const inputCls = "w-full bg-white/5 border border-electric/20 rounded-xl px-4 py-3 text-cream placeholder-cream/35 text-sm focus:outline-none focus:border-electric transition-all";
const labelCls = "block text-cream/60 text-xs font-bold uppercase tracking-widest mb-1.5";

// ── Accessible confirm dialog ─────────────────────────
// role=dialog + aria-modal, focuses its first control on open, traps Tab,
// closes on Escape / backdrop, and restores focus to the trigger on close.
function ConfirmModal({
  titleId, title, children, confirmLabel, onConfirm, onCancel,
}: {
  titleId: string; title: string; children: React.ReactNode;
  confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    // Focus the first interactive control inside the dialog.
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(el => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreTo?.focus?.();
    };
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm motion-safe:animate-fade-in"
      role="dialog" aria-modal="true" aria-labelledby={titleId}
    >
      <div ref={panelRef} onClick={(e) => e.stopPropagation()}
        className="rounded-2xl border border-electric/20 p-6 max-w-md w-full motion-safe:animate-slide-up"
        style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}>
        <h3 id={titleId} className="font-bebas text-2xl text-cream tracking-wider mb-2">{title}</h3>
        <div className="text-cream/70 text-sm mb-5 leading-relaxed">{children}</div>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-3 rounded-xl border border-electric/20 text-cream/70 text-sm font-bold hover:bg-white/5 transition-all">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-3 rounded-xl font-bold text-sm text-navy transition-all"
            style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── OVERVIEW ───────────────────────────────────────────
// Rarity ranking + tier accent (mirrors /badges page tone)
const RARITY_RANK_OVERVIEW: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };
const RARITY_TIERS: { id: "legendary" | "epic" | "rare" | "common"; label: string; color: string }[] = [
  { id: "legendary", label: "Legendary", color: "#FFD700" },
  { id: "epic",      label: "Epic",      color: "#9B59B6" },
  { id: "rare",      label: "Rare",      color: "#4A90D9" },
  { id: "common",    label: "Common",    color: "#9CA3AF" },
];

function OverviewSection({ user, level, progress, xpToNext, coins, streak, xp, avatarUrl, statsReady, earnedBadges, allBadges, subjectStats, quizHistory, activity, loading, accuracy, totalQuestions, totalCorrect, duelsWon, refreshUser }: SharedProps) {
  const lockedBadges = allBadges.filter(b => !earnedBadges.some((e: any) => e.id === b.id));
  const [shareOpen, setShareOpen] = useState(false);
  // Shop V2: ALL equipped cosmetics for the overview hero (self-view money moment).
  const cosmetics = useEquippedCosmetics();
  const usernameEffect = cosmetics.effect;
  // Empty banner = the intentional default ambient interstellar gradient.
  const bannerStyle = useMemo(() => getBannerStyle(cosmetics.banner), [cosmetics.banner]);

  // Group badges by rarity tier for the All Badges section.
  const earnedByTier = useMemo(() => {
    const buckets: Record<string, any[]> = { legendary: [], epic: [], rare: [], common: [] };
    earnedBadges.forEach((b: any) => {
      const r = (b.rarity ?? "common") as string;
      (buckets[r] ?? buckets.common).push(b);
    });
    return buckets;
  }, [earnedBadges]);

  const lockedByTier = useMemo(() => {
    const buckets: Record<string, any[]> = { legendary: [], epic: [], rare: [], common: [] };
    lockedBadges.forEach((b: any) => {
      const r = (b.rarity ?? "common") as string;
      (buckets[r] ?? buckets.common).push(b);
    });
    return buckets;
  }, [lockedBadges]);

  return (
    <div className="space-y-6 animate-slide-up profile-overview">
      {/* Scoped GPU-only animations + lift utilities */}
      <style jsx>{`
        .profile-overview :global(.profile-lift) {
          transition: transform 220ms cubic-bezier(.2,.7,.2,1), box-shadow 220ms ease;
          will-change: transform;
        }
        .profile-overview :global(.profile-lift:hover) {
          transform: translate3d(0, -2px, 0);
        }
        .profile-overview :global(.profile-badge-lift) {
          transition: transform 220ms cubic-bezier(.2,.7,.2,1);
          will-change: transform;
        }
        .profile-overview :global(.profile-badge-lift:hover) {
          transform: scale(1.04);
        }
        @keyframes profile-aurora-drift {
          0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.18; }
          50%      { transform: translate3d(-12px, 8px, 0) scale(1.06); opacity: 0.28; }
        }
        @keyframes profile-ring-pulse {
          0%, 100% { box-shadow: 0 0 22px rgba(74,144,217,0.35), 0 0 0 0 rgba(74,144,217,0.18); }
          50%      { box-shadow: 0 0 32px rgba(74,144,217,0.55), 0 0 0 6px rgba(74,144,217,0.05); }
        }
        .profile-overview :global(.profile-aurora) {
          animation: profile-aurora-drift 12s ease-in-out infinite;
          will-change: transform, opacity;
        }
        .profile-overview :global(.profile-avatar-ring) {
          animation: profile-ring-pulse 6s ease-in-out infinite;
          will-change: box-shadow;
        }
        @media (prefers-reduced-motion: reduce) {
          .profile-overview :global(.profile-aurora),
          .profile-overview :global(.profile-avatar-ring) { animation: none !important; }
          .profile-overview :global(.profile-lift:hover),
          .profile-overview :global(.profile-badge-lift:hover) { transform: none !important; }
        }
      `}</style>

      {/* Hero card */}
      <Card className="relative overflow-hidden !p-0">
        {/* Banner strip — full-bleed, clips to the card's rounded corners.
            96px mobile / 140px desktop. Empty = default ambient interstellar
            gradient (never a blank box). Animated by BANNER_STYLES id. */}
        <div
          aria-hidden="true"
          className={`relative w-full h-24 sm:h-[140px] overflow-hidden ${cosmetics.banner ? (bannerStyle.animClass ?? "") : ""}`}
          style={{
            background: bannerStyle.background,
            backgroundSize: cosmetics.banner ? bannerStyle.backgroundSize : undefined,
          }}
        >
          {/* Soft scrim at the bottom so the avatar / text read cleanly. */}
          <div
            className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
            style={{ background: "linear-gradient(to bottom, transparent, rgba(6,12,24,0.6))" }}
          />
        </div>

        <div className="relative p-5 pt-0">
          {/* Aurora glow (GPU only) */}
          <div
            className="profile-aurora absolute -top-16 -right-16 w-80 h-80 rounded-full blur-3xl pointer-events-none"
            style={{ background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)" }}
            aria-hidden="true"
          />
          <div
            className="profile-aurora absolute -bottom-24 -left-20 w-72 h-72 rounded-full blur-3xl pointer-events-none"
            style={{ background: "radial-gradient(circle, #9B59B6 0%, transparent 70%)", animationDelay: "3s" }}
            aria-hidden="true"
          />

          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label="Share profile"
            className="absolute top-3 right-3 z-20 inline-flex items-center justify-center gap-1.5 min-h-[36px] rounded-full border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/75 hover:text-cream transition-colors"
          >
            <ShareNetwork size={11} weight="fill" aria-hidden="true" /> Share
          </button>

          <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="flex flex-col items-center gap-2 flex-shrink-0 -mt-12 sm:-mt-14">
              {/* Avatar half-overlaps the banner's bottom edge, with equipped
                  frame + aura cosmetics. */}
              <Avatar
                url={avatarUrl}
                alt={user.username}
                size="xl"
                frame={cosmetics.frame}
                aura={cosmetics.aura}
                className="rounded-full ring-4 ring-navy"
              />
              <div
                className="-mt-3 px-3 py-1 rounded-full font-bebas text-sm tracking-wider text-navy relative z-10"
                style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 60%, #F0B429 100%)", boxShadow: "0 4px 12px rgba(240,180,41,0.35)" }}
              >
                LVL {level}
              </div>
            </div>

          <div className="flex-1 text-center sm:text-left min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/55 mb-1">
              Player Profile
            </p>
            <h1 className="font-bebas text-5xl text-cream tracking-wider leading-none mb-1">
              <AnimatedUsername username={user.username} effect={usernameEffect} nameColor={cosmetics.nameColor} size="lg" className="font-bebas tracking-wider text-5xl" />
            </h1>
            {user.displayName && user.displayName !== user.username && (
              <p className="text-cream/60 text-sm mb-3">{user.displayName}</p>
            )}

            {/* Chips row: flair + streak + accuracy + badges */}
            <div className="flex flex-wrap justify-center sm:justify-start gap-2 mb-4">
              <EquippedFlair flair={cosmetics.flair} />
              {statsReady && streak > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-orange-400/30 bg-orange-400/10">
                  <Fire size={12} weight="fill" color="#FB923C" aria-hidden="true" />
                  <span className="font-bebas text-sm text-orange-300 tracking-wider">{streak}d streak</span>
                </span>
              )}
              {!loading && earnedBadges.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-gold/30 bg-gold/10">
                  <MedalMilitary size={12} weight="fill" color="#FFD700" aria-hidden="true" />
                  <span className="font-bebas text-sm text-gold tracking-wider">{earnedBadges.length} badges</span>
                </span>
              )}
              {totalQuestions > 0 && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-green-400/30 bg-green-400/10">
                  <Target size={12} weight="fill" color="#22C55E" aria-hidden="true" />
                  <span className="font-bebas text-sm text-green-300 tracking-wider">{accuracy}% accuracy</span>
                </span>
              )}
            </div>

            <div className="mb-1">
              <div className="flex justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-cream/55 mb-1.5">
                <span>Level {level}</span>
                <span>{statsReady ? `${xpToNext} XP to Lvl ${level + 1}` : " "}</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden"
                role="progressbar"
                aria-label={`Level ${level} progress`}
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={statsReady ? Math.round(progress) : undefined}>
                <div className="h-full rounded-full motion-safe:transition-all motion-safe:duration-500"
                  style={{ width: statsReady ? `${progress}%` : "0%", background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 10px #4A90D960" }} />
              </div>
            </div>
          </div>
          </div>
        </div>
      </Card>

      <ShareCard
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shareTitle={`profile-${user.username}`}
        card={{
          headline: "I'M ON LIONADE",
          subline: `@${user.username} · Level ${level}`,
          bigNumber: { value: formatCoins(coins), label: "Fangs earned" },
          stats: [
            { label: "Streak", value: `${streak}d` },
            { label: "Accuracy", value: `${accuracy}%` },
          ],
          accent: "#FFD700",
        }}
      />

      {/* Stats grid: each stat is a trophy with a tinted icon chip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {([
          { kind: "fang" as const, label: "Total Fangs",        value: statsReady ? formatCoins(coins) : null,          color: "text-gold",         iconColor: "#FFD700" },
          { kind: "icon" as const, Icon: Fire,                  label: "Day Streak",         value: statsReady ? `${streak}` : null,                 color: "text-orange-400", iconColor: "#FB923C" },
          { kind: "icon" as const, Icon: Lightning,             label: "Total XP",           value: statsReady ? xp.toLocaleString() : null,         color: "text-electric",   iconColor: "#4A90D9" },
          { kind: "icon" as const, Icon: NotePencil,            label: "Quizzes Completed",  value: !loading ? quizHistory.length.toString() : null, color: "text-cream",      iconColor: "#EEF4FF" },
          { kind: "icon" as const, Icon: Sword,                 label: "Duels Won",          value: !loading ? duelsWon.toString() : null,           color: "text-purple-400", iconColor: "#A855F7" },
          { kind: "icon" as const, Icon: BookOpen,              label: "Subjects Mastered",  value: !loading ? subjectStats.length.toString() : null, color: "text-green-400",  iconColor: "#22C55E" },
        ]).map((s) => (
          <Card key={s.label} className="text-center !p-4 profile-lift relative overflow-hidden">
            {/* Tinted chip around icon */}
            <div
              className="w-11 h-11 rounded-full mx-auto mb-2 flex items-center justify-center border"
              style={{ background: `${s.iconColor}1A`, borderColor: `${s.iconColor}33` }}
            >
              {s.kind === "fang"
                ? <img src={cdnUrl("/F.png")} alt="" aria-hidden="true" className="w-6 h-6 object-contain" />
                : <s.Icon size={22} weight="fill" color={s.iconColor} aria-hidden="true" />}
            </div>
            {s.value !== null
              ? <p className={`font-bebas text-3xl leading-none tracking-wider ${s.color}`}>{s.value}</p>
              : <div className="w-14 h-8 bg-white/10 rounded-lg animate-pulse mx-auto" />}
            <p className="text-cream/60 text-[10px] font-mono uppercase tracking-[0.18em] mt-2">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent badges */}
        <Card>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bebas text-xl text-cream tracking-wider">RECENT BADGES</h3>
            <Link href="/badges" className="text-electric text-xs font-semibold hover:text-cream transition-colors">
              {loading ? <span className="text-cream/30">—</span> : `${earnedBadges.length} earned`}
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2 py-2" aria-hidden="true">
              <div className="h-10 bg-white/10 rounded-lg animate-pulse" />
              <div className="h-10 bg-white/10 rounded-lg animate-pulse" />
            </div>
          ) : earnedBadges.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center border border-gold/20 bg-gold/5">
                <Lock size={20} weight="regular" color="rgba(240,180,41,0.6)" aria-hidden="true" />
              </div>
              <p className="text-cream/60 text-sm mb-3">No badges yet</p>
              <Link href="/quiz" className="inline-block font-syne font-semibold text-xs px-4 py-2 rounded-full border border-electric/30 text-electric hover:bg-electric/10 transition-colors">
                Complete a quiz to earn one
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {earnedBadges.slice(0, 6).map((b: any) => (
                <div key={b.id} className="profile-badge-lift">
                  <BadgeCard badge={{ ...b, description: b.description ?? "", rarity: b.rarity as any, earnedAt: b.earnedAt }} size="sm" earned />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent activity: tinted chip icons (matches dashboard e106e2b) */}
        <Card>
          <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">RECENT ACTIVITY</h3>
          {loading ? (
            <div className="space-y-2 py-2" aria-hidden="true">
              <div className="h-10 bg-white/10 rounded-lg animate-pulse" />
              <div className="h-10 bg-white/10 rounded-lg animate-pulse" />
            </div>
          ) : activity.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center border border-electric/20 bg-electric/5">
                <Lightning size={20} weight="regular" color="rgba(74,144,217,0.7)" aria-hidden="true" />
              </div>
              <p className="text-cream/60 text-sm mb-3">No activity yet</p>
              <Link href="/quiz" className="inline-block font-syne font-semibold text-xs px-4 py-2 rounded-full border border-electric/30 text-electric hover:bg-electric/10 transition-colors">
                Take your first quiz
              </Link>
            </div>
          ) : (
            <div className="space-y-1.5">
              {activity.slice(0, 8).map((a: any, i: number) => {
                const isDuel  = a.type === "duel_win";
                const isBadge = a.type === "badge_bonus";
                const tint    = isDuel ? "#A855F7" : isBadge ? "#FFD700" : "#4A90D9";
                const Icon    = isDuel ? Sword : isBadge ? MedalMilitary : NotePencil;
                return (
                  <div key={i} className="flex justify-between items-center py-1.5 border-b border-electric/10 last:border-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border"
                        style={{ background: `${tint}1A`, borderColor: `${tint}33` }}
                      >
                        <Icon size={13} weight={isBadge || isDuel ? "fill" : "regular"} color={tint} aria-hidden="true" />
                      </div>
                      <span className="text-cream/75 text-xs truncate">{a.description}</span>
                    </div>
                    <span className={`font-bebas text-sm flex-shrink-0 tracking-wider ${a.amount > 0 ? "text-gold" : "text-cream/55"}`}>
                      {a.amount > 0 ? `+${a.amount}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* All badges, grouped by rarity tier */}
      <Card>
        <div className="flex justify-between items-baseline mb-1">
          <h3 className="font-bebas text-xl text-cream tracking-wider">BADGE COLLECTION</h3>
          {allBadges.length > 0 && (
            <span className="text-cream/60 text-xs font-mono uppercase tracking-[0.18em]">
              {earnedBadges.length} / {allBadges.length}
            </span>
          )}
        </div>
        <p className="text-cream/55 text-[11px] font-mono uppercase tracking-[0.18em] mb-5">
          Sorted by rarity
        </p>

        {earnedBadges.length === 0 && lockedBadges.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-cream/55 text-sm">Badges will appear here as you earn them.</p>
          </div>
        ) : (
          <>
            {/* Earned: grouped by rarity, legendary first */}
            {earnedBadges.length > 0 && RARITY_TIERS.map(tier => {
              const items = earnedByTier[tier.id] ?? [];
              if (items.length === 0) return null;
              return (
                <div key={`earned-${tier.id}`} className="mb-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: tier.color, boxShadow: `0 0 6px ${tier.color}` }}
                    />
                    <p
                      className="text-[10px] font-bold uppercase tracking-[0.22em]"
                      style={{ color: tier.color }}
                    >
                      {tier.label} · {items.length}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {items.map((b: any) => (
                      <div key={b.id} className="profile-badge-lift">
                        <BadgeCard badge={{ ...b, description: b.description ?? "", rarity: b.rarity as any, earnedAt: b.earnedAt }} size="sm" earned />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Locked: same grouping, dimmed via BadgeCard earned=false */}
            {lockedBadges.length > 0 && (
              <div className="border-t border-electric/10 pt-5 mt-5">
                <p className="text-cream/55 text-[10px] font-bold uppercase tracking-[0.22em] mb-4">
                  Locked · {lockedBadges.length}
                </p>
                {RARITY_TIERS.map(tier => {
                  const items = lockedByTier[tier.id] ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div key={`locked-${tier.id}`} className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="w-1.5 h-1.5 rounded-full opacity-50"
                          style={{ background: tier.color }}
                        />
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cream/55">
                          {tier.label} · {items.length}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {items.map((b: any) => (
                          <div key={b.id} className="profile-badge-lift">
                            <BadgeCard badge={{ ...b, description: b.description ?? "", rarity: b.rarity as any }} size="sm" earned={false} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

// ── EDIT PROFILE ───────────────────────────────────────
function EditProfileSection({ user, refreshUser }: SharedProps) {
  const [firstName, setFirstName] = useState(user.displayName ?? "");
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState("");
  const [education, setEducation] = useState("");
  const [studyGoal, setStudyGoal] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle"|"checking"|"available"|"taken">("idle");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{msg: string; err: boolean}|null>(null);
  const [usernameLocked, setUsernameLocked] = useState(false);
  const [usernameUnlockDate, setUsernameUnlockDate] = useState<string|null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Load current profile data + username change cooldown
  useEffect(() => {
    supabase.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data }: any) => {
        if (!data) return;
        if (data.display_name)    setFirstName(data.display_name);
        if (data.bio)             setBio(data.bio);
        if (data.education_level) setEducation(data.education_level);
        if (data.study_goal)      setStudyGoal(data.study_goal);
      });

    // Check last username change
    supabase.from("username_changes")
      .select("changed_at")
      .eq("user_id", user.id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data) {
          const daysSince = (Date.now() - new Date(data.changed_at).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < 365) {
            setUsernameLocked(true);
            const nextDate = new Date(new Date(data.changed_at).getTime() + 365 * 24 * 60 * 60 * 1000);
            setUsernameUnlockDate(nextDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
          }
        }
      });
  }, [user.id]);

  // Username availability debounce
  useEffect(() => {
    if (usernameLocked) return;
    if (username === user.username) { setUsernameStatus("idle"); return; }
    if (username.length < 3) { setUsernameStatus("idle"); return; }
    if (RESERVED.includes(username)) { setUsernameStatus("taken"); return; }
    setUsernameStatus("checking");
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id").eq("username", username).neq("id", user.id).maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 500);
    return () => clearTimeout(t);
  }, [username, usernameLocked]);

  const handleSave = async () => {
    if (usernameStatus === "taken") { setToast({ msg: "Username already taken", err: true }); return; }
    if (usernameStatus === "checking") { setToast({ msg: "Wait for username check", err: true }); return; }

    // If username changed, show confirmation first
    const usernameChanged = username.trim().toLowerCase() !== user.username && !usernameLocked;
    if (usernameChanged && !showConfirm) {
      setShowConfirm(true);
      return;
    }
    setShowConfirm(false);
    setSaving(true);

    // If username changed, use the server API route
    if (usernameChanged) {
      const res = await apiPost<{ success: boolean }>("/api/change-username", {
        newUsername: username.trim().toLowerCase(),
      });
      if (!res.ok) {
        setToast({ msg: res.error ?? "Failed to change username", err: true });
        setSaving(false);
        return;
      }
    }

    // Save other profile fields via the moderated server route (display_name +
    // bio are public, user-authored UGC and must be moderated; the old direct
    // client update bypassed that). Username is handled above via its own route.
    const updates = {
      display_name: firstName.trim(),
      bio: bio.trim(),
      education_level: education,
      study_goal: studyGoal,
    };
    const saveRes = await apiPost<{ success: boolean }>("/api/user/profile-update", updates);
    if (!saveRes.ok) {
      setToast({ msg: saveRes.error ?? "Failed to save profile", err: true });
    } else {
      await supabase.auth.updateUser({ data: { display_name: updates.display_name } });
      await refreshUser();
      mutateUserStats(user.id);
      setToast({ msg: "Profile updated!", err: false });
      if (usernameChanged) {
        setUsernameLocked(true);
        const nextDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        setUsernameUnlockDate(nextDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
      }
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="EDIT PROFILE" sub="Update your public profile information" />

      {/* Username change confirmation modal */}
      {showConfirm && (
        <ConfirmModal
          titleId="confirm-username-title"
          title="CONFIRM USERNAME CHANGE"
          confirmLabel="Confirm Change"
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleSave}
        >
          You can only change your username <span className="text-gold font-semibold">once per year</span>. Are you sure you want to change from{" "}
          <span className="text-electric font-semibold">@{user.username}</span> to{" "}
          <span className="text-electric font-semibold">@{username.trim().toLowerCase()}</span>?
        </ConfirmModal>
      )}

      <Card>
        <div className="space-y-5">
          <div>
            <label htmlFor="profile-firstname" className={labelCls}>First Name / Display Name</label>
            <input id="profile-firstname" value={firstName} onChange={e => setFirstName(e.target.value)}
              placeholder="Your name" className={inputCls} />
          </div>

          <div>
            <label htmlFor="profile-username" className={labelCls}>Username</label>
            <div className="relative">
              <input id="profile-username" value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="your_handle"
                disabled={usernameLocked}
                aria-describedby="profile-username-hint"
                className={inputCls + " pr-28" + (usernameLocked ? " opacity-50 cursor-not-allowed" : "")} />
              <span role="status" aria-live="polite">
                {!usernameLocked && usernameStatus === "checking" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-cream/55 text-xs">Checking...</span>}
                {!usernameLocked && usernameStatus === "available" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-300 text-xs font-semibold inline-flex items-center gap-1"><Check size={12} weight="bold" aria-hidden="true" /> Available</span>}
                {!usernameLocked && usernameStatus === "taken"     && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-300 text-xs font-semibold inline-flex items-center gap-1"><XIcon size={12} weight="bold" aria-hidden="true" /> Taken</span>}
              </span>
            </div>
            {usernameLocked && usernameUnlockDate ? (
              <p id="profile-username-hint" className="text-amber-300 text-xs mt-1">You can change your username again on {usernameUnlockDate}</p>
            ) : (
              <p id="profile-username-hint" className="text-cream/55 text-xs mt-1">Usernames can only be changed once per year</p>
            )}
          </div>

          <div>
            <label htmlFor="profile-bio" className={labelCls}>Bio <span className={`normal-case font-normal ${bio.length >= 140 ? "text-red-300" : "text-cream/55"}`}>({bio.length}/150)</span></label>
            <textarea id="profile-bio" value={bio} onChange={e => setBio(e.target.value.slice(0, 150))}
              placeholder="Tell the world who you are..." rows={3}
              className={inputCls + " resize-none"} />
          </div>

          <div>
            <label htmlFor="profile-education" className={labelCls}>Education Level</label>
            <select id="profile-education" value={education} onChange={e => setEducation(e.target.value)}
              className="w-full bg-[#0a1020] border border-electric/20 rounded-xl px-4 py-3 text-cream text-sm focus:outline-none focus:border-electric transition-all appearance-none">
              <option value="">Select...</option>
              {EDUCATION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="profile-studygoal" className={labelCls}>Primary Study Goal</label>
            <select id="profile-studygoal" value={studyGoal} onChange={e => setStudyGoal(e.target.value)}
              className="w-full bg-[#0a1020] border border-electric/20 rounded-xl px-4 py-3 text-cream text-sm focus:outline-none focus:border-electric transition-all appearance-none">
              <option value="">Select...</option>
              {STUDY_GOALS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {toast && <SaveToast msg={toast.msg} isError={toast.err} />}

          <button onClick={handleSave} disabled={saving || usernameStatus === "checking"}
            className="w-full py-3.5 rounded-xl font-bold text-sm disabled:opacity-60 transition-all flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
            {saving && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── AVATAR & APPEARANCE ───────────────────────────────
function AvatarSection({ user, refreshUser }: SharedProps) {
  const [tab, setTab] = useState<"styles"|"create">("styles");
  const [selectedStyle, setSelectedStyle] = useState(DICEBEAR_STYLES[0].id);
  const [seeds, setSeeds] = useState(DEFAULT_SEEDS);
  const [selectedSeed, setSelectedSeed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{msg: string; err: boolean}|null>(null);

  // Create Avatar state
  const [avSkin, setAvSkin] = useState(ADVENTURER_SKIN_TONES[0].value);
  const [avHair, setAvHair] = useState(ADVENTURER_HAIR_STYLES[0]);
  const [avHairColor, setAvHairColor] = useState(ADVENTURER_HAIR_COLORS[1].value);
  const [avBg, setAvBg] = useState(ADVENTURER_BG_COLORS[1].value);

  const buildAdventurerUrl = (skin: string, hair: string, hairColor: string, bg: string) =>
    `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(user.username)}&skinColor=${skin}&hair=${hair}&hairColor=${hairColor}&backgroundColor=${bg}`;

  const adventurerPreview = buildAdventurerUrl(avSkin, avHair, avHairColor, avBg);

  // Build the preview URL for styles tab
  const previewUrl = useMemo(() => {
    if (tab === "styles" && selectedSeed) {
      return `https://api.dicebear.com/7.x/${selectedStyle}/svg?seed=${selectedSeed}`;
    }
    if (tab === "create") return adventurerPreview;
    return null;
  }, [tab, selectedStyle, selectedSeed, adventurerPreview]);

  // What the user currently has saved
  const currentAvatarUrl = user.avatar;

  // Determine if the current selection differs from saved
  const hasChange = (tab === "styles" && previewUrl && previewUrl !== currentAvatarUrl)
    || (tab === "create" && adventurerPreview !== currentAvatarUrl);

  // Style label for display
  const currentStyleLabel = selectedSeed
    ? DICEBEAR_STYLES.find(s => s.id === selectedStyle)?.label ?? selectedStyle
    : null;

  const saveAvatar = async (url: string) => {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    if (!error) {
      await supabase.auth.updateUser({ data: { avatar_url: url } });
      await refreshUser();
      mutateUserStats(user.id);
      setToast({ msg: "Avatar updated!", err: false });
    } else {
      setToast({ msg: error.message, err: true });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveClick = () => {
    if (tab === "styles" && previewUrl) {
      saveAvatar(previewUrl);
    } else if (tab === "create") {
      saveAvatar(adventurerPreview);
    }
  };

  const randomizeSeeds = () => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    const newSeeds = Array.from({ length: 12 }, () => {
      const len = 4 + Math.floor(Math.random() * 5);
      return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    });
    setSeeds(newSeeds);
    setSelectedSeed(null);
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="AVATAR & APPEARANCE" sub="Choose how you look to the world" />

      {/* Current avatar preview */}
      <Card className="flex items-center gap-5">
        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-electric/50 flex-shrink-0"
          style={{ boxShadow: "0 0 15px #4A90D940" }}>
          <img src={previewUrl ?? currentAvatarUrl} alt="preview" className="w-full h-full object-cover" />
        </div>
        <div className="min-w-0">
          <p className="text-cream font-bold">
            {hasChange ? "Preview" : "Current Avatar"}
          </p>
          {tab === "styles" && selectedSeed ? (
            <p className="text-cream/60 text-sm mt-0.5 truncate">{currentStyleLabel} &middot; {selectedSeed}</p>
          ) : (
            <p className="text-cream/60 text-sm mt-0.5">Pick a new one below, then save</p>
          )}
        </div>
        {hasChange && (
          <button onClick={handleSaveClick} disabled={saving}
            className="ml-auto px-5 py-2.5 rounded-xl font-bold text-sm disabled:opacity-60 flex items-center gap-2 flex-shrink-0 transition-all"
            style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
            {saving && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {saving ? "Saving..." : "Save Avatar"}
          </button>
        )}
      </Card>

      {toast && <SaveToast msg={toast.msg} isError={toast.err} />}

      {/* Tabs */}
      <div role="tablist" aria-label="Avatar source" className="flex gap-1 bg-white/5 p-1 rounded-xl border border-electric/10 max-w-md mx-auto">
        {(["styles","create"] as const).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors text-center
              ${tab === t ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/60 hover:text-cream"}`}>
            <span className="inline-flex items-center gap-1.5">{t === "styles" ? <><MaskHappy size={14} weight="fill" aria-hidden="true" /> Styles</> : <><Sparkle size={14} weight="fill" aria-hidden="true" /> Create</>}</span>
          </button>
        ))}
      </div>

      {/* Styles tab — DiceBear style picker */}
      {tab === "styles" && (
        <Card>
          {/* Style category pills — horizontal scroll */}
          <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-thin mb-5">
            {DICEBEAR_STYLES.map(s => (
              <button key={s.id} onClick={() => { setSelectedStyle(s.id); setSelectedSeed(null); }}
                aria-pressed={selectedStyle === s.id}
                className={`px-4 py-2 rounded-full text-xs font-bold transition-colors flex-shrink-0 whitespace-nowrap
                  ${selectedStyle === s.id
                    ? "bg-electric/20 text-electric border border-electric/40"
                    : "text-cream/60 hover:text-cream hover:bg-white/5 border border-transparent"}`}>
                {s.label}
              </button>
            ))}
          </div>

          {/* 4×3 avatar grid */}
          <div className="grid grid-cols-4 gap-3 mb-5">
            {seeds.map(seed => {
              const url = `https://api.dicebear.com/7.x/${selectedStyle}/svg?seed=${seed}`;
              const isActive = selectedSeed === seed;
              return (
                <button key={seed} onClick={() => setSelectedSeed(seed)}
                  aria-pressed={isActive}
                  aria-label={`Avatar option ${seed}`}
                  className={`aspect-square rounded-2xl overflow-hidden border-2 motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-105
                    ${isActive ? "border-amber-400 shadow-lg shadow-amber-400/20 motion-safe:scale-105" : "border-white/10 hover:border-white/20"}`}
                  style={{ background: "rgba(10,16,32,0.6)" }}>
                  <img src={url} alt="" aria-hidden="true" className="w-full h-full object-cover p-2" loading="lazy" />
                </button>
              );
            })}
          </div>

          {/* Randomize button */}
          <button onClick={randomizeSeeds}
            className="w-full py-3 rounded-xl border border-electric/20 text-cream/70 text-sm font-bold hover:bg-white/5 hover:text-cream transition-all flex items-center justify-center gap-2">
            <DiceFive size={20} weight="regular" aria-hidden="true" /> Randomize
          </button>
        </Card>
      )}

      {/* Create Avatar tab */}
      {tab === "create" && (
        <Card>
          {/* Live preview */}
          <div className="flex justify-center mb-6">
            <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-electric/50"
              style={{ boxShadow: "0 0 30px #4A90D940" }}>
              <img src={adventurerPreview} alt="avatar preview" className="w-full h-full object-cover" />
            </div>
          </div>

          {/* Skin Tone */}
          <div className="mb-5">
            <p className="text-cream/65 text-xs font-bold uppercase tracking-widest mb-2">Skin Tone</p>
            <div className="flex gap-2">
              {ADVENTURER_SKIN_TONES.map(s => (
                <button key={s.value} onClick={() => setAvSkin(s.value)}
                  aria-label={`Skin tone: ${s.label}`} aria-pressed={avSkin === s.value} title={s.label}
                  className={`w-11 h-11 rounded-full motion-safe:transition-transform motion-safe:hover:scale-110 ${avSkin === s.value ? "ring-2 ring-electric ring-offset-2 ring-offset-[#060c18] motion-safe:scale-110" : ""}`}
                  style={{ background: `#${s.value}` }} />
              ))}
            </div>
          </div>

          {/* Hair Style */}
          <div className="mb-5">
            <p className="text-cream/65 text-xs font-bold uppercase tracking-widest mb-2">Hair Style</p>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {ADVENTURER_HAIR_STYLES.map(h => {
                const hairPreviewUrl = `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(user.username)}&skinColor=${avSkin}&hair=${h}&hairColor=${avHairColor}&backgroundColor=${avBg}&size=64`;
                return (
                  <button key={h} onClick={() => setAvHair(h)}
                    aria-label={`Hair style ${h}`} aria-pressed={avHair === h}
                    className={`w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border-2 motion-safe:transition-transform motion-safe:hover:scale-105
                      ${avHair === h ? "border-electric shadow-lg shadow-electric/30" : "border-white/10 hover:border-white/20"}`}>
                    <img src={hairPreviewUrl} alt="" aria-hidden="true" className="w-full h-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hair Color */}
          <div className="mb-5">
            <p className="text-cream/65 text-xs font-bold uppercase tracking-widest mb-2">Hair Color</p>
            <div className="flex gap-2">
              {ADVENTURER_HAIR_COLORS.map(c => (
                <button key={c.value} onClick={() => setAvHairColor(c.value)}
                  aria-label={`Hair color: ${c.label}`} aria-pressed={avHairColor === c.value} title={c.label}
                  className={`w-11 h-11 rounded-full motion-safe:transition-transform motion-safe:hover:scale-110 ${avHairColor === c.value ? "ring-2 ring-electric ring-offset-2 ring-offset-[#060c18] motion-safe:scale-110" : ""}`}
                  style={{ background: `#${c.value}` }} />
              ))}
            </div>
          </div>

          {/* Background Color */}
          <div>
            <p className="text-cream/65 text-xs font-bold uppercase tracking-widest mb-2">Background Color</p>
            <div className="flex gap-2">
              {ADVENTURER_BG_COLORS.map(c => (
                <button key={c.value} onClick={() => setAvBg(c.value)}
                  aria-label={`Background color: ${c.label}`} aria-pressed={avBg === c.value} title={c.label}
                  className={`w-11 h-11 rounded-full motion-safe:transition-transform motion-safe:hover:scale-110 ${avBg === c.value ? "ring-2 ring-electric ring-offset-2 ring-offset-[#060c18] motion-safe:scale-110" : ""}`}
                  style={{ background: `#${c.value}`, border: c.value === "04080F" ? "2px solid rgba(74,144,217,0.3)" : "none" }} />
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── PERSONALIZATION ────────────────────────────────────
function PersonalizationSection({ user }: SharedProps) {
  const SUBJECTS = ["Math","Science","Languages","SAT/ACT","Coding","Finance","Certifications"];
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">("medium");
  const [prefSubjects, setPrefSubjects] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  // Load prefs: localStorage first (instant), then Supabase (source of truth)
  useEffect(() => {
    setTheme((localStorage.getItem("theme") as any) || "dark");
    setFontSize((localStorage.getItem("fontSize") as any) || "medium");
    try { setPrefSubjects(JSON.parse(localStorage.getItem("prefSubjects") ?? "[]")); } catch { /* */ }

    if (user?.id) {
      getPreferences(user.id).then(p => {
        setTheme(p.theme);
        setFontSize(p.font_size);
        setPrefSubjects(p.preferred_subjects);
        localStorage.setItem("theme", p.theme);
        localStorage.setItem("fontSize", p.font_size);
        localStorage.setItem("prefSubjects", JSON.stringify(p.preferred_subjects));
        const el = document.documentElement;
        el.dataset.theme = p.theme;
        el.dataset.fontSize = p.font_size;
        el.classList.toggle("light", p.theme === "light");
        window.dispatchEvent(new Event("themechange"));
      }).catch(() => {});
    }
  }, [user?.id]);

  const autoSave = (updates: Partial<UserPreferences>) => {
    const newTheme = updates.theme ?? theme;
    const newFs = updates.font_size ?? fontSize;

    if (updates.theme !== undefined) { setTheme(updates.theme); localStorage.setItem("theme", updates.theme); }
    if (updates.font_size !== undefined) { setFontSize(updates.font_size); localStorage.setItem("fontSize", updates.font_size); }
    if (updates.preferred_subjects !== undefined) { setPrefSubjects(updates.preferred_subjects); localStorage.setItem("prefSubjects", JSON.stringify(updates.preferred_subjects)); }

    const el = document.documentElement;
    el.dataset.theme = newTheme;
    el.dataset.fontSize = newFs;
    el.classList.toggle("light", newTheme === "light");
    window.dispatchEvent(new Event("themechange"));

    if (user?.id) {
      updatePreferences(user.id, updates).then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }).catch(() => {});
    }
  };

  const toggleSubject = (s: string) => {
    const next = prefSubjects.includes(s) ? prefSubjects.filter(x => x !== s) : [...prefSubjects, s];
    autoSave({ preferred_subjects: next });
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="PERSONALIZATION" sub="Customize your Lionade experience" />

      {/* Cosmetic Locker — manage every owned cosmetic in one place with a live
          preview. Equipping here updates the profile hero instantly (shared
          cosmetics-owned SWR key). Owner-only: this whole section is the self
          settings tab inside <ProtectedRoute>. */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-bebas text-lg text-cream tracking-wider">YOUR LOCKER</h3>
            <p className="text-cream/55 text-xs mt-0.5">Equip and swap your owned looks. Changes show on your profile instantly.</p>
          </div>
          <a href="/shop" className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-electric/15 text-electric border border-electric/30 hover:bg-electric/25 transition-all duration-200">
            <Storefront size={14} weight="regular" aria-hidden="true" /> Shop
          </a>
        </div>
        <CosmeticLocker username={user.username} />
      </div>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-1">THEME</h3>
        <p className="text-cream/55 text-xs mb-4">Switch the whole app between dark and light. Applies instantly.</p>
        <div className="flex gap-3" role="radiogroup" aria-label="Theme">
          {([
            { id: "dark" as const, label: "Dark", Icon: Moon, swatch: "linear-gradient(135deg, #0D1528, #04080F)" },
            { id: "light" as const, label: "Light", Icon: Sun, swatch: "linear-gradient(135deg, #FFFFFF, #F1ECDF)" },
          ]).map(t => {
            const active = theme === t.id;
            return (
              <button key={t.id} type="button" role="radio" aria-checked={active}
                onClick={() => autoSave({ theme: t.id })}
                className={`flex-1 flex items-center gap-3 text-left p-3.5 rounded-xl border font-bold transition-all
                  ${active ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/65 hover:border-white/20"}`}>
                <span aria-hidden="true" className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center border border-white/15" style={{ background: t.swatch }}>
                  <t.Icon size={18} weight={active ? "fill" : "regular"} className={t.id === "light" ? "text-navy/70" : "text-cream"} />
                </span>
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">FONT SIZE</h3>
        <div className="flex gap-3">
          {([
            { id: "small" as const, label: "Small", size: "text-sm" },
            { id: "medium" as const, label: "Medium", size: "text-base" },
            { id: "large" as const, label: "Large", size: "text-lg" },
          ]).map(f => (
            <button key={f.id} onClick={() => autoSave({ font_size: f.id })}
              className={`flex-1 py-3 rounded-xl border font-bold transition-all
                ${fontSize === f.id ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/65 hover:border-white/20"}`}>
              <span className={f.size}>A</span>
              <span className="block text-xs mt-0.5 font-normal normal-case">{f.label}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">PREFERRED SUBJECTS</h3>
        <p className="text-cream/55 text-xs mb-3">These appear first in quiz selection</p>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => toggleSubject(s)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all
                ${prefSubjects.includes(s) ? "bg-electric/20 text-electric border border-electric/40" : "bg-white/5 text-cream/65 border border-white/10 hover:border-white/20"}`}>
              {prefSubjects.includes(s) ? "\u2713 " : ""}{s}
            </button>
          ))}
        </div>
      </Card>

      {saved && <SaveToast msg="Saved!" />}
    </div>
  );
}

// ── PRIVACY ────────────────────────────────────────────
// P0 trust-gap fix 2026-06-05: prefs are now server-backed.
// - profile_visibility (public/private) writes to the dedicated column
//   via PATCH /api/user/profile-visibility (enforced by social/search +
//   the leaderboard ladders).
// - The four sub-flags (show_on_leaderboard, show_streak, show_coins,
//   duel_from) live in profiles.preferences.privacy and write through
//   PATCH /api/user/preferences.
// localStorage cache is kept ONLY as an optimistic-render hint so the
// page doesn't flash defaults before the GET lands; the server is the
// source of truth.
const PRIVACY_CACHE_KEY = "privacySettings.v2";

function PrivacySection({ user, quizHistory, activity }: SharedProps) {
  const [visibility,    setVisibility]    = useState<"public"|"private">("public");
  const [onLeaderboard, setOnLeaderboard] = useState(true);
  const [showStreak,    setShowStreak]    = useState(true);
  const [showCoins,     setShowCoins]     = useState(true);
  const [duelFrom,      setDuelFrom]      = useState<"everyone"|"nobody">("everyone");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Optimistic cache pre-paint, then authoritative GET from the server.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(PRIVACY_CACHE_KEY) : null;
      if (raw) {
        const c = JSON.parse(raw);
        if (c.visibility === "public" || c.visibility === "private") setVisibility(c.visibility);
        if (typeof c.onLeaderboard === "boolean") setOnLeaderboard(c.onLeaderboard);
        if (typeof c.showStreak    === "boolean") setShowStreak(c.showStreak);
        if (typeof c.showCoins     === "boolean") setShowCoins(c.showCoins);
        if (c.duelFrom === "everyone" || c.duelFrom === "nobody") setDuelFrom(c.duelFrom);
      }
    } catch { /* ignore corrupt cache */ }

    let cancelled = false;
    apiGet<{
      profile_visibility: "public" | "private";
      privacy: { show_on_leaderboard: boolean; show_streak: boolean; show_coins: boolean; duel_from: "everyone"|"nobody" };
    }>("/api/user/preferences").then(res => {
      if (cancelled || !res.ok || !res.data) return;
      const { profile_visibility, privacy } = res.data;
      setVisibility(profile_visibility === "private" ? "private" : "public");
      setOnLeaderboard(privacy.show_on_leaderboard);
      setShowStreak(privacy.show_streak);
      setShowCoins(privacy.show_coins);
      setDuelFrom(privacy.duel_from);
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      // Fire both updates in parallel — visibility is a column, the
      // sub-flags are JSONB. Both endpoints are idempotent.
      const [vRes, pRes] = await Promise.all([
        apiPatch<{ profile_visibility: string }>("/api/user/profile-visibility", { visibility }),
        apiPatch<{ privacy: unknown }>("/api/user/preferences", {
          privacy: {
            show_on_leaderboard: onLeaderboard,
            show_streak:         showStreak,
            show_coins:          showCoins,
            duel_from:           duelFrom,
          },
        }),
      ]);
      if (!vRes.ok || !pRes.ok) {
        console.error("[profile:privacy] failed", { vRes: vRes.error, pRes: pRes.error });
        toastError("Couldn't save your privacy settings. Try again.");
        return;
      }
      try {
        localStorage.setItem(PRIVACY_CACHE_KEY, JSON.stringify({
          visibility, onLeaderboard, showStreak, showCoins, duelFrom,
        }));
      } catch { /* ignore quota errors */ }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const downloadData = () => {
    const data = {
      profile: { id: user.id, username: user.username, email: user.email, level: user.level, coins: user.coins, streak: user.streak, xp: user.xp },
      quizHistory,
      activityLog: activity,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `lionade-data-${user.username}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="PRIVACY" sub="Control what others can see about you" />

      <Card className="space-y-5">
        <div>
          <label className={labelCls}>Profile Visibility</label>
          <div className="flex gap-2">
            {(["public","private"] as const).map(v => (
              <button key={v} onClick={() => setVisibility(v)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-bold capitalize transition-all
                  ${visibility === v ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/65 hover:border-white/20"}`}>
                <span className="inline-flex items-center gap-1.5">{v === "public" ? <Globe size={14} weight="regular" aria-hidden="true" /> : <Lock size={14} weight="regular" aria-hidden="true" />} {v}</span>
              </button>
            ))}
          </div>
          <p className="text-cream/55 text-xs mt-2">
            {visibility === "private"
              ? "Private profiles are hidden from search and leaderboards."
              : "Public profiles are discoverable in search and on the leaderboard."}
          </p>
        </div>

        {[
          { label: "Show on Leaderboard",   sub: "Appear in public rankings",                 val: onLeaderboard,  set: setOnLeaderboard },
          { label: "Show Streak Publicly",  sub: "Others can see your streak count",          val: showStreak,     set: setShowStreak },
          { label: "Show Fangs Balance",    sub: "Others can see your total Fangs",           val: showCoins,      set: setShowCoins },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between py-2 border-b border-electric/10 last:border-0">
            <div>
              <p className="text-cream text-sm font-semibold">{item.label}</p>
              <p className="text-cream/55 text-xs">{item.sub}</p>
            </div>
            <Toggle checked={item.val} onChange={item.set} label={item.label} />
          </div>
        ))}

        <div>
          <label className={labelCls}>Allow Duel Challenges From</label>
          <div className="flex gap-2">
            {(["everyone","nobody"] as const).map(v => (
              <button key={v} onClick={() => setDuelFrom(v)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-bold capitalize transition-all
                  ${duelFrom === v ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/65 hover:border-white/20"}`}>
                <span className="inline-flex items-center gap-1.5">{v === "everyone" ? <><Sword size={14} weight="fill" aria-hidden="true" /> Everyone</> : <><Prohibit size={14} weight="regular" aria-hidden="true" /> Nobody</>}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>

      {saved && <SaveToast msg="Privacy settings saved!" />}
      <button onClick={save} disabled={saving || !hydrated}
        className="w-full py-3.5 rounded-xl font-bold text-sm disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
        <span className="inline-flex items-center gap-2">
          <FloppyDisk size={16} weight="regular" aria-hidden="true" />
          {saving ? "Saving..." : "Save Privacy Settings"}
        </span>
      </button>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-2">YOUR DATA</h3>
        <p className="text-cream/55 text-sm mb-4">Download a copy of everything Lionade has stored about you</p>
        <button onClick={downloadData}
          className="px-6 py-2.5 rounded-xl border border-electric/40 text-electric text-sm font-bold hover:bg-electric/10 transition-all">
          <span className="inline-flex items-center gap-2">Download My Data (JSON)</span>
        </button>
      </Card>
    </div>
  );
}

// ── SECURITY ───────────────────────────────────────────
function SecuritySection({ user }: SharedProps) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{msg: string; err: boolean}|null>(null);
  // P0 trust-gap fix 2026-06-05: Delete Account modal state.
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const pwChecks = {
    length:  newPw.length >= 8,
    upper:   /[A-Z]/.test(newPw),
    lower:   /[a-z]/.test(newPw),
    number:  /[0-9]/.test(newPw),
    special: /[!@#$%^&*]/.test(newPw),
  };
  const pwStrong = Object.values(pwChecks).every(Boolean);
  const pwMatch = newPw === confirmPw && confirmPw.length > 0;

  const handleChangePassword = async () => {
    if (!currentPw) { setToast({ msg: "Enter your current password", err: true }); return; }
    if (!pwStrong)  { setToast({ msg: "New password doesn't meet requirements", err: true }); return; }
    if (!pwMatch)   { setToast({ msg: "New passwords don't match", err: true }); return; }

    setSaving(true);
    // Re-authenticate first
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPw });
    if (authErr) {
      setToast({ msg: "Current password is incorrect", err: true });
      setSaving(false); return;
    }
    // Update password
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
    if (updateErr) {
      setToast({ msg: updateErr.message, err: true });
    } else {
      setToast({ msg: "Password changed successfully!", err: false });
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    }
    setSaving(false);
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="SECURITY" sub="Manage your account security" />

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-5">CHANGE PASSWORD</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="profile-current-pw" className={labelCls}>Current Password</label>
            <input id="profile-current-pw" type="password" autoComplete="current-password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              placeholder="••••••••" className={inputCls} />
          </div>
          <div>
            <label htmlFor="profile-new-pw" className={labelCls}>New Password</label>
            <input id="profile-new-pw" type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)}
              placeholder="Min. 8 characters" className={inputCls} />
            {newPw.length > 0 && (
              <div className="mt-2 space-y-1 px-1">
                {[
                  { ok: pwChecks.length,  label: "At least 8 characters" },
                  { ok: pwChecks.upper,   label: "One uppercase letter" },
                  { ok: pwChecks.lower,   label: "One lowercase letter" },
                  { ok: pwChecks.number,  label: "One number" },
                  { ok: pwChecks.special, label: "One special character (!@#$%^&*)" },
                ].map(c => (
                  <div key={c.label} className={`flex items-center gap-2 text-xs ${c.ok ? "text-green-300" : "text-red-300"}`}>
                    {c.ok ? <Check size={14} weight="bold" aria-hidden="true" /> : <XIcon size={14} weight="bold" aria-hidden="true" />}<span>{c.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="profile-confirm-pw" className={labelCls}>Confirm New Password</label>
            <input id="profile-confirm-pw" type="password" autoComplete="new-password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              placeholder="Re-enter new password" className={inputCls} />
            {confirmPw.length > 0 && (
              <p role="status" aria-live="polite" className={`text-xs font-semibold mt-1 ${pwMatch ? "text-green-300" : "text-red-300"}`}>
                <span className="inline-flex items-center gap-1">{pwMatch ? <><Check size={12} weight="bold" aria-hidden="true" /> Passwords match</> : "Passwords do not match"}</span>
              </p>
            )}
          </div>

          {toast && <SaveToast msg={toast.msg} isError={toast.err} />}
          <button onClick={handleChangePassword} disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-sm bg-electric text-white disabled:opacity-60 transition-all">
            {saving ? "Updating..." : <span className="inline-flex items-center gap-2"><Key size={16} weight="regular" aria-hidden="true" /> Change Password</span>}
          </button>
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-2">ACTIVE SESSIONS</h3>
        <p className="text-cream/55 text-sm mb-4">Devices currently signed into your account</p>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-electric/5 border border-electric/20">
          <Laptop size={28} weight="regular" color="currentColor" aria-hidden="true" />
          <div>
            <p className="text-cream text-sm font-semibold">Current Session</p>
            <p className="text-cream/55 text-xs">This device · Active now</p>
          </div>
          <span className="ml-auto text-green-300 text-xs font-bold">● Active</span>
        </div>
        <p className="text-cream/55 text-xs mt-3">Full session management requires Supabase Auth admin access</p>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-red-400 tracking-wider mb-2">DANGER ZONE</h3>
        <p className="text-cream/55 text-sm mb-4">These actions are permanent and cannot be undone</p>
        <button onClick={() => setShowDeleteModal(true)}
          className="px-6 py-2.5 rounded-xl border border-red-400/30 text-red-300 text-sm font-bold hover:bg-red-400/10 transition-all">
          <span className="inline-flex items-center gap-2"><Trash size={16} weight="regular" aria-hidden="true" /> Delete Account</span>
        </button>
      </Card>

      {showDeleteModal && (
        <DeleteAccountModal
          email={user.email ?? ""}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}

// ── Delete-account confirmation modal ────────────────
// P0 trust-gap fix 2026-06-05: the Delete Account button used to render
// with no onClick. Now it opens this modal; the user must type their
// account email to confirm, then DELETE /api/user/account fires.
function DeleteAccountModal({ email, onClose }: { email: string; onClose: () => void }) {
  const { logout } = useAuth();
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const emailLc = email.trim().toLowerCase();
  const matches = confirmText.trim().toLowerCase() === emailLc && emailLc.length > 0;

  // Escape closes + Tab focus trap + restore focus to the trigger on close.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) { onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(el => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); restoreTo?.focus?.(); };
  }, [deleting, onClose]);

  const handleDelete = async () => {
    if (!matches) return;
    setDeleting(true);
    try {
      const res = await apiDelete<{ ok: boolean }>(
        `/api/user/account?confirm=${encodeURIComponent(emailLc)}`,
      );
      if (!res.ok) {
        console.error("[profile:delete-account] failed", res.error);
        toastError("Couldn't delete your account. Try again or contact support.");
        setDeleting(false);
        return;
      }
      toastSuccess("Your account has been deleted.");
      // Sign out + bounce to landing. The server has already wiped the
      // auth row, so the client session below is just for clean state.
      try { await logout(); } catch { /* ignore — auth row is gone */ }
      router.push("/");
    } catch (e: any) {
      console.error("[profile:delete-account] threw", e);
      toastError("Couldn't delete your account. Try again or contact support.");
      setDeleting(false);
    }
  };

  return (
    <div
      onClick={() => !deleting && onClose()}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm motion-safe:animate-fade-in"
      role="dialog" aria-modal="true" aria-labelledby="delete-account-title"
    >
      <div ref={panelRef} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-red-400/30 p-6 motion-safe:animate-slide-up"
        style={{ background: "linear-gradient(135deg, rgba(20,8,14,0.98), rgba(8,4,8,0.98))" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-red-400/15 border border-red-400/30 flex items-center justify-center">
            <Warning size={20} weight="fill" color="#F87171" aria-hidden="true" />
          </div>
          <h3 id="delete-account-title" className="font-bebas text-2xl text-red-400 tracking-wider">DELETE ACCOUNT</h3>
        </div>
        <p className="text-cream/80 text-sm mb-2">This permanently removes your account, profile, friends, quiz history, and any Fangs you have on hand.</p>
        <p className="text-cream/60 text-xs mb-5">This cannot be undone. If you want to come back later you will need to sign up again.</p>

        <label htmlFor="delete-confirm-email" className="block text-cream/60 text-xs font-bold uppercase tracking-widest mb-1.5">
          Type your email to confirm
        </label>
        <p className="font-mono text-cream/60 text-xs mb-2">{email}</p>
        <input
          id="delete-confirm-email"
          type="email"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="your-email@example.com"
          disabled={deleting}
          autoComplete="off"
          autoFocus
          className="w-full bg-white/5 border border-red-400/30 rounded-xl px-4 py-3 text-cream placeholder-cream/25 text-sm focus:outline-none focus:border-red-400 transition-all mb-4"
        />

        <div className="flex gap-2">
          <button onClick={onClose} disabled={deleting}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60 transition-all">
            Cancel
          </button>
          <button onClick={handleDelete} disabled={!matches || deleting}
            className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: matches && !deleting ? "linear-gradient(135deg, #DC2626 0%, #991B1B 100%)" : "rgba(220,38,38,0.2)",
              color: matches && !deleting ? "#fff" : "#fca5a5",
              boxShadow: matches && !deleting ? "0 4px 15px rgba(220,38,38,0.3)" : "none",
            }}>
            <span className="inline-flex items-center gap-2">
              {deleting ? "Deleting..." : <><Trash size={16} weight="fill" aria-hidden="true" /> Delete Forever</>}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ACTIVITY HISTORY ───────────────────────────────────
function ActivitySection({ activity, quizHistory, loading }: SharedProps) {
  const [view, setView] = useState<"transactions"|"quizzes">("transactions");

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="ACTIVITY HISTORY" sub="Your last 30 actions" />

      <div role="tablist" aria-label="Activity view" className="flex gap-1 bg-white/5 p-1 rounded-xl border border-electric/10">
        <button role="tab" aria-selected={view === "transactions"} onClick={() => setView("transactions")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors
            ${view === "transactions" ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/60 hover:text-cream"}`}>
          <span className="inline-flex items-center gap-2"><Coins size={16} weight="fill" color="#FFD700" aria-hidden="true" /> Fang Transactions</span>
        </button>
        <button role="tab" aria-selected={view === "quizzes"} onClick={() => setView("quizzes")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors
            ${view === "quizzes" ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/60 hover:text-cream"}`}>
          <span className="inline-flex items-center gap-2"><NotePencil size={16} weight="regular" aria-hidden="true" /> Quiz History</span>
        </button>
      </div>

      {view === "transactions" && (
        <div className="space-y-2">
          {loading ? (
            <div aria-hidden="true" className="space-y-2">
              <div className="h-16 rounded-xl bg-white/10 animate-pulse" />
              <div className="h-16 rounded-xl bg-white/10 animate-pulse" />
            </div>
          ) : activity.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-cream/60 mb-4">No activity yet. Start grinding.</p>
              <Link href="/quiz" className="inline-block px-6 py-2.5 rounded-xl bg-electric text-white text-sm font-bold">
                Take a quiz
              </Link>
            </Card>
          ) : activity.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-electric/10 hover:border-electric/30 transition-all"
              style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-electric/10 text-electric">
                {a.type === "duel_win"
                  ? <Sword size={20} weight="fill" color="currentColor" aria-hidden="true" />
                  : a.type === "badge_bonus"
                  ? <MedalMilitary size={20} weight="fill" color="currentColor" aria-hidden="true" />
                  : <NotePencil size={20} weight="regular" color="currentColor" aria-hidden="true" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-cream text-sm font-semibold truncate">{a.description}</p>
                <p className="text-cream/55 text-xs">{new Date(a.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <span className={`font-bebas text-lg flex-shrink-0 ${a.amount > 0 ? "text-gold" : "text-cream/55"}`}>
                {a.amount > 0 ? `+${a.amount}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {view === "quizzes" && (
        <div className="space-y-2">
          {loading ? (
            <div aria-hidden="true" className="space-y-2">
              <div className="h-16 rounded-xl bg-white/10 animate-pulse" />
              <div className="h-16 rounded-xl bg-white/10 animate-pulse" />
            </div>
          ) : quizHistory.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-cream/60">No quizzes yet. Take your first quiz!</p>
              <Link href="/quiz" className="inline-block mt-4 px-6 py-2.5 rounded-xl bg-electric text-white text-sm font-bold">Start a Quiz</Link>
            </Card>
          ) : quizHistory.map((h: any) => {
            const acc = h.total_questions > 0 ? Math.round((h.correct_answers / h.total_questions) * 100) : 0;
            return (
              <div key={h.id} className="flex items-center gap-3 p-4 rounded-xl border border-electric/10 hover:border-electric/30 transition-all"
                style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 border
                  ${acc === 100 ? "bg-gold/20 border-gold/50" : acc >= 70 ? "bg-green-400/20 border-green-400/50" : "bg-red-400/20 border-red-400/50"}`}>
                  {acc === 100
                    ? <Diamond size={16} weight="fill" color="#FFD700" aria-hidden="true" />
                    : acc >= 70
                    ? <CheckCircle size={16} weight="fill" color="#22C55E" aria-hidden="true" />
                    : <XCircle size={16} weight="fill" color="#EF4444" aria-hidden="true" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-cream text-sm font-semibold">{h.subject}</p>
                  <p className="text-cream/55 text-xs">{new Date(h.completed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-cream text-sm font-bold">{h.correct_answers}/{h.total_questions}</p>
                  <p className="text-cream/55 text-xs">{acc}%</p>
                </div>
                <span className={`font-bebas text-lg flex-shrink-0 ${h.coins_earned > 0 ? "text-gold" : "text-cream/55"}`}>
                  {h.coins_earned > 0 ? `+${h.coins_earned}` : "+0"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── NOTIFICATIONS ──────────────────────────────────────
// P0 trust-gap fix 2026-06-05: persists to profiles.preferences.notifications
// via PATCH /api/user/preferences. Previously localStorage-only.
const NOTIF_CACHE_KEY = "notifPrefs.v2";
type NotifPrefsLocal = {
  dailyReminder:  boolean;
  duelChallenges: boolean;
  weeklyReport:   boolean;
  badgeUnlocked:  boolean;
  streakAlert:    boolean;
  newFeatures:    boolean;
  marketing:      boolean;
};
const NOTIF_DEFAULTS: NotifPrefsLocal = {
  dailyReminder:  true,
  duelChallenges: true,
  weeklyReport:   true,
  badgeUnlocked:  true,
  streakAlert:    true,
  newFeatures:    false,
  marketing:      false,
};

function NotificationsSection() {
  const [prefs, setPrefs] = useState<NotifPrefsLocal>(NOTIF_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(NOTIF_CACHE_KEY) : null;
      if (raw) setPrefs({ ...NOTIF_DEFAULTS, ...JSON.parse(raw) });
    } catch { /* ignore */ }
    let cancelled = false;
    apiGet<{ notifications: {
      daily_reminder: boolean; duel_challenges: boolean; weekly_report: boolean;
      badge_unlocked: boolean; streak_alert: boolean; new_features: boolean;
      marketing: boolean; leaderboard_updates: boolean;
    } }>("/api/user/preferences").then(res => {
      if (cancelled || !res.ok || !res.data) return;
      const n = res.data.notifications;
      setPrefs({
        dailyReminder:  n.daily_reminder,
        duelChallenges: n.duel_challenges,
        weeklyReport:   n.weekly_report,
        badgeUnlocked:  n.badge_unlocked,
        streakAlert:    n.streak_alert,
        newFeatures:    n.new_features,
        marketing:      n.marketing,
      });
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  const toggle = (key: keyof NotifPrefsLocal) =>
    setPrefs(p => ({ ...p, [key]: !p[key] }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiPatch<{ notifications: unknown }>("/api/user/preferences", {
        notifications: {
          daily_reminder:  prefs.dailyReminder,
          duel_challenges: prefs.duelChallenges,
          weekly_report:   prefs.weeklyReport,
          badge_unlocked:  prefs.badgeUnlocked,
          streak_alert:    prefs.streakAlert,
          new_features:    prefs.newFeatures,
          marketing:       prefs.marketing,
        },
      });
      if (!res.ok) {
        console.error("[profile:notifications] failed", res.error);
        toastError("Couldn't save your notification settings. Try again.");
        return;
      }
      try { localStorage.setItem(NOTIF_CACHE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const items = [
    { key: "dailyReminder",  label: "Daily Study Reminder",    sub: "Get notified to keep your streak alive" },
    { key: "duelChallenges", label: "Duel Challenges",         sub: "When someone challenges you to a duel" },
    { key: "weeklyReport",   label: "Weekly Progress Report",  sub: "Your week in review every Sunday" },
    { key: "badgeUnlocked",  label: "Badge Unlocked",          sub: "When you earn a new badge" },
    { key: "streakAlert",    label: "Streak at Risk",          sub: "Reminder when your streak is about to break" },
    { key: "newFeatures",    label: "New Features",            sub: "When we launch new features or updates" },
    { key: "marketing",      label: "Promotions and Offers",   sub: "Special offers and partner promotions" },
  ] as const;

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="NOTIFICATIONS" sub="Choose what you want to hear about" />
      <Card className="space-y-1">
        {items.map((item, i) => (
          <div key={item.key} className={`flex items-center justify-between py-4 ${i < items.length - 1 ? "border-b border-electric/10" : ""}`}>
            <div>
              <p className="text-cream text-sm font-semibold">{item.label}</p>
              <p className="text-cream/55 text-xs mt-0.5">{item.sub}</p>
            </div>
            <Toggle checked={prefs[item.key]} onChange={() => toggle(item.key)} label={item.label} />
          </div>
        ))}
      </Card>

      {saved && <SaveToast msg="Notification preferences saved!" />}
      <button onClick={save} disabled={saving || !hydrated}
        className="w-full py-3.5 rounded-xl font-bold text-sm disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
        <span className="inline-flex items-center gap-2">
          <FloppyDisk size={16} weight="regular" aria-hidden="true" />
          {saving ? "Saving..." : "Save Notification Settings"}
        </span>
      </button>
    </div>
  );
}

// ── ABOUT LIONADE ─────────────────────────────────────────
function AboutLionadeSection() {
  const sections: { title: string; Icon: Icon; body: string }[] = [
    { title: "OUR MISSION", Icon: Target, body: "Lionade was built to give back to students. Oftentimes students work hard and burn out with little recognition. Lionade was built by students for other students. We allow all learners, novice or advanced, to be seen, valued, and acknowledged. We reward growth and achievement in a tangible way, empowering students with not just recognition but true support." },
    { title: "ABOUT US", Icon: Handshake, body: "Created by a team of ambitious students looking for a way to revolutionize studying. Lionade is the platform we wish existed before us. We look to give back to a community that already gives so much, and further self improvement around the world." },
    { title: "OUR VISION", Icon: Rocket, body: "Lionade aims to completely redefine the way studying is done, rewarding discipline and focus in a measurable way with active compensation for investing your time in self improvement, giving top performers real-world success." },
  ];
  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="ABOUT LIONADE" sub="Our mission, story, and vision" />
      {sections.map((s) => (
        <Card key={s.title}>
          <div className="flex items-center gap-3 mb-3">
            <s.Icon size={28} weight="regular" color="#4A90D9" aria-hidden="true" />
            <h3 className="font-bebas text-xl tracking-wider text-electric">{s.title}</h3>
          </div>
          <p className="text-cream/70 text-sm leading-relaxed">{s.body}</p>
        </Card>
      ))}
    </div>
  );
}

// ── Toggle component ───────────────────────────────────
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center justify-center w-12 h-11 flex-shrink-0 rounded-lg">
      <span aria-hidden="true"
        className={`relative block w-12 h-6 rounded-full motion-safe:transition-colors motion-safe:duration-300
          ${checked ? "bg-electric" : "bg-white/25"}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow motion-safe:transition-all motion-safe:duration-300
          ${checked ? "left-6" : "left-0.5"}`} />
      </span>
    </button>
  );
}
