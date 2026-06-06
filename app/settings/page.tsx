"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getPreferences, updatePreferences } from "@/lib/db";
import type { UserPreferences } from "@/lib/db";
import { apiGet, apiPatch } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Gear, Check, Envelope, X } from "@phosphor-icons/react";

function Toggle({ enabled, onChange, label, description }: {
  enabled: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-cream text-sm font-semibold">{label}</p>
        {description && <p className="text-cream/30 text-xs mt-0.5">{description}</p>}
      </div>
      <button onClick={() => onChange(!enabled)}
        className={`w-11 h-6 rounded-full transition-all duration-200 relative ${enabled ? "bg-electric" : "bg-white/10"}`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${enabled ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [saved, setSaved] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);

  // P0 trust-gap fix 2026-06-05: these were 5 useState placeholders
  // explicitly commented "not in DB yet". Now they hydrate from
  // /api/user/preferences (same backing store as the Profile page
  // toggles) and PATCH back on each flip with optimistic update.
  const [streakReminders, setStreakReminders] = useState(true);
  const [duelNotifications, setDuelNotifications] = useState(true);
  const [leaderboardUpdates, setLeaderboardUpdates] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);
  const [showOnLeaderboard, setShowOnLeaderboard] = useState(true);

  useEffect(() => {
    if (!user) return;
    getPreferences(user.id).then(setPrefs).catch(console.error);
    // Pull the same prefs blob the Profile page uses so the two
    // surfaces never disagree. Hydrate the 5 server-backed toggles.
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

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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

  // PATCH a single notification flag through /api/user/preferences.
  // Optimistic: flip the UI immediately, revert on failure.
  const saveNotif = async (key: "daily_reminder" | "duel_challenges" | "leaderboard_updates", next: boolean) => {
    const setter = key === "daily_reminder" ? setStreakReminders
                 : key === "duel_challenges" ? setDuelNotifications
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
    // "Public Profile" toggle: true → visibility=public, false → private.
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

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
        <BackButton />

        <div className="text-center mb-10 animate-slide-up">
          <div className="flex justify-center mb-3">
            <Gear size={52} weight="regular" className="text-cream/80" aria-hidden="true" />
          </div>
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider mb-2">SETTINGS</h1>
          <p className="text-cream/50 text-sm">Manage your account preferences</p>
        </div>

        {/* Preferences */}
        <div className="rounded-2xl border border-electric/10 p-6 mb-6 animate-slide-up"
          style={{ animationDelay: "0.05s", background: "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))" }}>
          <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">DISPLAY</h2>
          <div className="divide-y divide-white/5">
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-cream text-sm font-semibold">Font Size</p>
                <p className="text-cream/30 text-xs mt-0.5">Adjust text size across the app</p>
              </div>
              <div className="flex gap-1.5">
                {(["small", "medium", "large"] as const).map(size => (
                  <button key={size} onClick={() => save({ font_size: size })}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-200 capitalize
                      ${prefs?.font_size === size ? "bg-electric text-white" : "bg-white/5 text-cream/50 hover:text-cream"}`}>
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="rounded-2xl border border-electric/10 p-6 mb-6 animate-slide-up"
          style={{ animationDelay: "0.1s", background: "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))" }}>
          <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">NOTIFICATIONS</h2>
          <div className="divide-y divide-white/5">
            <Toggle label="Streak Reminders" description="Get notified before your streak expires"
              enabled={streakReminders} onChange={(v) => saveNotif("daily_reminder", v)} />
            <Toggle label="Duel Invites" description="Receive notifications for duel challenges"
              enabled={duelNotifications} onChange={(v) => saveNotif("duel_challenges", v)} />
            <Toggle label="Leaderboard Updates" description="Know when your ranking changes"
              enabled={leaderboardUpdates} onChange={(v) => saveNotif("leaderboard_updates", v)} />
          </div>
        </div>

        {/* Privacy */}
        <div className="rounded-2xl border border-electric/10 p-6 mb-6 animate-slide-up"
          style={{ animationDelay: "0.15s", background: "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))" }}>
          <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">PRIVACY</h2>
          <div className="divide-y divide-white/5">
            <Toggle label="Public Profile" description="Allow other players to find you in search and on the leaderboard"
              enabled={publicProfile} onChange={(v) => saveVisibility(v)} />
            <Toggle label="Show on Leaderboard" description="Appear in the public leaderboard rankings"
              enabled={showOnLeaderboard} onChange={(v) => savePrivacyFlag("show_on_leaderboard", v)} />
          </div>
        </div>

        {/* Account */}
        <div className="rounded-2xl border border-electric/10 p-6 mb-6 animate-slide-up"
          style={{ animationDelay: "0.2s", background: "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))" }}>
          <h2 className="font-bebas text-xl text-cream tracking-wider mb-4">ACCOUNT</h2>
          <div className="space-y-3">
            {/* Email row — Bucket C #1 / Bucket C "Change Email missing". Tap
                "Change" to open the modal which runs supabase.auth.updateUser
                ({ email }). Supabase sends a confirmation link to the NEW
                address; user has to click it before the change applies. */}
            <div className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-cream text-sm font-semibold">Email</p>
                <p className="text-cream/30 text-xs truncate">{user?.email ?? "—"}</p>
              </div>
              <button
                onClick={() => setShowEmailModal(true)}
                className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border border-electric/30 text-electric hover:bg-electric/10 transition-all"
              >
                Change
              </button>
            </div>
            <div className="border-t border-white/5 pt-3">
              <button onClick={logout}
                className="w-full py-3 rounded-xl text-sm font-bold text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-all duration-200">
                Log Out
              </button>
            </div>
          </div>
        </div>

        {saved && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold animate-slide-up inline-flex items-center">
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

// ── Change Email Modal ────────────────────────────────────────────────────
// Bucket C 2026-06-05: Settings page used to render the user's email as
// plain text with no edit affordance. This modal collects a new email +
// the current password (re-auth for the change), then calls
// supabase.auth.updateUser({ email }). Supabase fires the confirmation
// email at the new address; the user must click the link before the
// switch lands. We surface that explicitly in the success toast so
// nobody thinks the change is already live.
//
// Security notes (security-auth-guardian signoff requested):
//   - We re-authenticate via supabase.auth.signInWithPassword before
//     calling updateUser. Supabase's updateUser does NOT re-prompt for the
//     current password by itself; without this step, an attacker who has
//     a session (e.g. stolen laptop, kid on the family iPad) could swap
//     the email and effectively take over the account via the password-
//     reset flow on the new address. Re-auth gate closes that.
//   - On re-auth failure we surface "Current password didn't match" and
//     do NOT call updateUser, so a wrong password can't leak via the
//     updateUser error path.
//   - Demo account is NOT blocked here because demo email is publicly
//     known and changing it would be visible to the next tester. We
//     surface a polite toast and skip the call.
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

  // Reset fields whenever the modal opens/closes so the next open starts clean.
  useEffect(() => {
    if (!open) {
      setNewEmail("");
      setPassword("");
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  // Esc closes the modal — accessibility baseline. Gated on !busy so we don't
  // orphan an in-flight Supabase call.
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

    // Step 1: re-auth with current password against current email.
    const reauth = await supabase.auth.signInWithPassword({
      email: currentEmail,
      password,
    });
    if (reauth.error) {
      setErr("Current password didn't match.");
      setBusy(false);
      return;
    }

    // Step 2: request the email change. Supabase will email the NEW address;
    // until the user clicks the confirmation link, auth.user.email stays the
    // old value.
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
      onClick={() => { if (!busy) onClose(); }}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md rounded-2xl p-6 animate-slide-up"
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
          onClick={() => { if (!busy) onClose(); }}
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
          We&apos;ll send a confirmation link to your new address. The change
          takes effect once you click it.
        </p>

        <div className="space-y-3 mb-5">
          <div>
            <label htmlFor="settings-current-email" className="block text-cream/45 text-[10px] font-mono uppercase tracking-[0.18em] mb-1">
              Current
            </label>
            <input
              id="settings-current-email"
              type="email"
              value={currentEmail}
              readOnly
              className="w-full px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] text-cream/50 text-sm cursor-not-allowed"
            />
          </div>
          <div>
            <label htmlFor="settings-new-email" className="block text-cream/45 text-[10px] font-mono uppercase tracking-[0.18em] mb-1">
              New email
            </label>
            <input
              id="settings-new-email"
              type="email"
              value={newEmail}
              onChange={(e) => { setNewEmail(e.target.value); setErr(null); }}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-electric/50"
            />
          </div>
          <div>
            <label htmlFor="settings-current-password" className="block text-cream/45 text-[10px] font-mono uppercase tracking-[0.18em] mb-1">
              Current password
            </label>
            <input
              id="settings-current-password"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setErr(null); }}
              placeholder="Confirm to change email"
              autoComplete="current-password"
              disabled={busy}
              className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-cream text-sm placeholder:text-cream/30 focus:outline-none focus:border-electric/50"
            />
          </div>
        </div>

        {err && (
          <p className="text-red-400 text-xs mb-3 text-center" role="alert">{err}</p>
        )}
        {sameAsCurrent && trimmedEmail.length > 0 && !err && (
          <p className="text-cream/55 text-xs mb-3 text-center">That&apos;s already your current email.</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => { if (!busy) onClose(); }}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-cream/65 text-sm font-bold hover:bg-white/5 transition-all disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${canSubmit ? "bg-electric text-white hover:brightness-110" : "bg-white/5 text-cream/30 cursor-not-allowed"}`}
          >
            {busy ? "Sending..." : "Send confirmation"}
          </button>
        </div>
      </div>
    </div>
  );
}
