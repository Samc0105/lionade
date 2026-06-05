"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getPreferences, updatePreferences } from "@/lib/db";
import type { UserPreferences } from "@/lib/db";
import { apiGet, apiPatch } from "@/lib/api-client";
import { toastError } from "@/lib/toast";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Gear, Check } from "@phosphor-icons/react";

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
      toastError(res.error ?? "Couldn't save that change");
      return;
    }
    flashSaved();
  };

  const savePrivacyFlag = async (key: "show_on_leaderboard", next: boolean) => {
    setShowOnLeaderboard(next);
    const res = await apiPatch("/api/user/preferences", { privacy: { [key]: next } });
    if (!res.ok) {
      setShowOnLeaderboard(!next);
      toastError(res.error ?? "Couldn't save that change");
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
      toastError(res.error ?? "Couldn't save that change");
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
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-cream text-sm font-semibold">Email</p>
                <p className="text-cream/30 text-xs">{user?.email ?? "—"}</p>
              </div>
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
      </div>
    </ProtectedRoute>
  );
}
