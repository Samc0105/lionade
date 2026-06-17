"use client";

/**
 * /settings/account — the Account section of the route-based settings overhaul.
 *
 * Renders inside the settings layout (which already supplies ProtectedRoute +
 * Navbar + SpaceBackground + the section nav rail), so this page is just the
 * stack of SettingsCards.
 *
 * Six controls, each its own card:
 *   1. Change username  — once-a-year lock; reads last change from
 *                         username_changes (RLS owner-read) to compute the
 *                         unlock date; POST /api/change-username to save.
 *   2. Change password  — supabase.auth.updateUser({ password }).
 *   3. Change email     — supabase.auth.updateUser({ email }) (sends a
 *                         confirmation to the NEW address; swap happens on
 *                         click). Re-auths against the current password first.
 *   4. Connected accts  — Google + Apple identity pills via
 *                         supabase.auth.getUserIdentities(); link / unlink with
 *                         a "keep at least one login method" disconnect guard.
 *   5. Active sessions  — GET /api/user/sessions (frozen shape); "Sign out all
 *                         other sessions" via supabase.auth.signOut({ scope:
 *                         'others' }).
 *   6. Avatar           — DiceBear seed input + background-colour swatches with
 *                         a live preview; saves to profiles.avatar_url + auth
 *                         metadata (the same path the profile page uses).
 *
 * Motion is GPU-only (opacity / transform) and collapses under
 * prefers-reduced-motion via globals.css. No em-dashes in user-facing copy.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import useSWR from "swr";
import {
  At,
  Check,
  DiceFive,
  GoogleLogo,
  AppleLogo,
  LockKey,
  Monitor,
  SignOut,
  Spinner,
  User as UserIcon,
} from "@phosphor-icons/react";
import { SettingsCard, SettingRow, useSavedConfirm, SavedTick } from "@/components/settings/shared";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiPost, apiGet } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";

// ── small shared bits ─────────────────────────────────────────────────────

const inputClass =
  "w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-cream text-sm placeholder:text-cream/40 focus:outline-none focus:border-electric/50 focus:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-electric/40 transition-colors";

const labelClass =
  "block text-cream/60 text-[10px] font-mono uppercase tracking-[0.18em] mb-1.5";

function PrimaryButton({
  children,
  disabled,
  busy,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className="btn-gold inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity transform-gpu"
    >
      {busy && (
        <Spinner size={15} weight="bold" className="animate-spin" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

function FieldError({ message, id }: { message: string | null; id?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-red-300 text-xs mt-2 leading-snug">
      {message}
    </p>
  );
}

// ── 1. Change username ──────────────────────────────────────────────────────
//
// Usernames change once per 365 days. The server is the source of truth
// (POST /api/change-username enforces it), but we also read the last change
// from username_changes here (RLS owner-read) so we can LOCK the input and
// show the unlock date before the user wastes a submit.
function UsernameCard() {
  const { user, refreshUser } = useAuth();
  const { saved, flash } = useSavedConfirm();

  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // null = still loading; undefined-ish handled as "no record / unlocked".
  const [lockedUntil, setLockedUntil] = useState<Date | null | "loading">("loading");

  const loadLock = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from("username_changes")
      .select("changed_at")
      .eq("user_id", user.id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.changed_at) {
      setLockedUntil(null);
      return;
    }
    const unlock = new Date(new Date(data.changed_at).getTime() + 365 * 24 * 60 * 60 * 1000);
    setLockedUntil(unlock.getTime() > Date.now() ? unlock : null);
  }, [user?.id]);

  useEffect(() => {
    void loadLock();
  }, [loadLock]);

  const isLocked = lockedUntil instanceof Date;
  const loadingLock = lockedUntil === "loading";

  const unlockLabel = useMemo(() => {
    if (!(lockedUntil instanceof Date)) return null;
    return lockedUntil.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [lockedUntil]);

  const clean = next.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const canSubmit =
    !isLocked &&
    !loadingLock &&
    !busy &&
    clean.length >= 3 &&
    clean.length <= 20 &&
    clean !== user?.username;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    const res = await apiPost<{ success: boolean; username: string }>(
      "/api/change-username",
      { newUsername: clean },
    );
    if (!res.ok) {
      // The 403 once-a-year rejection arrives as a friendly message in error.
      setErr(res.error || "Couldn't change your username. Try again.");
      setBusy(false);
      // Re-read the lock in case the server now considers us locked.
      void loadLock();
      return;
    }
    flash();
    toastSuccess("Username updated.");
    setNext("");
    await refreshUser();
    void loadLock();
    setBusy(false);
  }, [canSubmit, clean, flash, loadLock, refreshUser]);

  return (
    <SettingsCard eyebrow="Identity" title="Username">
      <SettingRow label="Current username" description="How you appear across Lionade">
        <span className="font-mono text-sm text-cream/80">@{user?.username ?? "..."}</span>
      </SettingRow>

      <div className="pt-2">
        <label htmlFor="acct-new-username" className={labelClass}>
          New username
        </label>

        {isLocked ? (
          <div
            className="flex items-start gap-3 rounded-lg bg-white/[0.03] border border-white/[0.08] px-3.5 py-3"
            role="status"
          >
            <LockKey size={18} weight="fill" className="text-gold/80 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-cream/80 text-sm font-semibold leading-tight">
                Username changes are locked
              </p>
              <p className="text-cream/60 text-xs mt-1 leading-snug">
                You can change your username once a year. Next change available on {unlockLabel}.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <UserIcon
                  size={16}
                  weight="regular"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/35 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="acct-new-username"
                  type="text"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  placeholder="newhandle"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={busy || loadingLock}
                  maxLength={20}
                  className={`${inputClass} pl-9`}
                  aria-invalid={!!err}
                  aria-describedby={
                    err ? "acct-username-hint acct-username-error" : "acct-username-hint"
                  }
                />
              </div>
              <PrimaryButton busy={busy} disabled={!canSubmit} onClick={submit}>
                Save
              </PrimaryButton>
            </div>
            <div className="flex items-center justify-between mt-2 gap-3">
              <p id="acct-username-hint" className="text-cream/55 text-xs leading-snug">
                3 to 20 characters. Letters, numbers, and underscores. You can change it once a year.
              </p>
              <SavedTick show={saved} />
            </div>
          </>
        )}

        <FieldError message={err} id="acct-username-error" />
      </div>
    </SettingsCard>
  );
}

// ── 2. Change password ──────────────────────────────────────────────────────
//
// supabase.auth.updateUser({ password }). Supabase requires a recent session;
// we re-auth against the current password first so a stale session surfaces a
// clean "current password didn't match" rather than a raw AAL error.
function PasswordCard() {
  const { user } = useAuth();
  const { saved, flash } = useSavedConfirm();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    !busy &&
    current.length > 0 &&
    next.length >= 8 &&
    next === confirm;

  const submit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSubmit) return;
      setBusy(true);
      setErr(null);

      // Re-auth: confirms the current password and refreshes the session so
      // updateUser has the recent AAL Supabase wants for a password change.
      const reauth = await supabase.auth.signInWithPassword({
        email: user?.email ?? "",
        password: current,
      });
      if (reauth.error) {
        setErr("Current password didn't match.");
        setBusy(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        setErr(
          /reauth|recent|aal/i.test(error.message)
            ? "For security, sign in again and then change your password."
            : error.message || "Couldn't update your password.",
        );
        setBusy(false);
        return;
      }

      flash();
      toastSuccess("Password updated.");
      setCurrent("");
      setNext("");
      setConfirm("");
      setBusy(false);
    },
    [canSubmit, current, next, user?.email, flash],
  );

  return (
    <SettingsCard eyebrow="Security" title="Password">
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <label htmlFor="acct-current-pw" className={labelClass}>
            Current password
          </label>
          <input
            id="acct-current-pw"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            className={inputClass}
            aria-invalid={!!err}
            aria-describedby={err ? "acct-pw-error" : undefined}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="acct-new-pw" className={labelClass}>
              New password
            </label>
            <input
              id="acct-new-pw"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
              className={inputClass}
              aria-invalid={tooShort}
              aria-describedby={`acct-pw-hint${tooShort ? " acct-pw-tooshort-error" : ""}`}
            />
          </div>
          <div>
            <label htmlFor="acct-confirm-pw" className={labelClass}>
              Confirm new password
            </label>
            <input
              id="acct-confirm-pw"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
              className={inputClass}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "acct-pw-mismatch-error" : undefined}
            />
          </div>
        </div>

        <p id="acct-pw-hint" className="text-cream/55 text-xs leading-snug">
          Use at least 8 characters.
        </p>

        {tooShort && (
          <FieldError
            id="acct-pw-tooshort-error"
            message="New password must be at least 8 characters."
          />
        )}
        {mismatch && (
          <FieldError id="acct-pw-mismatch-error" message="Passwords don't match." />
        )}
        <FieldError id="acct-pw-error" message={err} />

        <div className="flex items-center justify-between gap-3 pt-1">
          <SavedTick show={saved} />
          <PrimaryButton type="submit" busy={busy} disabled={!canSubmit}>
            Update password
          </PrimaryButton>
        </div>
      </form>
    </SettingsCard>
  );
}

// ── 3. Change email ──────────────────────────────────────────────────────────
//
// supabase.auth.updateUser({ email }) sends a confirmation link to the NEW
// address; auth.user.email only swaps once that link is clicked. We re-auth
// against the current password first (harvested from the legacy
// ChangeEmailModal) so a stale session fails cleanly.
function EmailCard() {
  const { user } = useAuth();

  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trimmed = newEmail.trim().toLowerCase();
  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const sameAsCurrent = trimmed === (user?.email ?? "").trim().toLowerCase();
  const canSubmit =
    !busy && emailLooksValid && !sameAsCurrent && password.length > 0;

  const submit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSubmit) return;
      setBusy(true);
      setErr(null);
      setSent(false);

      const reauth = await supabase.auth.signInWithPassword({
        email: user?.email ?? "",
        password,
      });
      if (reauth.error) {
        setErr("Current password didn't match.");
        setBusy(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) {
        setErr(error.message || "Couldn't request the email change.");
        setBusy(false);
        return;
      }

      setSent(true);
      toastSuccess("Confirmation email sent. Check your new inbox to confirm.");
      setNewEmail("");
      setPassword("");
      setBusy(false);
    },
    [canSubmit, trimmed, password, user?.email],
  );

  return (
    <SettingsCard eyebrow="Identity" title="Email address">
      <SettingRow label="Current email" description="Where account notices are sent">
        <span className="font-mono text-sm text-cream/80 truncate max-w-[220px] inline-block align-bottom">
          {user?.email ?? "..."}
        </span>
      </SettingRow>

      <form onSubmit={submit} className="space-y-3.5 pt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="acct-new-email" className={labelClass}>
              New email
            </label>
            <div className="relative">
              <At
                size={16}
                weight="regular"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/35 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="acct-new-email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={busy}
                className={`${inputClass} pl-9`}
                aria-invalid={!!err}
                aria-describedby={err ? "acct-email-error" : undefined}
              />
            </div>
          </div>
          <div>
            <label htmlFor="acct-email-pw" className={labelClass}>
              Current password
            </label>
            <input
              id="acct-email-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={busy}
              className={inputClass}
              aria-invalid={!!err}
              aria-describedby={err ? "acct-email-error" : undefined}
            />
          </div>
        </div>

        {sent && (
          <p
            role="status"
            className="flex items-center gap-2 text-green-300 text-xs leading-snug"
          >
            <Check size={14} weight="bold" aria-hidden="true" />
            Check your new email to confirm the change. It takes effect once you click the link.
          </p>
        )}

        <FieldError message={err} id="acct-email-error" />

        <div className="flex justify-end pt-1">
          <PrimaryButton type="submit" busy={busy} disabled={!canSubmit}>
            Change email
          </PrimaryButton>
        </div>
      </form>
    </SettingsCard>
  );
}

// ── 4. Connected accounts ─────────────────────────────────────────────────────
//
// supabase.auth.getUserIdentities() lists linked OAuth providers + the
// email/password identity. We render Google + Apple pills, link / unlink each.
//
// Disconnect guard: a user must always retain at least one way to log in. We
// only allow unlinking a provider when ANOTHER login method exists. A login
// method is either:
//   - another linked identity (identities.length > 1), OR
//   - an email/password credential. Supabase models email+password as an
//     identity with provider === "email", so if that identity is present the
//     user can still sign in with their password after unlinking an OAuth one.
// In practice the guard is: unlinking is allowed only if there is more than one
// identity. If a provider is the SOLE identity, its Disconnect is disabled with
// a "You need at least one login method" tooltip.
interface IdentityLite {
  identity_id: string;
  id: string;
  user_id: string;
  provider: string;
}

const OAUTH_PROVIDERS = [
  { id: "google" as const, label: "Google", Icon: GoogleLogo },
  { id: "apple" as const, label: "Apple", Icon: AppleLogo },
];

function ConnectedAccountsCard() {
  const [identities, setIdentities] = useState<IdentityLite[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // provider id mid-op

  const load = useCallback(async () => {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error) {
      setLoadErr("Couldn't load your connected accounts.");
      setIdentities([]);
      return;
    }
    setLoadErr(null);
    setIdentities((data?.identities ?? []) as IdentityLite[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalIdentities = identities?.length ?? 0;
  // At least one login method must remain. Unlinking is only safe when more
  // than one identity exists (email/password counts as a provider === "email"
  // identity, so this covers the "OAuth + password" case too).
  const canUnlinkAny = totalIdentities > 1;

  const connect = useCallback(
    async (provider: "google" | "apple") => {
      setPending(provider);
      const redirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/settings/account` : undefined;
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: redirectTo ? { redirectTo } : undefined,
      });
      // linkIdentity redirects the browser to the provider on success, so we
      // only reach here on an immediate failure.
      if (error) {
        toastError(error.message || `Couldn't connect ${provider}.`);
        setPending(null);
      }
    },
    [],
  );

  const disconnect = useCallback(
    async (identity: IdentityLite) => {
      if (!canUnlinkAny) return;
      setPending(identity.provider);
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) {
        toastError(error.message || "Couldn't disconnect that account.");
      } else {
        toastSuccess(
          `${identity.provider.charAt(0).toUpperCase() + identity.provider.slice(1)} disconnected.`,
        );
        await load();
      }
      setPending(null);
    },
    [canUnlinkAny, load],
  );

  return (
    <SettingsCard eyebrow="Sign-in" title="Connected accounts">
      {identities === null ? (
        <div className="flex items-center gap-2 text-cream/60 text-sm py-3">
          <Spinner size={15} weight="bold" className="animate-spin" aria-hidden="true" />
          Loading connected accounts...
        </div>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {OAUTH_PROVIDERS.map(({ id, label, Icon }) => {
            const linked = identities.find((i) => i.provider === id);
            const busy = pending === id;
            // Disconnect is disabled if it would leave zero login methods.
            const guardBlocks = !!linked && !canUnlinkAny;

            return (
              <SettingRow
                key={id}
                label={label}
                description={linked ? "Connected to your account" : `Sign in with ${label}`}
              >
                <div className="flex items-center gap-2">
                  {linked ? (
                    <>
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.16em] text-green-300">
                        <Check size={12} weight="bold" aria-hidden="true" />
                        Connected
                      </span>
                      <button
                        type="button"
                        onClick={() => disconnect(linked)}
                        disabled={busy || guardBlocks}
                        title={
                          guardBlocks ? "You need at least one login method." : undefined
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors transform-gpu disabled:opacity-40 disabled:cursor-not-allowed border-white/[0.1] bg-white/[0.03] text-cream/80 hover:text-cream hover:bg-white/[0.07] focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40"
                      >
                        {busy && (
                          <Spinner size={13} weight="bold" className="animate-spin" aria-hidden="true" />
                        )}
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connect(id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-electric text-navy hover:opacity-90 transition-opacity transform-gpu disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/50 focus-visible:ring-offset-1 focus-visible:ring-offset-navy"
                    >
                      {busy ? (
                        <Spinner size={13} weight="bold" className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Icon size={14} weight="bold" aria-hidden="true" />
                      )}
                      Connect
                    </button>
                  )}
                </div>
              </SettingRow>
            );
          })}
        </div>
      )}

      <FieldError message={loadErr} />
    </SettingsCard>
  );
}

// ── 5. Active sessions ────────────────────────────────────────────────────────
//
// GET /api/user/sessions returns the FROZEN shape:
//   { ok, sessions: [{ id, device, browser, created_at }] }  (last 10)
// We show up to 5 here. "Sign out all other sessions" is a pure client call:
// supabase.auth.signOut({ scope: 'others' }) revokes every refresh token
// except the current device's.
//
// The route is being built by a parallel agent; until it lands, apiGet returns
// ok:false and we render an empty state rather than crashing.
interface SessionRow {
  id: string;
  device: string;
  browser: string;
  created_at: string;
}

function ActiveSessionsCard() {
  const { data, isLoading, mutate } = useSWR(
    "/api/user/sessions",
    () => apiGet<{ sessions: SessionRow[] }>("/api/user/sessions"),
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  const [signingOut, setSigningOut] = useState(false);

  const sessions =
    data?.ok && data.data?.sessions ? data.data.sessions.slice(0, 5) : [];

  const signOutOthers = useCallback(async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      toastError("Couldn't sign out other sessions. Try again.");
    } else {
      toastSuccess("Signed out everywhere else.");
      void mutate();
    }
    setSigningOut(false);
  }, [mutate]);

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <SettingsCard eyebrow="Devices" title="Active sessions">
      {isLoading && sessions.length === 0 ? (
        <div className="flex items-center gap-2 text-cream/60 text-sm py-3">
          <Spinner size={15} weight="bold" className="animate-spin" aria-hidden="true" />
          Loading sessions...
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-cream/60 text-sm py-3 leading-snug">
          No other active sessions. You're only signed in on this device.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06] mb-1">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <span
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.04] border border-white/[0.08] shrink-0"
                aria-hidden="true"
              >
                <Monitor size={16} weight="regular" className="text-cream/60" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-cream text-sm font-semibold leading-tight truncate">
                  {s.device || "Unknown device"}
                </p>
                <p className="text-cream/60 text-xs mt-0.5 leading-snug truncate">
                  {[s.browser, fmtDate(s.created_at)].filter(Boolean).join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end pt-3 border-t border-white/[0.06] mt-1">
        <button
          type="button"
          onClick={signOutOthers}
          disabled={signingOut}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-red-100 bg-red-500/15 border border-red-400/30 hover:bg-red-500/25 hover:border-red-400/50 transition-colors transform-gpu disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:ring-offset-1 focus-visible:ring-offset-navy"
        >
          {signingOut ? (
            <Spinner size={13} weight="bold" className="animate-spin" aria-hidden="true" />
          ) : (
            <SignOut size={14} weight="bold" aria-hidden="true" />
          )}
          Sign out all other sessions
        </button>
      </div>
    </SettingsCard>
  );
}

// ── 6. Avatar ─────────────────────────────────────────────────────────────────
//
// DiceBear seed input + background-colour swatches with a LIVE preview. We
// reuse the same DiceBear URL shape + save path as the profile page:
//   profiles.avatar_url update -> auth metadata update -> refreshUser().
const DICEBEAR_STYLE = "avataaars"; // matches the lib/auth.tsx default style
const AVATAR_BG_SWATCHES = [
  { value: "4A90D9", label: "Electric" },
  { value: "A855F7", label: "Purple" },
  { value: "FFD700", label: "Gold" },
  { value: "22C55E", label: "Green" },
  { value: "FB923C", label: "Orange" },
  { value: "0D1528", label: "Navy" },
];

function buildAvatarUrl(seed: string, bg: string) {
  return `https://api.dicebear.com/7.x/${DICEBEAR_STYLE}/svg?seed=${encodeURIComponent(
    seed,
  )}&backgroundColor=${bg}`;
}

function randomSeed() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const len = 5 + Math.floor(Math.random() * 5);
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join(
    "",
  );
}

function AvatarCard() {
  const { user, refreshUser } = useAuth();
  const { saved, flash } = useSavedConfirm();

  const [seed, setSeed] = useState(() => user?.username ?? "user");
  const [bg, setBg] = useState(AVATAR_BG_SWATCHES[0].value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cleanSeed = seed.trim() || "user";
  const previewUrl = useMemo(() => buildAvatarUrl(cleanSeed, bg), [cleanSeed, bg]);

  const hasChange = previewUrl !== user?.avatar;

  const save = useCallback(async () => {
    if (!user?.id || !hasChange || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: previewUrl })
      .eq("id", user.id);
    if (error) {
      setErr(error.message || "Couldn't save your avatar.");
      setBusy(false);
      return;
    }
    await supabase.auth.updateUser({ data: { avatar_url: previewUrl } });
    await refreshUser();
    flash();
    toastSuccess("Avatar updated.");
    setBusy(false);
  }, [user?.id, hasChange, busy, previewUrl, refreshUser, flash]);

  return (
    <SettingsCard eyebrow="Appearance" title="Avatar">
      <div className="flex flex-col sm:flex-row gap-5">
        {/* Live preview */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <div
            className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-electric/40"
            style={{ boxShadow: "0 0 18px rgba(74,144,217,0.18)" }}
          >
            <img
              src={previewUrl}
              alt="Avatar preview"
              className="w-full h-full object-cover"
            />
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/55">
            {hasChange ? "Preview" : "Current"}
          </span>
        </div>

        {/* Controls */}
        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <label htmlFor="acct-avatar-seed" className={labelClass}>
              Seed
            </label>
            <div className="flex gap-2.5">
              <input
                id="acct-avatar-seed"
                type="text"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="Anything you like"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                maxLength={32}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setSeed(randomSeed())}
                disabled={busy}
                aria-label="Randomize seed"
                className="inline-flex items-center justify-center px-3 rounded-lg border border-white/[0.1] bg-white/[0.04] text-cream/80 hover:text-cream hover:bg-white/[0.08] transition-colors transform-gpu disabled:opacity-50 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40"
              >
                <DiceFive size={18} weight="regular" aria-hidden="true" />
              </button>
            </div>
            <p className="text-cream/55 text-xs mt-1.5 leading-snug">
              Same seed always makes the same face. Change it for a new look.
            </p>
          </div>

          <div>
            <span className={labelClass}>Background</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar background colour">
              {AVATAR_BG_SWATCHES.map((sw) => {
                const active = sw.value === bg;
                return (
                  <button
                    key={sw.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={sw.label}
                    onClick={() => setBg(sw.value)}
                    disabled={busy}
                    className={`w-8 h-8 rounded-full transition-transform transform-gpu focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/50 disabled:opacity-50 ${
                      active ? "ring-2 ring-offset-2 ring-offset-navy ring-cream/80 scale-105" : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: `#${sw.value}` }}
                  />
                );
              })}
            </div>
          </div>

          <FieldError message={err} />

          <div className="flex items-center justify-between gap-3">
            <SavedTick show={saved} />
            <PrimaryButton busy={busy} disabled={!hasChange} onClick={save}>
              Save avatar
            </PrimaryButton>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AccountSettingsPage() {
  return (
    <div>
      <UsernameCard />
      <EmailCard />
      <PasswordCard />
      <ConnectedAccountsCard />
      <ActiveSessionsCard />
      <AvatarCard />
    </div>
  );
}
