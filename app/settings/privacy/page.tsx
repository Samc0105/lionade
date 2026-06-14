"use client";

/**
 * /settings/privacy — Privacy section of the route-based settings overhaul.
 *
 * Renders INSIDE app/settings/layout.tsx, which already provides
 * ProtectedRoute + Navbar + SpaceBackground + the section nav rail. This page
 * is content-only.
 *
 * State sources (one snapshot per mount):
 *   - GET /api/user/preferences → { privacy, profile_visibility, ... }
 *     - privacy.* sub-flags live in profiles.preferences JSONB
 *     - profile_visibility is the dedicated top-level enforcement column
 *
 * Every control saves IMMEDIATELY on change — no Save button. The pattern is
 * optimistic-update + flash a "Saved ✓" tick for 2s next to the control; on a
 * failed PATCH we revert local state and surface a toast.
 *
 * PATCH routing:
 *   - Profile visibility       → PATCH /api/user/profile-visibility { visibility }
 *   - Everything else (privacy.*) → PATCH /api/user/preferences { privacy: { … } }
 *
 * duel_from outcome: the preferences route's sanitizePrivacy only accepts
 * "everyone" | "nobody" for duel_from (matches the PrivacyPrefs type in
 * lib/db.ts), so a "friends" value would be silently dropped server-side.
 * Rather than show a control that lies about what it persists, we collapse the
 * duel-challenge control to a 2-option (Everyone / Nobody). The friend-request
 * control is likewise everyone|nobody per the same contract.
 *
 * Motion: all GPU-only (opacity/transform via the shared primitives), reduced
 * motion safe via the globals.css blanket rule. No em-dashes in copy.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import {
  SettingsCard,
  SettingRow,
  Toggle,
  Segmented,
  useSavedConfirm,
  SavedTick,
} from "@/components/settings/shared";
import { apiGet, apiPatch } from "@/lib/api-client";
import { toastError } from "@/lib/toast";
import type { PrivacyPrefs, ProfileVisibility } from "@/lib/db";

// ── Server snapshot shape (subset of GET /api/user/preferences) ──────────────
interface PreferencesResponse {
  privacy: PrivacyPrefs;
  profile_visibility: ProfileVisibility;
}

// Local mirror of just the fields this page owns. Booleans + the two enums we
// actually edit. null = not yet loaded (no flash-of-default).
interface PrivacyState {
  profile_visibility: ProfileVisibility;
  duel_from: PrivacyPrefs["duel_from"];
  friend_request_from: PrivacyPrefs["friend_request_from"];
  show_on_leaderboard: boolean;
  show_activity_feed: boolean;
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PrivacySettingsPage() {
  const [state, setState] = useState<PrivacyState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadKey, setLoadKey] = useState(0); // bump to retry

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setState(null);
    (async () => {
      const res = await apiGet<PreferencesResponse>("/api/user/preferences");
      if (cancelled) return;
      if (!res.ok || !res.data) {
        setLoadError(true);
        return;
      }
      const { privacy, profile_visibility } = res.data;
      setState({
        profile_visibility: profile_visibility ?? "public",
        duel_from: privacy.duel_from,
        friend_request_from: privacy.friend_request_from,
        show_on_leaderboard: privacy.show_on_leaderboard,
        show_activity_feed: privacy.show_activity_feed,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [loadKey]);

  if (loadError) {
    return (
      <ErrorCard
        message="We couldn't load your privacy settings."
        onRetry={() => setLoadKey((k) => k + 1)}
      />
    );
  }

  if (!state) return <PrivacySkeleton />;

  return <PrivacyControls initial={state} />;
}

// ── Controls (only mounted once state is known) ──────────────────────────────
function PrivacyControls({ initial }: { initial: PrivacyState }) {
  const [state, setState] = useState<PrivacyState>(initial);

  // One SavedTick per control so each flashes independently.
  const visibilitySaved = useSavedConfirm();
  const duelSaved = useSavedConfirm();
  const friendReqSaved = useSavedConfirm();
  const leaderboardSaved = useSavedConfirm();
  const activitySaved = useSavedConfirm();

  // ── Profile visibility → PATCH /api/user/profile-visibility ───────────────
  const saveVisibility = useCallback(
    async (next: ProfileVisibility) => {
      const prev = state.profile_visibility;
      if (next === prev) return;
      setState((s) => ({ ...s, profile_visibility: next })); // optimistic
      const res = await apiPatch<{ profile_visibility: string }>(
        "/api/user/profile-visibility",
        { visibility: next },
      );
      if (!res.ok) {
        setState((s) => ({ ...s, profile_visibility: prev })); // revert
        toastError("Couldn't update profile visibility. Try again.");
        return;
      }
      visibilitySaved.flash();
    },
    [state.profile_visibility, visibilitySaved],
  );

  // ── Generic privacy.* patcher → PATCH /api/user/preferences ───────────────
  // Optimistically applies `patch` to local state, PATCHes the privacy blob,
  // and on failure reverts to the captured snapshot.
  const savePrivacy = useCallback(
    async (
      patch: Partial<PrivacyState>,
      payload: Partial<PrivacyPrefs>,
      flash: () => void,
    ) => {
      let prevSnapshot: PrivacyState | null = null;
      setState((s) => {
        prevSnapshot = s;
        return { ...s, ...patch };
      });
      const res = await apiPatch<{ privacy: PrivacyPrefs }>(
        "/api/user/preferences",
        { privacy: payload },
      );
      if (!res.ok) {
        if (prevSnapshot) setState(prevSnapshot); // revert
        toastError("Couldn't save that setting. Try again.");
        return;
      }
      flash();
    },
    [],
  );

  return (
    <div>
      {/* ── Visibility ──────────────────────────────────────────────────── */}
      <SettingsCard eyebrow="Visibility" title="Profile visibility">
        <SettingRow label="Who can see your profile">
          <div className="flex items-center gap-2.5">
            <SavedTick show={visibilitySaved.saved} />
            <Segmented<ProfileVisibility>
              ariaLabel="Profile visibility"
              options={[
                { value: "public", label: "Public" },
                { value: "friends", label: "Friends only" },
                { value: "private", label: "Private" },
              ]}
              value={state.profile_visibility}
              onChange={saveVisibility}
            />
          </div>
        </SettingRow>

        {/* Plain-text explainer of what each level hides. */}
        <div className="mt-2 space-y-2 border-t border-white/[0.06] pt-4">
          <p className="text-cream/55 text-xs leading-relaxed">
            <span className="text-cream/80 font-semibold">Public.</span> Anyone
            can find you in search, see your full profile, and you appear on
            leaderboards.
          </p>
          <p className="text-cream/55 text-xs leading-relaxed">
            <span className="text-cream/80 font-semibold">Friends only.</span>{" "}
            Only friends see your full profile. You stay hidden from search,
            leaderboards, and suggestions.
          </p>
          <p className="text-cream/55 text-xs leading-relaxed">
            <span className="text-cream/80 font-semibold">Private.</span> You are
            hidden from search, leaderboards, and suggestions entirely.
          </p>
        </div>
      </SettingsCard>

      {/* ── Presence & contact ──────────────────────────────────────────── */}
      <SettingsCard eyebrow="Presence & contact" title="Who can reach you">
        <SettingRow label="Who can send duel challenges">
          <div className="flex items-center gap-2.5">
            <SavedTick show={duelSaved.saved} />
            <Segmented<PrivacyPrefs["duel_from"]>
              ariaLabel="Who can send duel challenges"
              options={[
                { value: "everyone", label: "Everyone" },
                { value: "nobody", label: "Nobody" },
              ]}
              value={state.duel_from}
              onChange={(next) =>
                savePrivacy(
                  { duel_from: next },
                  { duel_from: next },
                  duelSaved.flash,
                )
              }
            />
          </div>
        </SettingRow>

        <SettingRow label="Who can send friend requests">
          <div className="flex items-center gap-2.5">
            <SavedTick show={friendReqSaved.saved} />
            <Segmented<PrivacyPrefs["friend_request_from"]>
              ariaLabel="Who can send friend requests"
              options={[
                { value: "everyone", label: "Everyone" },
                { value: "nobody", label: "Nobody" },
              ]}
              value={state.friend_request_from}
              onChange={(next) =>
                savePrivacy(
                  { friend_request_from: next },
                  { friend_request_from: next },
                  friendReqSaved.flash,
                )
              }
            />
          </div>
        </SettingRow>
      </SettingsCard>

      {/* ── Discovery & sharing ─────────────────────────────────────────── */}
      <SettingsCard eyebrow="Discovery & sharing" title="What you share">
        <SettingRow
          label="Appear on leaderboards"
          description="When off, you're removed from all public ladders (Quiz Duel, Competitive, Squad, weekly Fangs)."
        >
          <div className="flex items-center gap-2.5">
            <SavedTick show={leaderboardSaved.saved} />
            <Toggle
              label="Appear on leaderboards"
              checked={state.show_on_leaderboard}
              onChange={(next) =>
                savePrivacy(
                  { show_on_leaderboard: next },
                  { show_on_leaderboard: next },
                  leaderboardSaved.flash,
                )
              }
            />
          </div>
        </SettingRow>

        <SettingRow
          label="Show study activity in friends' feeds"
          description="When off, your quiz completions and badge unlocks don't appear in the social feed."
        >
          <div className="flex items-center gap-2.5">
            <SavedTick show={activitySaved.saved} />
            <Toggle
              label="Show study activity in friends' feeds"
              checked={state.show_activity_feed}
              onChange={(next) =>
                savePrivacy(
                  { show_activity_feed: next },
                  { show_activity_feed: next },
                  activitySaved.flash,
                )
              }
            />
          </div>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────
// Mirrors the card grouping so the layout doesn't jump when real data lands.
function PrivacySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading privacy settings">
      {[1, 2, 2].map((rows, i) => (
        <div
          key={i}
          className="rounded-2xl border border-electric/10 p-6 mb-5 animate-pulse transform-gpu"
          style={{
            background:
              "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))",
          }}
        >
          <div className="h-3 w-24 rounded bg-white/10 mb-2" />
          <div className="h-5 w-40 rounded bg-white/10 mb-5" />
          <div className="space-y-4">
            {Array.from({ length: rows }).map((_, r) => (
              <div
                key={r}
                className="flex items-center justify-between gap-3"
              >
                <div className="h-4 w-48 rounded bg-white/[0.07]" />
                <div className="h-6 w-16 rounded-full bg-white/[0.07]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Error card ────────────────────────────────────────────────────────────────
// Mirrors the academia ErrorCard treatment (red glass + retry pill).
function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
      <p className="font-syne text-sm text-red-300 mb-3">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors transform-gpu"
      >
        <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
