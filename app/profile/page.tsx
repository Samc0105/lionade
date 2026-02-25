"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  getAllBadges, getUserBadges, getSubjectStats,
  getQuizHistory, getRecentActivity,
} from "@/lib/db";
import { getLevelProgress, formatCoins, SUBJECT_ICONS } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import BadgeCard from "@/components/BadgeCard";
import Link from "next/link";

// ── Types ────────────────────────────────────────────
type Section =
  | "overview" | "edit-profile" | "avatar"
  | "personalization" | "privacy" | "security"
  | "activity" | "notifications";

// ── Constants ─────────────────────────────────────────
const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: "Animals", emojis: ["🦁","🐯","🐻","🐼","🦊","🐺","🦅","🦋","🐬","🦈","🐙","🦎","🐲","🦄","🦓","🐘","🦒","🐆","🦜","🦚"] },
  { label: "Food",    emojis: ["🍕","🍔","🌮","🍜","🍣","🍩","🎂","🍦","🧁","🍫","🍎","🍊","🍋","🍇","🍓","🥑","🧋","🍺","🍉","🥝"] },
  { label: "Sports",  emojis: ["⚽","🏀","🏈","⚾","🎾","🏐","🎱","🏓","⛳","🥊","🏆","🎯","🎿","🏋️","🤺","🥋","🏄","🚴","🤼","🎖️"] },
  { label: "Space",   emojis: ["🚀","🌟","⭐","🌙","☀️","🌍","🪐","💫","🛸","🌌","☄️","🌠","🔭","🌑","🌒","🌕","🌞","🌛","🌜","🌝"] },
  { label: "Fantasy", emojis: ["🐉","🧙","🧝","🧚","🦸","🧜","🔮","🪄","✨","🗡️","🛡️","👑","💎","🏰","🧿","🪬","🌀","🔯","⚗️","🧬"] },
  { label: "Faces",   emojis: ["😎","🤩","🥳","😏","🤓","🤯","🥶","🤠","👻","🎭","💀","🤖","👾","🎃","🦸","💪","👑","🔥","💯","⚡"] },
];

const COLOR_AVATARS = [
  { bg: "#4A90D9", text: "#fff" }, { bg: "#FFD700", text: "#04080F" },
  { bg: "#2ECC71", text: "#fff" }, { bg: "#E74C3C", text: "#fff" },
  { bg: "#9B59B6", text: "#fff" }, { bg: "#1ABC9C", text: "#fff" },
  { bg: "#E67E22", text: "#fff" }, { bg: "#E91E63", text: "#fff" },
  { bg: "#00BCD4", text: "#fff" }, { bg: "#FF5722", text: "#fff" },
  { bg: "#607D8B", text: "#fff" }, { bg: "#8BC34A", text: "#fff" },
  { bg: "#673AB7", text: "#fff" }, { bg: "#F44336", text: "#fff" },
  { bg: "#009688", text: "#fff" }, { bg: "#795548", text: "#fff" },
  { bg: "#3F51B5", text: "#fff" }, { bg: "#FF9800", text: "#fff" },
  { bg: "#CDDC39", text: "#04080F" }, { bg: "#04080F", text: "#4A90D9" },
];

const EDUCATION_LEVELS = [
  "Middle School","High School Freshman","High School Sophomore",
  "High School Junior","High School Senior","College Freshman",
  "College Sophomore","College Junior","College Senior",
  "Graduate Student","Working Professional","Self Taught / Independent Learner","Other",
];

const STUDY_GOALS = [
  "Improve my grades","Prepare for SAT / ACT / GRE",
  "Study for certifications (AWS, CompTIA, etc.)","Learn coding and tech skills",
  "Study for professional exams (CPA, Bar, MCAT)","General knowledge and self improvement",
  "Compete and win rewards","Other",
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
];

// ── Main Page ──────────────────────────────────────────
export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
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

  const { level, progress, xpToNext } = getLevelProgress(user.xp);
  const totalQuestions = subjectStats.reduce((s: number, r: any) => s + r.questionsAnswered, 0);
  const totalCorrect = subjectStats.reduce((s: number, r: any) => s + r.correctAnswers, 0);
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const duelsWon = activity.filter((a: any) => a.type === "duel_win").length;

  const sharedProps = {
    user, level, progress, xpToNext,
    allBadges, earnedBadges, subjectStats, quizHistory, activity,
    loading, accuracy, totalQuestions, totalCorrect, duelsWon,
    refreshUser,
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <BackButton />

          {/* Mobile header */}
          <div className="flex items-center justify-between mb-4 md:hidden">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-electric/50">
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
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
                style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}>

                {/* Profile mini card */}
                <div className="p-6 border-b border-electric/10 text-center">
                  <div className="relative w-20 h-20 mx-auto mb-3">
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-electric/50"
                      style={{ boxShadow: "0 0 20px #4A90D940" }}>
                      <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-navy
                      flex items-center justify-center font-bebas text-xs text-white"
                      style={{ background: "#4A90D9" }}>{level}</div>
                  </div>
                  <p className="font-bebas text-xl text-cream tracking-wider">@{user.username}</p>
                  <p className="text-cream/40 text-xs mt-0.5">Level {level} · {formatCoins(user.coins)} coins</p>
                  <div className="mt-3 w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full"
                      style={{ width: `${progress}%`, background: "linear-gradient(90deg, #2D6BB5, #4A90D9)" }} />
                  </div>
                  <p className="text-cream/30 text-xs mt-1">{xpToNext} XP to Level {level + 1}</p>
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
      style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}>
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
function OverviewSection({ user, level, progress, xpToNext, earnedBadges, allBadges, subjectStats, quizHistory, activity, loading, accuracy, totalQuestions, totalCorrect, duelsWon, refreshUser }: SharedProps) {
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
            <img src={user.avatar} alt={user.username} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="font-bebas text-4xl text-cream tracking-wider">{user.username}</h1>
            <p className="text-cream/40 text-sm mb-3">{user.displayName} · Level {level}</p>
            <div className="mb-4">
              <div className="flex justify-between text-xs text-cream/40 mb-1">
                <span>Level {level}</span>
                <span>{xpToNext} XP to Level {level + 1}</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${progress}%`, background: "linear-gradient(90deg, #2D6BB5, #4A90D9, #6AABF0)", boxShadow: "0 0 10px #4A90D960" }} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { icon: "🪙", label: "Total Coins",        value: formatCoins(user.coins),          color: "text-gold" },
          { icon: "🔥", label: "Day Streak",         value: `${user.streak}`,                 color: "text-orange-400" },
          { icon: "⚡", label: "Total XP",           value: user.xp.toLocaleString(),         color: "text-electric" },
          { icon: "📝", label: "Quizzes Completed",  value: quizHistory.length.toString(),    color: "text-cream" },
          { icon: "⚔️", label: "Duels Won",          value: duelsWon.toString(),              color: "text-purple-400" },
          { icon: "📚", label: "Subjects Mastered",  value: subjectStats.length.toString(),   color: "text-green-400" },
        ].map((s) => (
          <Card key={s.label} className="text-center !p-4">
            <span className="text-2xl block mb-1">{s.icon}</span>
            <p className={`font-bebas text-2xl leading-none ${s.color}`}>{s.value}</p>
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

  // Load current profile data
  useEffect(() => {
    supabase.from("profiles").select("*").eq("id", user.id).single()
      .then(({ data }) => {
        if (!data) return;
        if (data.first_name)     setFirstName(data.first_name);
        if (data.bio)            setBio(data.bio);
        if (data.education_level) setEducation(data.education_level);
        if (data.study_goal)     setStudyGoal(data.study_goal);
      });
  }, [user.id]);

  // Username availability debounce
  useEffect(() => {
    if (username === user.username) { setUsernameStatus("idle"); return; }
    if (username.length < 3) { setUsernameStatus("idle"); return; }
    if (RESERVED.includes(username)) { setUsernameStatus("taken"); return; }
    setUsernameStatus("checking");
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 500);
    return () => clearTimeout(t);
  }, [username]);

  const handleSave = async () => {
    if (usernameStatus === "taken") { setToast({ msg: "Username is taken", err: true }); return; }
    if (usernameStatus === "checking") { setToast({ msg: "Wait for username check", err: true }); return; }
    setSaving(true);
    const updates: Record<string, string> = {
      username: username.trim().toLowerCase(),
      display_name: firstName.trim(),
      bio: bio.trim(),
      education_level: education,
      study_goal: studyGoal,
    };
    const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
    if (error) {
      setToast({ msg: error.message, err: true });
    } else {
      // Sync auth metadata
      await supabase.auth.updateUser({ data: { username: updates.username, display_name: updates.display_name } });
      await refreshUser();
      setToast({ msg: "Profile saved!", err: false });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="EDIT PROFILE" sub="Update your public profile information" />
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
                placeholder="your_handle" className={inputCls + " pr-28"} />
              {usernameStatus === "checking" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-cream/40 text-xs">Checking...</span>}
              {usernameStatus === "available" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-semibold">✓ Available</span>}
              {usernameStatus === "taken"     && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-xs font-semibold">✗ Taken</span>}
            </div>
            <p className="text-cream/25 text-xs mt-1">Lowercase letters, numbers, underscores only</p>
          </div>

          <div>
            <label className={labelCls}>Bio <span className="text-cream/30 normal-case font-normal">({bio.length}/150)</span></label>
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

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3.5 rounded-xl font-bold text-sm disabled:opacity-60 transition-all"
            style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
            {saving ? "Saving..." : "💾 Save Changes"}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── AVATAR & APPEARANCE ───────────────────────────────
function AvatarSection({ user, refreshUser }: SharedProps) {
  const [tab, setTab] = useState<"emoji"|"color"|"upload">("emoji");
  const [emojiCat, setEmojiCat] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{msg: string; err: boolean}|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveAvatar = async (url: string) => {
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
    if (!error) {
      await supabase.auth.updateUser({ data: { avatar_url: url } });
      await refreshUser();
      setToast({ msg: "Avatar updated!", err: false });
    } else {
      setToast({ msg: error.message, err: true });
    }
    setSaving(false);
    setTimeout(() => setToast(null), 3000);
  };

  const handleEmojiSelect = (emoji: string) => {
    const url = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(emoji)}&backgroundColor=4A90D9`;
    setSelected(url);
  };

  const handleColorSelect = (color: { bg: string; text: string }) => {
    const bg = color.bg.replace("#", "");
    const url = `https://api.dicebear.com/7.x/initials/svg?seed=${user.username}&backgroundColor=${bg}&textColor=ffffff&fontSize=40`;
    setSelected(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    const ext = file.name.split(".").pop();
    const path = `avatars/${user.id}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (uploadError) {
      setToast({ msg: "Upload failed: " + uploadError.message, err: true });
      setSaving(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    await saveAvatar(urlData.publicUrl);
  };

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="AVATAR & APPEARANCE" sub="Choose how you look to the world" />

      {/* Current avatar */}
      <Card className="flex items-center gap-5">
        <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-electric/50 flex-shrink-0">
          <img src={selected ?? user.avatar} alt="preview" className="w-full h-full object-cover" />
        </div>
        <div>
          <p className="text-cream font-bold">Current Avatar</p>
          <p className="text-cream/40 text-sm mt-0.5">Pick a new one below, then save</p>
        </div>
        {selected && selected !== user.avatar && (
          <button onClick={() => saveAvatar(selected!)} disabled={saving}
            className="ml-auto px-5 py-2.5 rounded-xl font-bold text-sm bg-electric text-white disabled:opacity-60">
            {saving ? "Saving..." : "✓ Save Avatar"}
          </button>
        )}
      </Card>

      {toast && <SaveToast msg={toast.msg} isError={toast.err} />}

      {/* Tabs */}
      <div className="flex gap-1 bg-white/5 p-1 rounded-xl border border-electric/10">
        {(["emoji","color","upload"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all capitalize
              ${tab === t ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream"}`}>
            {t === "emoji" ? "🎭 Emoji" : t === "color" ? "🎨 Color" : "📸 Upload"}
          </button>
        ))}
      </div>

      {/* Emoji tab */}
      {tab === "emoji" && (
        <Card>
          {/* Category tabs */}
          <div className="flex gap-1 mb-4 flex-wrap">
            {EMOJI_CATEGORIES.map((cat, i) => (
              <button key={cat.label} onClick={() => setEmojiCat(i)}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all
                  ${emojiCat === i ? "bg-electric/20 text-electric border border-electric/40" : "text-cream/40 hover:text-cream hover:bg-white/5"}`}>
                {cat.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-10 gap-1.5">
            {EMOJI_CATEGORIES[emojiCat].emojis.map((emoji) => {
              const url = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(emoji)}&backgroundColor=4A90D9`;
              const isSelected = selected === url;
              return (
                <button key={emoji} onClick={() => handleEmojiSelect(emoji)}
                  className={`text-2xl w-full aspect-square flex items-center justify-center rounded-xl transition-all hover:scale-110
                    ${isSelected ? "ring-2 ring-gold bg-gold/10" : "hover:bg-white/10"}`}>
                  {emoji}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Color tab */}
      {tab === "color" && (
        <Card>
          <p className="text-cream/40 text-sm mb-4">Your username initial in different color combos</p>
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
            {COLOR_AVATARS.map((color, i) => {
              const bg = color.bg.replace("#", "");
              const url = `https://api.dicebear.com/7.x/initials/svg?seed=${user.username}&backgroundColor=${bg}&textColor=ffffff&fontSize=40`;
              const isSelected = selected === url;
              return (
                <button key={i} onClick={() => handleColorSelect(color)}
                  className={`w-full aspect-square rounded-xl flex items-center justify-center font-bebas text-xl font-bold transition-all hover:scale-110
                    ${isSelected ? "ring-2 ring-gold scale-110" : ""}`}
                  style={{ background: color.bg, color: color.text }}>
                  {user.username[0]?.toUpperCase()}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Upload tab */}
      {tab === "upload" && (
        <Card>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          <div className="text-center py-8">
            <div className="text-5xl mb-4">📸</div>
            <p className="text-cream font-bold mb-2">Upload a Photo</p>
            <p className="text-cream/40 text-sm mb-6">JPG, PNG or WebP · Max 5MB</p>
            <button onClick={() => fileRef.current?.click()} disabled={saving}
              className="px-8 py-3 rounded-xl font-bold text-sm bg-electric text-white disabled:opacity-60">
              {saving ? "Uploading..." : "Choose File"}
            </button>
            <p className="text-cream/20 text-xs mt-4">Requires an "avatars" storage bucket in Supabase with public access</p>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── PERSONALIZATION ────────────────────────────────────
function PersonalizationSection({ user }: SharedProps) {
  const SUBJECTS = ["Math","Science","Languages","SAT/ACT","Coding","Finance","Certifications"];
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") ?? "dark-navy");
  const [fontSize, setFontSize] = useState(() => localStorage.getItem("fontSize") ?? "medium");
  const [layout, setLayout] = useState(() => localStorage.getItem("layout") ?? "expanded");
  const [prefSubjects, setPrefSubjects] = useState<string[]>(() => JSON.parse(localStorage.getItem("prefSubjects") ?? "[]"));
  const [reminderEnabled, setReminderEnabled] = useState(() => localStorage.getItem("reminderEnabled") === "true");
  const [reminderTime, setReminderTime] = useState(() => localStorage.getItem("reminderTime") ?? "09:00");
  const [saved, setSaved] = useState(false);

  const save = () => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("fontSize", fontSize);
    localStorage.setItem("layout", layout);
    localStorage.setItem("prefSubjects", JSON.stringify(prefSubjects));
    localStorage.setItem("reminderEnabled", String(reminderEnabled));
    localStorage.setItem("reminderTime", reminderTime);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleSubject = (s: string) =>
    setPrefSubjects(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <div className="space-y-6 animate-slide-up">
      <SectionHead title="PERSONALIZATION" sub="Customize your Lionade experience" />

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">THEME</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { id: "dark-navy",   label: "Dark Navy",   bg: "#04080F", accent: "#4A90D9" },
            { id: "pure-black",  label: "Pure Black",  bg: "#000000", accent: "#4A90D9" },
            { id: "dark-purple", label: "Dark Purple", bg: "#0D0A1A", accent: "#9B59B6" },
            { id: "dark-green",  label: "Dark Green",  bg: "#071A0D", accent: "#2ECC71" },
          ].map(t => (
            <button key={t.id} onClick={() => setTheme(t.id)}
              className={`p-4 rounded-xl border-2 text-sm font-bold transition-all
                ${theme === t.id ? "border-electric text-electric" : "border-white/10 text-cream/50 hover:border-white/20"}`}
              style={{ background: t.bg }}>
              <div className="w-full h-6 rounded-lg mb-2" style={{ background: t.accent, opacity: 0.8 }} />
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">FONT SIZE</h3>
        <div className="flex gap-3">
          {["small","medium","large"].map(f => (
            <button key={f} onClick={() => setFontSize(f)}
              className={`flex-1 py-3 rounded-xl border font-bold capitalize transition-all
                ${fontSize === f ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/50 hover:border-white/20"}`}>
              {f === "small" ? "A" : f === "medium" ? "A" : "A"}
              <span className="block text-xs mt-0.5 font-normal normal-case">{f}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">DASHBOARD LAYOUT</h3>
        <div className="flex gap-3">
          {["compact","expanded"].map(l => (
            <button key={l} onClick={() => setLayout(l)}
              className={`flex-1 py-3 rounded-xl border font-bold capitalize transition-all
                ${layout === l ? "border-electric bg-electric/20 text-electric" : "border-white/10 text-cream/50 hover:border-white/20"}`}>
              {l === "compact" ? "⊟" : "⊞"} {l}
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
              {prefSubjects.includes(s) ? "✓ " : ""}{s}
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-bebas text-lg text-cream tracking-wider mb-4">STUDY REMINDER</h3>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-cream text-sm font-semibold">Daily Reminder</p>
            <p className="text-cream/40 text-xs">Get notified to keep your streak</p>
          </div>
          <Toggle checked={reminderEnabled} onChange={setReminderEnabled} />
        </div>
        {reminderEnabled && (
          <div>
            <label className={labelCls}>Reminder Time</label>
            <input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)}
              className={inputCls + " [color-scheme:dark]"} />
          </div>
        )}
      </Card>

      {saved && <SaveToast msg="Preferences saved!" />}
      <button onClick={save}
        className="w-full py-3.5 rounded-xl font-bold text-sm"
        style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 15px rgba(240,180,41,0.3)" }}>
        💾 Save Preferences
      </button>
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
