"use client";

/**
 * /reset-password — landing page for Supabase password-recovery links.
 *
 * The emailed link (sent by support via the Admin Console, or any future
 * self-serve forgot-password flow) redirects here. The Supabase client's
 * detectSessionInUrl consumes the recovery token from the URL hash and
 * establishes a session; once that session exists we show the new-password
 * form and call auth.updateUser({ password }).
 *
 * If no session materializes within a few seconds the link is invalid,
 * already used, or expired — we say so and point at /login.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api-client";
import { toastSuccess, toastError } from "@/lib/toast";

const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";

type Phase = "waiting" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // PASSWORD_RECOVERY (or SIGNED_IN from the recovery hash) means the
    // token was consumed and we can accept a new password.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: string, session: unknown) => {
        if (cancelled) return;
        if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) {
          setPhase("ready");
        }
      },
    );

    // Fallback: the event may have fired before we subscribed.
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data?.session) setPhase("ready");
    };
    void check();

    // If nothing shows up the link is dead.
    const timer = setTimeout(() => {
      if (!cancelled) {
        setPhase((p) => (p === "waiting" ? "invalid" : p));
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Mirror the forced-onboarding strength policy (/onboard/password) so a
    // team member who arrives via the emailed recovery link cannot set a weaker
    // password than the gate would otherwise require.
    const strongEnough =
      password.length >= 8 &&
      /[a-z]/.test(password) &&
      /[A-Z]/.test(password) &&
      /[0-9]/.test(password) &&
      /[^A-Za-z0-9]/.test(password);
    if (!strongEnough) {
      toastError(
        "Use at least 8 characters with upper and lower case, a number, and a symbol",
      );
      return;
    }
    if (password !== confirm) {
      toastError("Passwords do not match");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      // Generic copy, consistent with the rest of the product (no raw Supabase
      // error text surfaced to the user).
      toastError("Could not update your password. Try again or request a fresh link.");
      return;
    }

    // Best-effort: if a team member used the emailed recovery link to set a
    // new password, clear the forced-change flag (column + metadata) on their
    // own account so TeamGate does not re-prompt them at /onboard/password.
    // Non-team users have no row and the route is idempotently a no-op for
    // them, so we ignore any failure here.
    try {
      await apiPost("/api/team/me/clear-password-flag", {});
    } catch {
      // ignore — non-team users have nothing to clear
    }

    setPhase("done");
    toastSuccess("Password updated");
    setTimeout(() => router.replace("/dashboard"), 1200);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div
        className="w-full max-w-md rounded-2xl border border-white/[0.08] p-8"
        style={{ background: CARD_BG }}
      >
        <h1 className="font-bebas text-3xl tracking-wider text-cream mb-2">
          Reset your password
        </h1>

        {phase === "waiting" && (
          <div className="flex items-center gap-3 text-sm text-cream/60 py-6">
            <span className="w-4 h-4 rounded-full border-2 border-cream/20 border-t-cream/60 animate-spin" aria-hidden="true" />
            Checking your reset link...
          </div>
        )}

        {phase === "invalid" && (
          <div className="py-2">
            <p className="text-sm text-cream/70 mb-5">
              This reset link is invalid or has expired. Ask for a new one, or
              head back to the login page.
            </p>
            <Link
              href="/login"
              className="inline-block px-5 py-3 rounded-xl text-sm font-bold"
              style={{
                background:
                  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
              }}
            >
              Back to login
            </Link>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={submit}>
            <p className="text-sm text-cream/60 mb-5">
              Choose a new password for your account.
            </p>
            <label className="block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              className="w-full mb-3 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream outline-none focus:border-gold/40"
            />
            <label className="block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full mb-5 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream outline-none focus:border-gold/40"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-60"
              style={{
                background:
                  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
              }}
            >
              {busy ? "Working..." : "Set new password"}
            </button>
          </form>
        )}

        {phase === "done" && (
          <p className="text-sm text-cream/70 py-6">
            Password updated. Taking you to your dashboard...
          </p>
        )}
      </div>
    </div>
  );
}
