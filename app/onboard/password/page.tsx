"use client";

/**
 * /onboard/password — forced permanent-password set for team members.
 *
 * When support provisions a staff account (or resets one), the auth user is
 * created with a temporary password and `must_change_password` is armed on
 * both the team_members row and user_metadata. TeamGate reads user_metadata
 * synchronously (zero network) and routes the member here before they can
 * reach any other surface.
 *
 * Flow:
 *   1. validate strength + confirm match
 *   2. supabase.auth.updateUser({ password }) sets the permanent password
 *   3. POST /api/team/me/clear-password-flag clears the column + metadata flag
 *      for the CALLER's own account (idempotent, no id on the wire)
 *   4. supabase.auth.refreshSession() so the in-memory session carries the
 *      cleared user_metadata.must_change_password — otherwise TeamGate would
 *      re-trigger off the stale session on the next navigation
 *   5. redirect onward (/onboard/mfa if MFA is still required, else /dashboard)
 *
 * No secrets are ever logged. Error bodies are generic.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { apiPost } from "@/lib/api-client";
import { cdnUrl } from "@/lib/cdn";
import { Check, X as XIcon, Warning, ShieldCheck } from "@phosphor-icons/react";

const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";
const GOLD_BG =
  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)";

const inputCls =
  "w-full bg-white/5 border border-electric/20 rounded-xl px-4 py-3.5 text-cream placeholder-cream/25 text-sm font-medium focus:outline-none focus:border-electric focus:bg-electric/5 transition-all";
const labelCls =
  "block text-cream/60 text-xs font-bold uppercase tracking-widest mb-2";

export default function OnboardPasswordPage() {
  const router = useRouter();
  const { user, session } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Force dark mode — this is an auth-adjacent surface and should always read
  // on the brand-dark background regardless of the saved theme.
  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.dataset.theme = "dark";
  }, []);

  const checks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*]/.test(password),
  };
  const strong = Object.values(checks).every(Boolean);
  const match = confirm === "" || password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");

    if (!strong) {
      setError("Password does not meet all requirements");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setBusy(true);

    // 1) Set the permanent password.
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setBusy(false);
      setError(
        updateErr.message?.includes("different from the old")
          ? "Choose a password different from your temporary one"
          : "Could not update your password. Try again.",
      );
      return;
    }

    // 2) Clear the forced-change flag on the caller's own account (column +
    //    metadata). Idempotent; acts only on auth.userId server-side.
    const { ok } = await apiPost("/api/team/me/clear-password-flag", {});
    if (!ok) {
      // The password DID change above. If the flag clear failed, the gate
      // would loop the user back here, so surface a retry rather than
      // proceeding into a redirect loop.
      setBusy(false);
      setError("Saved your password, but could not finish. Try again.");
      return;
    }

    // 3) Refresh the session so the in-memory user_metadata reflects the
    //    cleared flag. Without this the gate re-fires off the stale session.
    try {
      await supabase.auth.refreshSession();
    } catch {
      // Best-effort. The next full page load re-reads storage either way.
    }

    // 4) Onward. If MFA is still required, send them to enrollment next;
    //    otherwise straight to the dashboard. TeamGate also enforces this,
    //    but routing directly avoids an extra gate bounce.
    const mfaRequired = session?.user?.user_metadata?.mfa_required === true;
    router.replace(mfaRequired ? "/onboard/mfa" : "/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden py-8">
      {/* Brand background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(74,144,217,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.08) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        className="absolute top-1/4 left-1/3 w-80 h-80 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{ background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)" }}
      />

      <div className="relative z-10 w-full max-w-md animate-slide-up motion-reduce:animate-none">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <img src={cdnUrl("/logo-full.png")} alt="Lionade" className="w-10 h-10 object-contain" />
            <span className="font-bebas text-3xl tracking-wider text-cream group-hover:text-electric transition-colors">
              LIONADE
            </span>
          </Link>
        </div>

        <div
          className="rounded-2xl border border-electric/20 p-8"
          style={{ background: CARD_BG }}
        >
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck size={28} weight="fill" className="text-gold" aria-hidden="true" />
            <h1 className="font-bebas text-3xl tracking-wider text-cream">
              Set your password
            </h1>
          </div>
          <p className="text-cream/60 text-sm leading-relaxed mb-6">
            Your account was set up with a temporary password. Choose a
            permanent one to continue. This keeps your staff access secure.
          </p>

          <form onSubmit={submit}>
            <label className={labelCls}>New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
              autoFocus
              className={inputCls}
            />
            {password.length > 0 && (
              <div className="mt-2.5 space-y-1.5 px-1">
                <PwCheck ok={checks.length} label="At least 8 characters" />
                <PwCheck ok={checks.upper} label="One uppercase letter" />
                <PwCheck ok={checks.lower} label="One lowercase letter" />
                <PwCheck ok={checks.number} label="One number" />
                <PwCheck ok={checks.special} label="One special character (!@#$%^&*)" />
              </div>
            )}

            <label className={`${labelCls} mt-5`}>Confirm new password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              className={inputCls}
            />
            {confirm.length > 0 && !match && (
              <p className="text-red-400 text-xs font-semibold mt-1.5">
                Passwords do not match
              </p>
            )}
            {confirm.length > 0 && match && password.length > 0 && (
              <p className="text-green-400 text-xs font-semibold mt-1.5 inline-flex items-center">
                <Check size={14} className="mr-1.5" aria-hidden="true" />
                Passwords match
              </p>
            )}

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/10 border border-red-400/30 mt-5">
                <Warning size={16} weight="fill" color="#EF4444" className="flex-shrink-0" aria-hidden="true" />
                <p className="text-red-400 text-sm font-semibold">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !strong || password !== confirm}
              className="w-full py-4 rounded-xl font-bold text-base mt-6 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
              style={{ background: GOLD_BG, color: "#04080F" }}
            >
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none" />
                  Saving...
                </span>
              ) : (
                "Set password and continue"
              )}
            </button>
          </form>

          {user?.email && (
            <p className="text-cream/40 text-xs text-center mt-5">
              Signed in as {user.email}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PwCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs font-medium transition-colors duration-200 ${ok ? "text-green-400" : "text-cream/45"}`}>
      <span className="w-3 flex-shrink-0 inline-flex items-center">
        {ok ? (
          <Check size={14} weight="bold" aria-hidden="true" />
        ) : (
          <XIcon size={14} weight="bold" aria-hidden="true" />
        )}
      </span>
      <span>{label}</span>
    </div>
  );
}
