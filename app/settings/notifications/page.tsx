"use client";

/**
 * /settings/notifications — Notifications section of the route-based settings.
 *
 * Renders inside app/settings/layout.tsx (which already supplies
 * ProtectedRoute + Navbar + SpaceBackground + the section nav rail), so this
 * page is just the section content: four category SettingsCards plus a Quiet
 * Hours card.
 *
 * Each notification is a SettingRow with TWO compact checkboxes — In-app
 * (notifications[key]) and Email (notifications_email[key]). Every change
 * saves immediately via PATCH /api/user/preferences: optimistic local update,
 * a "Saved ✓" tick on success, revert + toast on failure. No Save button.
 *
 * Quiet hours is a master Toggle (quiet_hours_enabled) plus a From/To native
 * time range (quiet_hours_start / quiet_hours_end, 24h "HH:MM"). The time
 * inputs dim + disable when quiet hours is off.
 *
 * Design system: navy bg, cream text, electric primary, gold accents. Glass
 * cards from components/settings/shared. All motion is GPU-only (opacity /
 * transform) and reduced-motion safe via the globals.css blanket rule.
 */

import { useCallback, useEffect, useState } from "react";
import { Check } from "@phosphor-icons/react";
import {
  SettingsCard,
  SettingRow,
  Toggle,
  useSavedConfirm,
  SavedTick,
} from "@/components/settings/shared";
import { apiGet, apiPatch } from "@/lib/api-client";
import { toastError } from "@/lib/toast";
import type { NotificationPrefs } from "@/lib/db";

// ── Types mirroring the GET /api/user/preferences payload ────────────────────

type NotifKey = keyof NotificationPrefs;

interface PrefsState {
  notifications: Record<NotifKey, boolean>;
  notifications_email: Partial<Record<NotifKey, boolean>>;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

// Which channel a single checkbox edits.
type Channel = "in_app" | "email";

// ── Category definitions (label + order match the product spec) ──────────────

const CATEGORIES: {
  eyebrow: string;
  title: string;
  items: { key: NotifKey; label: string }[];
}[] = [
  {
    eyebrow: "Studying",
    title: "Study",
    items: [
      { key: "daily_reminder", label: "Daily study reminder" },
      { key: "streak_alert", label: "Streak at risk alert" },
      { key: "weekly_report", label: "Weekly study report" },
    ],
  },
  {
    eyebrow: "Friends & play",
    title: "Social",
    items: [
      { key: "friend_requests", label: "Friend request received" },
      { key: "friend_accepted", label: "Friend request accepted" },
      { key: "duel_challenges", label: "Duel challenge received" },
      { key: "nudge_received", label: "Nudge received" },
      { key: "party_invites", label: "Party invite received" },
    ],
  },
  {
    eyebrow: "Fangs & wins",
    title: "Rewards",
    items: [
      { key: "badge_unlocked", label: "Badge unlocked" },
      { key: "bounty_completed", label: "Bounty completed" },
      { key: "fangs_received", label: "Fangs received" },
    ],
  },
  {
    eyebrow: "From Lionade",
    title: "Product",
    items: [
      { key: "new_features", label: "New features announcement" },
      { key: "marketing", label: "Promotions and offers" },
    ],
  },
];

// ── Tiny labeled checkbox ─────────────────────────────────────────────────────
// Compact square box + micro-label. Pure border/background-color transitions
// (GPU-safe, reduced-motion safe). Used as the In-app / Email controls.
function Checkbox({
  checked,
  onChange,
  label,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-1.5 focus:outline-none"
    >
      <span
        aria-hidden="true"
        className={`flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border transition-colors duration-200 transform-gpu group-focus-visible:ring-2 group-focus-visible:ring-electric/40 ${
          checked
            ? "bg-electric border-electric"
            : "bg-white/[0.04] border-white/15 group-hover:border-white/30"
        }`}
      >
        <Check
          size={12}
          weight="bold"
          className={`text-white transition-opacity duration-150 transform-gpu ${
            checked ? "opacity-100" : "opacity-0"
          }`}
        />
      </span>
      <span
        className={`font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-200 ${
          checked ? "text-cream/75" : "text-cream/40 group-hover:text-cream/55"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading notification settings">
      {[0, 1, 2, 3].map((c) => (
        <div
          key={c}
          className="rounded-2xl border border-electric/10 p-6 mb-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))",
          }}
        >
          <div className="h-3 w-24 rounded bg-white/10 mb-4 animate-pulse" />
          {[0, 1, 2].map((r) => (
            <div
              key={r}
              className="flex items-center justify-between py-3.5"
            >
              <div className="h-3.5 w-40 rounded bg-white/10 animate-pulse" />
              <div className="flex gap-4">
                <div className="h-4 w-16 rounded bg-white/10 animate-pulse" />
                <div className="h-4 w-16 rounded bg-white/10 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Error card ────────────────────────────────────────────────────────────────
function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <SettingsCard eyebrow="Something went wrong" title="Couldn't load settings">
      <p className="text-cream/55 text-sm mb-4 leading-snug">
        We couldn't load your notification preferences. Check your connection
        and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center px-4 py-2 rounded-lg text-xs font-bold bg-electric text-navy hover:bg-electric/90 transition-colors transform-gpu"
      >
        Retry
      </button>
    </SettingsCard>
  );
}

export default function NotificationsPage() {
  const [prefs, setPrefs] = useState<PrefsState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  const load = useCallback(async () => {
    setStatus("loading");
    const res = await apiGet<PrefsState>("/api/user/preferences");
    if (!res.ok || !res.data) {
      setStatus("error");
      return;
    }
    setPrefs({
      notifications: res.data.notifications,
      notifications_email: res.data.notifications_email ?? {},
      quiet_hours_enabled: res.data.quiet_hours_enabled ?? false,
      quiet_hours_start: res.data.quiet_hours_start ?? "22:00",
      quiet_hours_end: res.data.quiet_hours_end ?? "08:00",
    });
    setStatus("ready");
  }, []);

  // Initial fetch (runs once; load identity is stable).
  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") return <LoadingSkeleton />;
  if (status === "error" || !prefs)
    return <ErrorCard onRetry={() => void load()} />;

  return <NotificationsForm initial={prefs} />;
}

// ── Stateful form ─────────────────────────────────────────────────────────────
// Split out so the loaded prefs seed a single useState that we mutate
// optimistically. Each saver does: optimistic set → PATCH → revert + toast on
// failure → flash the relevant SavedTick on success.
function NotificationsForm({ initial }: { initial: PrefsState }) {
  const [prefs, setPrefs] = useState<PrefsState>(initial);

  // Per-control "Saved ✓" affordances. One tick per category card (it sits in
  // the card header) plus one for the quiet-hours card.
  const studyTick = useSavedConfirm();
  const socialTick = useSavedConfirm();
  const rewardsTick = useSavedConfirm();
  const productTick = useSavedConfirm();
  const quietTick = useSavedConfirm();

  const tickFor = (title: string) => {
    switch (title) {
      case "Study":
        return studyTick;
      case "Social":
        return socialTick;
      case "Rewards":
        return rewardsTick;
      default:
        return productTick;
    }
  };

  // Toggle one channel of one notification. Optimistic, then PATCH the single
  // changed key under the right sub-object (the route merges partials).
  const toggleChannel = useCallback(
    async (
      key: NotifKey,
      channel: Channel,
      next: boolean,
      flash: () => void,
    ) => {
      const prev = prefs;
      const optimistic: PrefsState =
        channel === "in_app"
          ? {
              ...prefs,
              notifications: { ...prefs.notifications, [key]: next },
            }
          : {
              ...prefs,
              notifications_email: {
                ...prefs.notifications_email,
                [key]: next,
              },
            };
      setPrefs(optimistic);

      const payload =
        channel === "in_app"
          ? { notifications: { [key]: next } }
          : { notifications_email: { [key]: next } };

      const res = await apiPatch("/api/user/preferences", payload);
      if (!res.ok) {
        setPrefs(prev);
        toastError("Couldn't save that change. Try again.");
        return;
      }
      flash();
    },
    [prefs],
  );

  // Quiet-hours master enable.
  const toggleQuietEnabled = useCallback(
    async (next: boolean) => {
      const prev = prefs;
      setPrefs({ ...prefs, quiet_hours_enabled: next });
      const res = await apiPatch("/api/user/preferences", {
        quiet_hours_enabled: next,
      });
      if (!res.ok) {
        setPrefs(prev);
        toastError("Couldn't save that change. Try again.");
        return;
      }
      quietTick.flash();
    },
    [prefs, quietTick],
  );

  // Quiet-hours time bound (from/to). The native input emits "HH:MM".
  const setQuietTime = useCallback(
    async (which: "start" | "end", value: string) => {
      const field =
        which === "start" ? "quiet_hours_start" : "quiet_hours_end";
      const prev = prefs;
      setPrefs({ ...prefs, [field]: value });
      const res = await apiPatch("/api/user/preferences", {
        [field]: value,
      });
      if (!res.ok) {
        setPrefs(prev);
        toastError("Couldn't save that time. Try again.");
        return;
      }
      quietTick.flash();
    },
    [prefs, quietTick],
  );

  const quietOff = !prefs.quiet_hours_enabled;

  return (
    <div>
      {CATEGORIES.map((cat) => {
        const tick = tickFor(cat.title);
        return (
          <SettingsCard
            key={cat.title}
            eyebrow={cat.eyebrow}
            title={cat.title}
          >
            {/* Saved confirmation, right-aligned beneath the card header. */}
            <div className="flex items-center justify-end h-3 -mt-2 mb-1">
              <SavedTick show={tick.saved} />
            </div>

            <div className="divide-y divide-white/[0.06]">
              {cat.items.map((item) => {
                const inApp = prefs.notifications[item.key] ?? false;
                const email = prefs.notifications_email[item.key] ?? false;
                return (
                  <SettingRow key={item.key} label={item.label}>
                    <div className="flex items-center gap-5">
                      <Checkbox
                        checked={inApp}
                        onChange={(v) =>
                          void toggleChannel(item.key, "in_app", v, tick.flash)
                        }
                        label="In-app"
                        ariaLabel={`${item.label} in-app notification`}
                      />
                      <Checkbox
                        checked={email}
                        onChange={(v) =>
                          void toggleChannel(item.key, "email", v, tick.flash)
                        }
                        label="Email"
                        ariaLabel={`${item.label} email notification`}
                      />
                    </div>
                  </SettingRow>
                );
              })}
            </div>
          </SettingsCard>
        );
      })}

      {/* ── Quiet Hours ──────────────────────────────────────────────────── */}
      <SettingsCard eyebrow="Do not disturb" title="Quiet hours">
        <SettingRow
          label="Enable quiet hours"
          description="When on, in-app toasts are silenced during this window. Emails still send if enabled."
        >
          <div className="flex items-center gap-2">
            <SavedTick show={quietTick.saved} />
            <Toggle
              checked={prefs.quiet_hours_enabled}
              onChange={(v) => void toggleQuietEnabled(v)}
              label="Enable quiet hours"
            />
          </div>
        </SettingRow>

        <div
          className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 pt-2 transition-opacity duration-200 transform-gpu ${
            quietOff ? "opacity-40" : "opacity-100"
          }`}
        >
          <label className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45 w-10">
              From
            </span>
            <input
              type="time"
              value={prefs.quiet_hours_start}
              disabled={quietOff}
              onChange={(e) => void setQuietTime("start", e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 disabled:cursor-not-allowed [color-scheme:dark]"
              aria-label="Quiet hours start time"
            />
          </label>
          <label className="flex items-center gap-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45 w-10">
              To
            </span>
            <input
              type="time"
              value={prefs.quiet_hours_end}
              disabled={quietOff}
              onChange={(e) => void setQuietTime("end", e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-cream focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 disabled:cursor-not-allowed [color-scheme:dark]"
              aria-label="Quiet hours end time"
            />
          </label>
        </div>
      </SettingsCard>
    </div>
  );
}
