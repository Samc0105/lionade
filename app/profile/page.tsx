"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import {
  getAllBadges, getUserBadges, getSubjectStats,
  getQuizHistory, getRecentActivity,
  getPreferences, updatePreferences,
} from "@/lib/db";
import type { UserPreferences } from "@/lib/db";
import { getLevelProgress, formatCoins, SUBJECT_ICONS } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import BadgeCard from "@/components/BadgeCard";
import Link from "next/link";

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

const NAV: { key: Section; label: string; icon: string }[] = [
  { key: "overview",        label: "Overview",          icon: "📊" },
  { key: "edit-profile",    label: "Edit Profile",      icon: "✏️" },
  { key: "avatar",          label: "Avatar & Appearance", icon: "🎨" },
  { key: "personalization", label: "Personalization",   icon: "⚙️" },
  { key: "privacy",         label: "Privacy",           icon: "🔒" },
  { key: "security",        label: "Security",          icon: "🛡️" },
  { key: "activity",        label: "Activity History",  icon: "📅" },
  { key: "notifications",   label: "Notifications",     icon: "🔔" },
  { key: "about",           label: "About Lionade",     icon: "🦁" },
];

// ── Main Page ──────────────────────────────────────────
export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { stats } = useUserStats(user?.id);
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
      getSubjectStats(user.id).catch(() => []),
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
  const avatarUrl = stats?.avatar ?? user.avatar;
  const statsReady = !!stats || user.statsLoaded;
  const { level, progress, xpToNext } = getLevelProgress(xp);
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
                <img src={avatarUrl} alt={user.username} className="w-full h-full object-cover" />
              </div>
              <span className="font-bebas text-xl text-cream tracking-wider">
                {NAV.find(n => n.key === section)?.label}
              </span>
            </div>
            <button onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg border border-electric/20 text-cream/60">
              ☰
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
                      <img src={avatarUrl} alt={user.username} className="w-full h-full object-cover" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-navy
                      flex items-center justify-center font-bebas text-xs text-white"
                      style={{ background: "#4A90D9" }}>{level}</div>
                  </div>
                  <p className="font-bebas text-xl text-cream tracking-wider">@{user.username}</p>
                  <p className="text-cream/40 text-xs mt-0.5">Level {level} · {formatCoins(coins)} coins</p>
                  <div className="mt-3 w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: statsReady ? `${progress}%` : "0%", background: "linear-gradient(90deg, #2D6BB5, #4A90D9)" }} />
                  </div>
                  <p className="text-cream/30 text-xs mt-1">{statsReady ? `${xpToNext} XP to Level ${level + 1}` : ""}</p>
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
                          : "text-cream/50 hover:text-cream hover:bg-white/5"}`}>
                      <span className="text-base w-5">{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                </nav>
              </div>
            </aside>

            {/* ── Main content ── */}
            <main className="flex-1 min-w-0">
              {section === "overview"        && <OverviewSection {...sharedProps} />}
              {section === "edit-profile"    && <EditProfileSection {...sharedProps} />}
              {section === "avatar"          && <AvatarSection {...sharedProps} />}
              {section === "personalization" && <PersonalizationSection {...sharedProps} />}
              {section === "privacy"         && <PrivacySection {...sharedProps} />}
              {section === "security"        && <SecuritySection {...sharedProps} />}
              {section === "activity"        && <ActivitySection {...sharedProps} />}
              {section === "notifications"   && <NotificationsSection />}
              {section === "about"           && <AboutLionadeSection />}
            </main>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}

// ── Shared prop type ──────────────────────────────────
type SharedProps = {
  user: any; level: number; progress: number; xpToNext: number;
  coins: number; streak: number; xp: number; avatarUrl: string; statsReady: boolean;
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
      {sub && <p className="text-cream/40 text-sm mt-1">{sub}</p>}
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
    <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold
      ${isError ? "bg-red-400/10 border border-red-400/30 text-red-400" : "bg-green-400/10 border border-green-400/30 text-green-400"}`}>
      {isError ? "⚠️" : "✓"} {msg}
    </div>
  );
}

const inputCls = "w-full bg-white/5 border border-electric/20 rounded-xl px-4 py-3 text-cream placeholder-cream/25 text-sm focus:outline-none focus:border-electric transition-all";
const labelCls = "block text-cream/50 text-xs font-bold uppercase tracking-widest mb-1.5";

// ── OVERVIEW ───────────────────────────────────────────
function OverviewSection({ user, level, progress, xpToNext, coins, streak, xp, avatarUrl, statsReady, earnedBadges, allBadges, subjectStats, quizHistory, activity, loading, accuracy, totalQuestions, totalCorrect, duelsWon, refreshUser }: SharedProps) {
  const lockedBadges = allBadges.filter(b => !earnedBadges.some((e: any) => e.id === b.id));

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Hero card */}
      <Card className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl opacity-15 pointer-events-none"
          style={{ background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)" }} />
        <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="w-24 h-24 rounded-full overflow-hidden border-4 flex-shrink-0"
            style={{ borderColor: "#4A90D9", boxShadow: "0 0 25px #4A90D960" }}>
            <img src={avatarUrl} alt={user.username} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="font-bebas text-4xl text-cream tracking-wider">{user.username}</h1>
            <p className="text-cream/40 text-sm mb-3">{user.displayName} · Level {level}</p>
            <div className="mb-4">
              <div className="flex justify-between text-xs text-cream/40 mb-1">
                <span>Level {level}</span>
                <span>{statsReady ? `${xpToNext} XP to Level ${level + 1}` : ""}</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: statsReady ? `${progress}%` : "0%", background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 10px #4A90D960" }} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { icon: "fang", label: "Total Coins",        value: statsReady ? formatCoins(coins) : null,          color: "text-gold" },
          { icon: "🔥", label: "Day Streak",         value: statsReady ? `${streak}` : null,                 color: "text-orange-400" },
          { icon: "⚡", label: "Total XP",           value: statsReady ? xp.toLocaleString() : null,         color: "text-electric" },
          { icon: "📝", label: "Quizzes Completed",  value: !loading ? quizHistory.length.toString() : null, color: "text-cream" },
          { icon: "⚔️", label: "Duels Won",          value: !loading ? duelsWon.toString() : null,           color: "text-purple-400" },
          { icon: "📚", label: "Subjects Mastered",  value: !loading ? subjectStats.length.toString() : null, color: "text-green-400" },
        ].map((s) => (
          <Card key={s.label} className="text-center !p-4">
            {s.icon === "fang" ? <img src="/fangs.png" alt="Fangs" className="w-7 h-7 object-contain mx-auto mb-1" /> : <span className="text-2xl block mb-1">{s.icon}</span>}
            {s.value !== null
              ? <p className={`font-bebas text-2xl leading-none ${s.color}`}>{s.value}</p>
              : <div className="w-12 h-7 bg-white/10 rounded-lg animate-pulse mx-auto" />}
            <p className="text-cream/40 text-xs mt-1">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent badges */}
        <Card>
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bebas text-xl text-cream tracking-wider">RECENT BADGES</h3>
            <span className="text-electric text-xs font-semibold">{earnedBadges.length} earned</span>
          </div>
          {earnedBadges.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-3xl mb-2">🔒</p>
              <p className="text-cream/40 text-sm">Complete quizzes to earn badges</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {earnedBadges.slice(0, 6).map((b: any) => (
                <BadgeCard key={b.id} badge={{ ...b, description: b.description ?? "", rarity: b.rarity as any, earnedAt: b.earnedAt }} size="sm" earned />
              ))}
            </div>
          )}
        </Card>

        {/* Recent activity */}
        <Card>
          <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">RECENT ACTIVITY</h3>
          {activity.length === 0 ? (
            <p className="text-cream/40 text-sm text-center py-4">No activity yet</p>
          ) : (
            <div className="space-y-2">
              {activity.slice(0, 8).map((a: any, i: number) => (
                <div key={i} className="flex justify-between items-center py-1.5 border-b border-electric/10 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{a.type === "duel_win" ? "⚔️" : a.type === "badge_bonus" ? "🎖️" : "📝"}</span>
                    <span className="text-cream/70 text-xs truncate max-w-[160px]">{a.description}</span>
                  </div>
                  <span className={`font-bebas text-sm ${a.amount > 0 ? "text-gold" : "text-cream/30"}`}>
                    {a.amount > 0 ? `+${a.amount}` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Badges full section */}
      <Card>
        <h3 className="font-bebas text-xl text-cream tracking-wider mb-4">ALL BADGES</h3>
        {earnedBadges.length > 0 && (
          <>
            <p className="text-green-400 text-xs font-bold uppercase tracking-widest mb-3">Earned · {earnedBadges.length}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              {earnedBadges.map((b: any) => (
                <BadgeCard key={b.id} badge={{ ...b, description: b.description ?? "", rarity: b.rarity as any, earnedAt: b.earnedAt }} size="sm" earned />
              ))}
            </div>
          </>
        )}
        {lockedBadges.length > 0 && (
          <>
            <p className="text-cream/30 text-xs font-bold uppercase tracking-widest mb-3">Locked · {lockedBadges.length}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {lockedBadges.map((b: any) => (
                <BadgeCard key={b.id} badge={{ ...b, description: b.description ?? "", rarity: b.rarity as any }} size="sm" earned={false} />
              ))}
            </div>
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
      .then(({ data }) => {
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
      .then(({ data }) => {
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
      const res = await fetch("/api/change-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, newUsername: username.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ msg: data.error ?? "Failed to change username", err: true });
        setSaving(false);
        return;
      }
    }

    // Save other profile fields (excluding username — handled above)
    const updates: Record<string, string> = {
      display_name: firstName.trim(),
      bio: bio.trim(),
      education_level: education,
      study_goal: studyGoal,
    };
    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
    if (error) {
      setToast({ msg: error.message, err: true });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-2xl border border-electric/20 p-6 max-w-md w-full mx-4"
            style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}>
            <h3 className="font-bebas text-2xl text-cream tracking-wider mb-2">CONFIRM USERNAME CHANGE</h3>
            <p className="text-cream/60 text-sm mb-4 leading-relaxed">
              You can only change your username <span className="text-gold font-semibold">once per year</span>. Are you sure you want to change from{" "}
              <span className="text-electric font-semibold">@{user.username}</span> to{" "}
              <span className="text-electric font-semibold">@{username.trim().toLowerCase()}</span>?
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 rounded-xl border border-electric/20 text-cream/60 text-sm font-bold hover:bg-white/5 transition-all">
                Cancel
              </button>
              <button onClick={handleSave}
                className="flex-1 py-3 rounded-xl font-bold text-sm text-navy transition-all"
                style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}

      <Card>
        <div className="space-y-5">
          <div>
            <label className={labelCls}>First Name / Display Name</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)}
              placeholder="Your name" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Username</label>
            <div className="relative">
              <input value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="your_handle"
                disabled={usernameLocked}
                className={inputCls + " pr-28" + (usernameLocked ? " opacity-50 cursor-not-allowed" : "")} />
              {!usernameLocked && usernameStatus === "checking" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-cream/40 text-xs">Checking...</span>}
              {!usernameLocked && usernameStatus === "available" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-semibold">✓ Available</span>}
              {!usernameLocked && usernameStatus === "taken"     && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-xs font-semibold">✗ Taken</span>}
            </div>
            {usernameLocked && usernameUnlockDate ? (
              <p className="text-amber-400/70 text-xs mt-1">You can change your username again on {usernameUnlockDate}</p>
            ) : (
              <p className="text-cream/25 text-xs mt-1">Usernames can only be changed once per year</p>
            )}
          </div>

          <div>
            <label className={labelCls}>Bio <span className={`normal-case font-normal ${bio.length >= 140 ? "text-red-400" : "text-cream/30"}`}>({bio.length}/150)</span></label>
            <textarea value={bio} onChange={e => setBio(e.target.value.slice(0, 150))}
              placeholder="Tell the world who you are..." rows={3}
              className={inputCls + " resize-none"} />
          </div>

          <div>
            <label className={labelCls}>Education Level</label>
            <select value={education} onChange={e => setEducation(e.target.value)}
              className="w-full bg-[#0a1020] border border-electric/20 rounded-xl px-4 py-3 text-cream text-sm focus:outline-none focus:border-electric transition-all appearance-none">
              <option value="">Select...</option>
              {EDUCATION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Primary Study Goal</label>
            <select value={studyGoal} onChange={e => setStudyGoal(e.target.value)}
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
            <p className="text-cream/40 text-sm mt-0.5 truncate">{currentStyleLabel} &middot; {selectedSeed}</p>
          ) : (
            <p className="text-cream/40 text-sm mt-0.5">Pick a new one below, then save</p>
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
      <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-electric/10 max-w-md mx-auto">
        {(["styles","create"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all text-center
              ${tab === t ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream"}`}>
            {t === "styles" ? "🎭 Styles" : "✨ Create"}
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
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all flex-shrink-0 whitespace-nowrap
                  ${selectedStyle === s.id
                    ? "bg-electric/20 text-electric border border-electric/40"
                    : "text-cream/40 hover:text-cream hover:bg-white/5 border border-transparent"}`}>
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
                  className={`aspect-square rounded-2xl overflow-hidden transition-all hover:scale-105 border-2
                    ${isActive ? "border-amber-400 shadow-lg shadow-amber-400/20 scale-105" : "border-white/10 hover:border-white/20"}`}
                  style={{ background: "rgba(10,16,32,0.6)" }}>
                  <img src={url} alt={seed} className="w-full h-full object-cover p-2" loading="lazy" />
                </button>
              );
            })}
          </div>

          {/* Randomize button */}
          <button onClick={randomizeSeeds}
            className="w-full py-3 rounded-xl border border-electric/20 text-cream/70 text-sm font-bold hover:bg-white/5 hover:text-cream transition-all flex items-center justify-center gap-2">
            <span className="text-lg">🎲</span> Randomize
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
            <p className="text-cream/50 text-xs font-bold uppercase tracking-widest mb-2">Skin Tone</p>
            <div className="flex gap-2">
              {ADVENTURER_SKIN_TONES.map(s => (
                <button key={s.value} onClick={() => setAvSkin(s.value)}
                  className={`w-10 h-10 rounded-full transition-all hover:scale-110 ${avSkin === s.value ? "ring-2 ring-electric ring-offset-2 ring-offset-[#060c18] scale-110" : ""}`}
                  style={{ background: `#${s.value}` }}
                  title={s.label} />
              ))}
            </div>
          </div>

          {/* Hair Style */}
          <div className="mb-5">
            <p className="text-cream/50 text-xs font-bold uppercase tracking-widest mb-2">Hair Style</p>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {ADVENTURER_HAIR_STYLES.map(h => {
                const hairPreviewUrl = `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(user.username)}&skinColor=${avSkin}&hair=${h}&hairColor=${avHairColor}&backgroundColor=${avBg}&size=64`;
                return (
                  <button key={h} onClick={() => setAvHair(h)}
                    className={`w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 transition-all hover:scale-105 border-2
                      ${avHair === h ? "border-electric shadow-lg shadow-electric/30" : "border-white/10 hover:border-white/20"}`}>
                    <img src={hairPreviewUrl} alt={h} className="w-full h-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hair Color */}
          <div className="mb-5">
            <p className="text-cream/50 text-xs font-bold uppercase tracking-widest mb-2">Hair Color</p>
            <div className="flex gap-2">
              {ADVENTURER_HAIR_COLORS.map(c => (
                <button key={c.value} onClick={() => setAvHairColor(c.value)}
                  className={`w-10 h-10 rounded-full transition-all hover:scale-110 ${avHairColor === c.value ? "ring-2 ring-electric ring-offset-2 ring-offset-[#060c18] scale-110" : ""}`}
                  style={{ background: `#${c.value}` }}
                  title={c.label} />
              ))}
            </div>
          </div>

          {/* Background Color */}
          <div>
            <p className="text-cream/50 text-xs font-bold uppercase tracking-widest mb-2">Background Color</p>
            <div className="flex gap-2">
              {ADVENTURER_BG_COLORS.map(c => (
                <button key={c.value} onClick={() => setAvBg(c.value)}
                  className={`w-10 h-10 rounded-full transition-all hover:scale-110 ${avBg === c.value ? "ring-2 ring-electric ring-offset-2 ring-offset-[#060c18] scale-110" : ""}`}
                  style={{ background: `#${c.value}`, border: c.value === "04080F" ? "2px solid rgba(74,144,217,0.3)" : "none" }}
                  title={c.label} />
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

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">THEMES UNLOCKED</h3>
        <div className="text-center py-6">
          <span className="text-4xl block mb-3">🎨</span>
          <p className="text-cream/50 text-sm mb-1">No themes unlocked yet</p>
          <p className="text-cream/30 text-xs mb-4">Visit the Shop to unlock new looks for your app</p>
          <a href="/shop" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold
            bg-electric/15 text-electric border border-electric/30 hover:bg-electric/25 transition-all duration-200">
            <span>🛍️</span> Browse Themes
          </a>
        </div>
        <div className="border-t border-white/5 pt-3 mt-2">
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-white/[0.03]">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid rgba(59,130,246,0.2)" }}>
              <span className="text-sm">🌌</span>
            </div>
            <div className="flex-1">
              <p className="text-cream text-sm font-semibold">Interstellar</p>
              <p className="text-cream/30 text-[11px]">Default theme</p>
            </div>
            <span className="text-electric text-xs font-bold">Active</span>
          </div>
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
                ${fontSize === f.id ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/50 hover:border-white/20"}`}>
              <span className={f.size}>A</span>
              <span className="block text-xs mt-0.5 font-normal normal-case">{f.label}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">PREFERRED SUBJECTS</h3>
        <p className="text-cream/40 text-xs mb-3">These appear first in quiz selection</p>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map(s => (
            <button key={s} onClick={() => toggleSubject(s)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all
                ${prefSubjects.includes(s) ? "bg-electric/20 text-electric border border-electric/40" : "bg-white/5 text-cream/50 border border-white/10 hover:border-white/20"}`}>
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
function PrivacySection({ user, quizHistory, activity }: SharedProps) {
  const [visibility,     setVisibility]     = useState("public");
  const [onLeaderboard,  setOnLeaderboard]  = useState(true);
  const [showStreak,     setShowStreak]     = useState(true);
  const [showCoins,      setShowCoins]      = useState(true);
  const [duelFrom,       setDuelFrom]       = useState("everyone");
  const [saved, setSaved] = useState(false);

  const save = () => {
    const settings = { visibility, onLeaderboard, showStreak, showCoins, duelFrom };
    localStorage.setItem("privacySettings", JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
            {["public","friends","private"].map(v => (
              <button key={v} onClick={() => setVisibility(v)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-bold capitalize transition-all
                  ${visibility === v ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/50 hover:border-white/20"}`}>
                {v === "public" ? "🌍" : v === "friends" ? "👥" : "🔒"} {v}
              </button>
            ))}
          </div>
        </div>

        {[
          { label: "Show on Leaderboard",   sub: "Appear in public rankings",                 val: onLeaderboard,  set: setOnLeaderboard },
          { label: "Show Streak Publicly",  sub: "Others can see your streak count",          val: showStreak,     set: setShowStreak },
          { label: "Show Coin Balance",     sub: "Others can see your total coins",           val: showCoins,      set: setShowCoins },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between py-2 border-b border-electric/10 last:border-0">
            <div>
              <p className="text-cream text-sm font-semibold">{item.label}</p>
              <p className="text-cream/40 text-xs">{item.sub}</p>
            </div>
            <Toggle checked={item.val} onChange={item.set} />
          </div>
        ))}

        <div>
          <label className={labelCls}>Allow Duel Challenges From</label>
          <div className="flex gap-2">
            {["everyone","nobody"].map(v => (
              <button key={v} onClick={() => setDuelFrom(v)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-bold capitalize transition-all
                  ${duelFrom === v ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/50 hover:border-white/20"}`}>
                {v === "everyone" ? "⚔️ Everyone" : "🚫 Nobody"}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {saved && <SaveToast msg="Privacy settings saved!" />}
      <button onClick={save}
        className="w-full py-3.5 rounded-xl font-bold text-sm"
        style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
        💾 Save Privacy Settings
      </button>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-2">YOUR DATA</h3>
        <p className="text-cream/40 text-sm mb-4">Download a copy of everything Lionade has stored about you</p>
        <button onClick={downloadData}
          className="px-6 py-2.5 rounded-xl border border-electric/40 text-electric text-sm font-bold hover:bg-electric/10 transition-all">
          ⬇ Download My Data (JSON)
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
            <label className={labelCls}>Current Password</label>
            <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
              placeholder="••••••••" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>New Password</label>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
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
                  <div key={c.label} className={`flex items-center gap-2 text-xs ${c.ok ? "text-green-400" : "text-red-400"}`}>
                    <span>{c.ok ? "✓" : "✗"}</span><span>{c.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className={labelCls}>Confirm New Password</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              placeholder="Re-enter new password" className={inputCls} />
            {confirmPw.length > 0 && (
              <p className={`text-xs font-semibold mt-1 ${pwMatch ? "text-green-400" : "text-red-400"}`}>
                {pwMatch ? "✓ Passwords match" : "Passwords do not match"}
              </p>
            )}
          </div>

          {toast && <SaveToast msg={toast.msg} isError={toast.err} />}
          <button onClick={handleChangePassword} disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-sm bg-electric text-white disabled:opacity-60 transition-all">
            {saving ? "Updating..." : "🔐 Change Password"}
          </button>
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-2">ACTIVE SESSIONS</h3>
        <p className="text-cream/40 text-sm mb-4">Devices currently signed into your account</p>
        <div className="flex items-center gap-3 p-3 rounded-xl bg-electric/5 border border-electric/20">
          <span className="text-2xl">💻</span>
          <div>
            <p className="text-cream text-sm font-semibold">Current Session</p>
            <p className="text-cream/40 text-xs">This device · Active now</p>
          </div>
          <span className="ml-auto text-green-400 text-xs font-bold">● Active</span>
        </div>
        <p className="text-cream/20 text-xs mt-3">Full session management requires Supabase Auth admin access</p>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-red-400 tracking-wider mb-2">DANGER ZONE</h3>
        <p className="text-cream/40 text-sm mb-4">These actions are permanent and cannot be undone</p>
        <button className="px-6 py-2.5 rounded-xl border border-red-400/30 text-red-400 text-sm font-bold hover:bg-red-400/10 transition-all">
          🗑️ Delete Account
        </button>
      </Card>
    </div>
  );
}

// ── ACTIVITY HISTORY ───────────────────────────────────
function ActivitySection({ activity, quizHistory }: SharedProps) {
  const [view, setView] = useState<"transactions"|"quizzes">("transactions");

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="ACTIVITY HISTORY" sub="Your last 30 actions" />

      <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-electric/10">
        <button onClick={() => setView("transactions")}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all
            ${view === "transactions" ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream"}`}>
          💰 Coin Transactions
        </button>
        <button onClick={() => setView("quizzes")}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all
            ${view === "quizzes" ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream"}`}>
          📝 Quiz History
        </button>
      </div>

      {view === "transactions" && (
        <div className="space-y-2">
          {activity.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-cream/40">No activity yet. Start grinding!</p>
            </Card>
          ) : activity.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-electric/10 hover:border-electric/30 transition-all"
              style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 bg-electric/10">
                {a.type === "duel_win" ? "⚔️" : a.type === "badge_bonus" ? "🎖️" : "📝"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-cream text-sm font-semibold truncate">{a.description}</p>
                <p className="text-cream/40 text-xs">{new Date(a.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
              <span className={`font-bebas text-lg flex-shrink-0 ${a.amount > 0 ? "text-gold" : "text-cream/30"}`}>
                {a.amount > 0 ? `+${a.amount}` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {view === "quizzes" && (
        <div className="space-y-2">
          {quizHistory.length === 0 ? (
            <Card className="text-center py-10">
              <p className="text-cream/40">No quizzes yet. Take your first quiz!</p>
              <Link href="/quiz"><button className="mt-4 px-6 py-2.5 rounded-xl bg-electric text-white text-sm font-bold">Start a Quiz</button></Link>
            </Card>
          ) : quizHistory.map((h: any) => {
            const acc = Math.round((h.correct_answers / h.total_questions) * 100);
            return (
              <div key={h.id} className="flex items-center gap-3 p-4 rounded-xl border border-electric/10 hover:border-electric/30 transition-all"
                style={{ background: "linear-gradient(135deg, #0a1020, #060c18)" }}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0 border
                  ${acc === 100 ? "bg-gold/20 border-gold/50" : acc >= 70 ? "bg-green-400/20 border-green-400/50" : "bg-red-400/20 border-red-400/50"}`}>
                  {acc === 100 ? "💎" : acc >= 70 ? "✅" : "❌"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-cream text-sm font-semibold">{h.subject}</p>
                  <p className="text-cream/40 text-xs">{new Date(h.completed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-cream text-sm font-bold">{h.correct_answers}/{h.total_questions}</p>
                  <p className="text-cream/40 text-xs">{acc}%</p>
                </div>
                <span className={`font-bebas text-lg flex-shrink-0 ${h.coins_earned > 0 ? "text-gold" : "text-cream/30"}`}>
                  {h.coins_earned > 0 ? `+${h.coins_earned}` : "—"}
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
function NotificationsSection() {
  const [prefs, setPrefs] = useState({
    dailyReminder: true,
    duelChallenges: true,
    weeklyReport: true,
    badgeUnlocked: true,
    streakAlert: true,
    newFeatures: false,
    marketing: false,
  });
  const [saved, setSaved] = useState(false);

  const toggle = (key: keyof typeof prefs) =>
    setPrefs(p => ({ ...p, [key]: !p[key] }));

  const save = () => {
    localStorage.setItem("notifPrefs", JSON.stringify(prefs));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const items = [
    { key: "dailyReminder",  label: "Daily Study Reminder",    sub: "Get notified to keep your streak alive" },
    { key: "duelChallenges", label: "Duel Challenges",         sub: "When someone challenges you to a duel" },
    { key: "weeklyReport",   label: "Weekly Progress Report",  sub: "Your week in review every Sunday" },
    { key: "badgeUnlocked",  label: "Badge Unlocked",          sub: "When you earn a new badge" },
    { key: "streakAlert",    label: "Streak at Risk",          sub: "Reminder when your streak is about to break" },
    { key: "newFeatures",    label: "New Features",            sub: "When we launch new features or updates" },
    { key: "marketing",      label: "Promotions & Offers",     sub: "Special offers and partner promotions" },
  ] as const;

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="NOTIFICATIONS" sub="Choose what you want to hear about" />
      <Card className="space-y-1">
        {items.map((item, i) => (
          <div key={item.key} className={`flex items-center justify-between py-4 ${i < items.length - 1 ? "border-b border-electric/10" : ""}`}>
            <div>
              <p className="text-cream text-sm font-semibold">{item.label}</p>
              <p className="text-cream/40 text-xs mt-0.5">{item.sub}</p>
            </div>
            <Toggle checked={prefs[item.key]} onChange={() => toggle(item.key)} />
          </div>
        ))}
      </Card>

      {saved && <SaveToast msg="Notification preferences saved!" />}
      <button onClick={save}
        className="w-full py-3.5 rounded-xl font-bold text-sm"
        style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
        💾 Save Notification Settings
      </button>
    </div>
  );
}

// ── ABOUT LIONADE ─────────────────────────────────────────
function AboutLionadeSection() {
  const sections = [
    { title: "OUR MISSION", icon: "🎯", body: "Lionade was built to give back to students. Oftentimes students work hard and burn out with little recognition. Lionade was built by students for other students. We allow all learners \u2014 novice or advanced \u2014 to be seen, valued, and acknowledged. We reward growth and achievement in a tangible way, empowering students with not just recognition but true support." },
    { title: "ABOUT US", icon: "🤝", body: "Created by a team of ambitious students looking for a way to revolutionize studying. Lionade is the platform we wish existed before us. We look to give back to a community that already gives so much, and further self improvement around the world." },
    { title: "OUR VISION", icon: "🚀", body: "Lionade aims to completely redefine the way studying is done \u2014 rewarding discipline and focus in a measurable way with active compensation for investing your time in self improvement, giving top performers real-world success." },
  ];
  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="ABOUT LIONADE" sub="Our mission, story, and vision" />
      {sections.map((s) => (
        <Card key={s.title}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-2xl">{s.icon}</span>
            <h3 className="font-bebas text-xl tracking-wider text-electric">{s.title}</h3>
          </div>
          <p className="text-cream/70 text-sm leading-relaxed">{s.body}</p>
        </Card>
      ))}
    </div>
  );
}

// ── Toggle component ───────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0
        ${checked ? "bg-electric" : "bg-white/20"}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300
        ${checked ? "left-6" : "left-0.5"}`} />
    </button>
  );
}
