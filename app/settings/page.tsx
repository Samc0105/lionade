"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getPreferences, updatePreferences } from "@/lib/db";
import type { UserPreferences } from "@/lib/db";
import { apiGet, apiPatch } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import { usePlan } from "@/lib/use-plan";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import {
  Gear,
  Check,
  Envelope,
  X,
  User as UserIcon,
  Bell,
  Lock,
  TextAa,
  Crown,
  Sparkle,
  SignOut,
  CaretRight,
  Warning,
} from "@phosphor-icons/react";

// ── Toggle ────────────────────────────────────────────────────────────────
// Single shared toggle row used across Notifications + Privacy. GPU-only
// (transform + background-color), respects prefers-reduced-motion via the
// transition-* utilities + globals.css blanket rule at line ~3610.
function Toggle({
  enabled,
  onChange,
  label,
  description,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3.5 gap-4">
      <div className="min-w-0">
        <p className="text-cream text-sm font-semibold leading-tight">{label}</p>
        {description && (
          <p className="text-cream/45 text-xs mt-1 leading-snug">{description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        aria-pressed={enabled}
        aria-label={label}
        className={`relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200 transform-gpu focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 ${
          enabled ? "bg-electric" : "bg-white/10"
        }`}
      >
        <span
          aria-hidden="true"
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 transform-gpu"
          style={{
            transform: enabled ? "translateX(20px)" : "translateX(0)",
            willChange: "transform",
          }}
        />
      </button>
    </div>
  );
}

// ── Section card wrapper ─────────────────────────────────────────────────
function SectionCard({
  id,
  eyebrow,
  title,
  icon,
  children,
  tone = "default",
  delay = "0s",
}: {
  id: string;
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "danger";
  delay?: string;
}) {
  const isDanger = tone === "danger";
  return (
    <section
      id={id}
      className={`scroll-mt-24 rounded-2xl border p-6 mb-5 animate-slide-up transform-gpu ${
        isDanger
          ? "border-red-500/25"
          : "border-electric/10"
      }`}
      style={{
        animationDelay: delay,
        background: isDanger
          ? "linear-gradient(135deg, rgba(40,13,16,0.55), rgba(28,10,12,0.55))"
          : "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))",
      }}
    >
      <header className="flex items-center gap-3 mb-4">
        <span
          className={`flex items-center justify-center w-9 h-9 rounded-xl ${
            isDanger
              ? "bg-red-500/10 text-red-300"
              : "bg-electric/10 text-electric"
          }`}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p
            className={`font-mono text-[10px] uppercase tracking-[0.28em] leading-none mb-1 ${
              isDanger ? "text-red-400/70" : "text-cream/40"
            }`}
          >
            {eyebrow}
          </p>
          <h2
            className={`font-bebas text-[22px] tracking-wider leading-none ${
              isDanger ? "text-red-200" : "text-cream"
            }`}
          >
            {title}
          </h2>
        </div>
      </header>
      {children}
    </section>
  );
}

// ── Sticky desktop section nav ───────────────────────────────────────────
const SECTIONS: Array<{ id: string; label: string }> = [
  { id: "section-account", label: "Account" },
  { id: "section-subscription", label: "Subscription" },
  { id: "section-notifications", label: "Notifications" },
  { id: "section-privacy", label: "Privacy" },
  { id: "section-display", label: "Display" },
  { id: "section-danger", label: "Danger zone" },
];

function SectionNav({ active }: { active: string }) {
  return (
    <nav
      aria-label="Settings sections"
      className="hidden lg:block sticky top-24 self-start"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/35 mb-3 pl-3">
        Jump to
      </p>
      <ul className="flex flex-col gap-0.5">
        {SECTIONS.map((s) => {
          const isActive = active === s.id;
          return (
            <li key={s.id} className="relative">
              <a
                href={`#${s.id}`}
                aria-current={isActive ? "true" : undefined}
                className={`relative flex items-center gap-2 pl-3 pr-3 py-2 text-[12.5px] font-semibold rounded-md transition-colors duration-200 ${
                  isActive
                    ? "text-cream"
                    : "text-cream/45 hover:text-cream/80"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full transition-all duration-300 transform-gpu ${
                    isActive ? "bg-electric opacity-100" : "bg-electric/0 opacity-0"
                  }`}
                  style={{ willChange: "opacity, transform" }}
                />
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { plan, isPaid, isLoading: planLoading } = usePlan();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("section-account");

  // P0 trust-gap fix 2026-06-05: these used to be local-only useState and
  // never persisted. Now they hydrate from /api/user/preferences (same
  // backing store as the Profile page toggles) and PATCH back on each flip.
  const [streakReminders, setStreakReminders] = useState(true);
  const [duelNotifications, setDuelNotifications] = useState(true);
  const [leaderboardUpdates, setLeaderboardUpdates] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);

  useEffect(() => {
    if (!user) return;
    setPrefsLoading(true);
    getPreferences(user.id)
      .then((p) => setPrefs(p))
      .catch(console.error)
      .finally(() => setPrefsLoading(false));
    apiGet<{
      notifications: { daily_reminder: boolean; duel_challenges: boolean; leaderboard_updates: boolean };
      privacy: { show_on_leaderboard: boolean };
      profile_visibility: "public" | "private";
    }>("/api/user/preferences").then((res) => {
      if (!res.ok || !res.data) return;
      setStreakReminders(res.data.notifications.daily_reminder);
      setDuelNotifications(res.data.notifications.duel_challenges);
      setLeaderboardUpdates(res.data.notifications.leaderboard_updates);
      setPublicProfile(res.data.profile_visibility === "public");
      setShowOnLeaderboard(res.data.privacy.show_on_leaderboard);
    });
  }, [user]);

  // Track which section is in view for the sticky nav. IntersectionObserver
  // is GPU-friendly (no scroll handler), respects prefers-reduced-motion by
  // not animating beyond the indicator's existing transition.
  const sectionRefs = useRef<HTMLElement[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (n): n is HTMLElement => !!n,
    );
    sectionRefs.current = nodes;
    if (!nodes.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    nodes.forEach((n) => obs.observe(n));
    return () => obs.disconnect();
  }, []);

  const flashSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const save = async (update: Partial<UserPreferences>) => {
    if (!user) return;
    const merged = { ...prefs, ...update } as UserPreferences;
    setPrefs(merged);
    try {
      await updatePreferences(user.id, update);
      flashSaved();
    } catch (err) {
      console.error("[Settings] Save failed:", err);
    }
  };

  const saveNotif = async (
    key: "daily_reminder" | "duel_challenges" | "leaderboard_updates",
    next: boolean,
  ) => {
    const setter =
      key === "daily_reminder"
        ? setStreakReminders
        : key === "duel_challenges"
          ? setDuelNotifications
          : setLeaderboardUpdates;
    setter(next);
    const res = await apiPatch("/api/user/preferences", { notifications: { [key]: next } });
    if (!res.ok) {
      setter(!next);
      console.error("[settings:save] failed", res.error);
      toastError("Couldn't save that change. Try again.");
      return;
    }
    flashSaved();
  };

  const savePrivacyFlag = async (key: "show_on_leaderboard", next: boolean) => {
    setShowOnLeaderboard(next);
    const res = await apiPatch("/api/user/preferences", { privacy: { [key]: next } });
    if (!res.ok) {
      setShowOnLeaderboard(!next);
      console.error("[settings:save] failed", res.error);
      toastError("Couldn't save that change. Try again.");
      return;
    }
    flashSaved();
  };

  const saveVisibility = async (next: boolean) => {
    setPublicProfile(next);
    const res = await apiPatch("/api/user/profile-visibility", {
      visibility: next ? "public" : "private",
    });
    if (!res.ok) {
      setPublicProfile(!next);
      console.error("[settings:save] failed", res.error);
      toastError("Couldn't save that change. Try again.");
      return;
    }
    flashSaved();
  };

  const planLabel = useMemo(() => {
    if (planLoading) return "Loading…";
    if (plan === "platinum") return "Platinum";
    if (plan === "pro") return "Pro";
    return "Free";
  }, [plan, planLoading]);

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <BackButton />

        {/* Hero */}
        <div className="text-center mb-10 animate-slide-up transform-gpu">
          <div className="flex justify-center mb-3">
            <Gear size={48} weight="regular" className="text-cream/80" aria-hidden="true" />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/40 mb-2">
            Your control panel
          </p>
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider mb-2">
            SETTINGS
          </h1>
          <p className="text-cream/50 text-sm">Manage your account, notifications, and privacy</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-8 lg:gap-10">
          <SectionNav active={activeSection} />

          <div className="min-w-0">
            {/* ── Account ─────────────────────────────────────────────── */}
            <SectionCard
              id="section-account"
              eyebrow="Identity"
              title="ACCOUNT"
              icon={<UserIcon size={18} weight="regular" />}
              delay="0.05s"
            >
              <div className="flex items-center gap-4 pb-4 mb-2 border-b border-white/[0.06]">
                {user?.avatar ? (
                  <Image
                    src={user.avatar}
                    alt=""
                    width={56}
                    height={56}
                    className="rounded-full border border-white/10"
                    unoptimized
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-white/[0.05] border border-white/10" />
                )}
                <div className="min-w-0">
                  <p className="text-cream font-semibold text-base leading-tight truncate">
                    {user?.displayName || user?.username || "Player"}
                  </p>
                  {user?.username && (
                    <p className="text-cream/45 text-xs mt-0.5 truncate">@{user.username}</p>
                  )}
                </div>
              </div>

              <div className="divide-y divide-white/5">
                <Row label="Email" value={user?.email ?? "Not set"}>
                  <button
                    type="button"
                    onClick={() => setShowEmailModal(true)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border border-electric/30 text-electric hover:bg-electric/10 transition-colors transform-gpu"
                  >
                    Change
                  </button>
                </Row>
                <Row label="Username" value={user?.username ? `@${user.username}` : "Not set"} />
                <Row label="User ID" value={user?.id ?? "Not available"} mono />
              </div>
            </SectionCard>

            {/* ── Subscription ─────────────────────────────────────────── */}
            <SectionCard
              id="section-subscription"
              eyebrow="Billing"
              title="SUBSCRIPTION"
              icon={
                isPaid ? (
                  <Crown size={18} weight="fill" />
                ) : (
                  <Sparkle size={18} weight="regular" />
                )
              }
              delay="0.08s"
            >
              <div className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bebas text-[22px] tracking-wider text-cream leading-none">
                      {planLabel}
                    </span>
                    {isPaid && (
                      <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-cream/50">
                        · active
                      </span>
                    )}
                  </div>
                  <p className="text-cream/45 text-xs mt-1.5 leading-snug">
                    {isPaid
                      ? "Manage billing, switch cycles, or cancel anytime."
                      : "Unlock more Mastery targets, higher Fang rates, and fewer ads."}
                  </p>
                </div>
                <Link
                  href="/settings/subscription"
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-electric/30 text-electric hover:bg-electric/10 transition-colors transform-gpu"
                >
                  {isPaid ? "Manage" : "Upgrade"}
                  <CaretRight size={12} weight="bold" aria-hidden="true" />
                </Link>
              </div>
            </SectionCard>

            {/* ── Notifications ────────────────────────────────────────── */}
            <SectionCard
              id="section-notifications"
              eyebrow="Alerts"
              title="NOTIFICATIONS"
              icon={<Bell size={18} weight="regular" />}
              delay="0.12s"
            >
              <p className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-cream/35 mb-1">
                Streaks
              </p>
              <div className="divide-y divide-white/5">
                <Toggle
                  label="Streak reminders"
                  description="Get notified before your streak expires"
                  enabled={streakReminders}
                  onChange={(v) => saveNotif("daily_reminder", v)}
                />
              </div>

              <p className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-cream/35 mt-5 mb-1">
                Social
              </p>
              <div className="divide-y divide-white/5">
                <Toggle
                  label="Duel invites"
                  description="Receive notifications for duel challenges"
                  enabled={duelNotifications}
                  onChange={(v) => saveNotif("duel_challenges", v)}
                />
                <Toggle
                  label="Leaderboard updates"
                  description="Know when your ranking changes"
                  enabled={leaderboardUpdates}
                  onChange={(v) => saveNotif("leaderboard_updates", v)}
                />
              </div>
            </SectionCard>

            {/* ── Privacy ──────────────────────────────────────────────── */}
            <SectionCard
              id="section-privacy"
              eyebrow="Visibility"
              title="PRIVACY"
              icon={<Lock size={18} weight="regular" />}
              delay="0.16s"
            >
              <div className="divide-y divide-white/5">
                <Toggle
                  label="Public profile"
                  description="Allow other players to find you in search and on the leaderboard"
                  enabled={publicProfile}
                  onChange={(v) => saveVisibility(v)}
                />
                <Toggle
                  label="Show on leaderboard"
                  description="Appear in the public leaderboard rankings"
                  enabled={showOnLeaderboard}
                  onChange={(v) => savePrivacyFlag("show_on_leaderboard", v)}
                />
              </div>
              <p className="mt-4 text-cream/35 text-[11px] leading-snug">
                Turning off public profile hides you from search and leaderboards. Friends you have already added can still see your activity.
              </p>
            </SectionCard>

            {/* ── Display ──────────────────────────────────────────────── */}
            <SectionCard
              id="section-display"
              eyebrow="Appearance"
              title="DISPLAY"
              icon={<TextAa size={18} weight="regular" />}
              delay="0.2s"
            >
              <div className="divide-y divide-white/5">
                <div className="flex items-center justify-between py-3 gap-4">
                  <div className="min-w-0">
                    <p className="text-cream text-sm font-semibold leading-tight">Font size</p>
                    <p className="text-cream/45 text-xs mt-1 leading-snug">
                      Adjust text size across the app
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    {(["small", "medium", "large"] as const).map((size) => {
                      const isActive = prefs?.font_size === size;
                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={() => save({ font_size: size })}
                          disabled={prefsLoading}
                          aria-pressed={isActive}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors duration-200 capitalize transform-gpu ${
                            isActive
                              ? "bg-electric text-white"
                              : "bg-white/5 text-cream/55 hover:text-cream hover:bg-white/10"
                          } ${prefsLoading ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* ── Danger zone ──────────────────────────────────────────── */}
            <SectionCard
              id="section-danger"
              eyebrow="Careful"
              title="DANGER ZONE"
              icon={<Warning size={18} weight="regular" />}
              tone="danger"
              delay="0.24s"
            >
              <div className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="text-cream text-sm font-semibold leading-tight">Sign out</p>
                  <p className="text-cream/45 text-xs mt-1 leading-snug">
                    End your session on this device. You can sign back in anytime.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-red-300 border border-red-500/30 hover:bg-red-500/10 hover:border-red-500/50 transition-colors transform-gpu"
                >
                  <SignOut size={14} weight="bold" aria-hidden="true" />
                  Log out
                </button>
              </div>
            </SectionCard>
          </div>
        </div>

        {saved && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold animate-slide-up transform-gpu inline-flex items-center">
            <Check size={14} weight="bold" className="inline mr-1.5 -mt-0.5" aria-hidden="true" />
            Saved
          </div>
        )}

        <ChangeEmailModal
          open={showEmailModal}
          currentEmail={user?.email ?? ""}
          onClose={() => setShowEmailModal(false)}
        />
      </div>
    </ProtectedRoute>
  );
}

// ── Shared row layout used across Account ────────────────────────────────
function Row({
  label,
  value,
  children,
  mono = false,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-3 gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-cream text-sm font-semibold leading-tight">{label}</p>
        <p
          className={`text-cream/45 text-xs mt-1 truncate ${
            mono ? "font-mono tracking-tight" : ""
          }`}
        >
          {value}
        </p>
      </div>
      {children}
    </div>
  );
}

// ── Change Email Modal ────────────────────────────────────────────────────
// Bucket C 2026-06-05: Re-auths against current password, then calls
// supabase.auth.updateUser({ email }). Supabase sends confirmation to the
// new address; auth.user.email only swaps when the user clicks the link.
function ChangeEmailModal({
  open,
  currentEmail,
  onClose,
}: {
  open: boolean;
  currentEmail: string;
  onClose: () => void;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setNewEmail("");
      setPassword("");
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const trimmedEmail = newEmail.trim().toLowerCase();
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  const sameAsCurrent = trimmedEmail === currentEmail.trim().toLowerCase();
  const canSubmit = emailLooksValid && !sameAsCurrent && password.length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);

    const reauth = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password,
    });
    if (reauth.error) {
      setErr("Current password didn't match.");
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ email: trimmedEmail });
    if (error) {
      setErr(error.message || "Couldn't request the email change.");
      setBusy(false);
      return;
    }

    toastSuccess("Confirmation email sent. Check your inbox to verify.");
    setBusy(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{ background: "rgba(4,8,15,0.7)", backdropFilter: "blur(6px)" }}
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6 animate-slide-up transform-gpu"
        style={{
          background: "linear-gradient(135deg, rgba(13,21,40,0.98), rgba(10,16,32,0.98))",
          border: "1px solid rgba(74,144,217,0.3)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 32px rgba(74,144,217,0.15)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Change email address"
      >
        <button
          onClick={() => {
            if (!busy) onClose();
          }}
          disabled={busy}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-cream/55 hover:text-cream transition-colors disabled:opacity-40"
          aria-label="Close"
          style={{ background: "rgba(255,255,255,0.04)" }}
        >
          <X size={16} weight="bold" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2.5 mb-4">
          <Envelope size={22} weight="regular" className="text-electric" aria-hidden="true" />
          <h2 className="font-bebas text-2xl text-cream tracking-wider">CHANGE EMAIL</h2>
        </div>

        <p className="text-cream/55 text-xs mb-5 leading-relaxed">
          We&apos;ll send a confirmation link to your new address. The change takes effect once you click it.
        </p>

        <div className="space-y-3 mb-5">
          <div>
            <label
              htmlFor="settings-current-email"
              className="block text-cream/45 text-[10px] font-mono uppercase tracking-[0.18em] mb-1"
            >
              Current
            </label>
            <input
              id="settings-current-email"
              type="email"
              value={currentEmail}
              readOnly
              autoComplete="email"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-cream/50 text-sm cursor-not-allowed"
            />
          </div>
          <div>
            <label
              htmlFor="settings-new-email"
              className="block text-cream/45 text-[10px] font-mono uppercase tracking-[0.18em] mb-1"
            >
              New email
            </label>
            <input
              id="settings-new-email"
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setErr(null);
              }}
              placeholder="you@example.com"
              autoComplete="email"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-electric/50"
            />
          </div>
          <div>
            <label
              htmlFor="settings-current-password"
              className="block text-cream/45 text-[10px] font-mono uppercase tracking-[0.18em] mb-1"
            >
              Current password
            </label>
            <input
              id="settings-current-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErr(null);
              }}
              placeholder="Confirm to change email"
              autoComplete="current-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-electric/50"
            />
          </div>
        </div>

        {err && (
          <p className="text-red-400 text-xs mb-3 text-center" role="alert">
            {err}
          </p>
        )}
        {sameAsCurrent && trimmedEmail.length > 0 && !err && (
          <p className="text-cream/55 text-xs mb-3 text-center">That&apos;s already your current email.</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => {
              if (!busy) onClose();
            }}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-cream/65 text-sm font-bold hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
              canSubmit ? "bg-electric text-white hover:brightness-110" : "bg-white/5 text-cream/30 cursor-not-allowed"
            }`}
          >
            {busy ? "Sending..." : "Send confirmation"}
          </button>
        </div>
      </div>
    </div>
  );
}
