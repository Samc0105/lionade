"use client";

/**
 * /forgot-password — self-serve password reset request (the front-half).
 *
 * Enter the account email and we send a Supabase recovery email whose link
 * lands on /reset-password (the back-half) where the new password is set. We
 * always show the same confirmation whether or not the address has an account,
 * so this page never reveals which emails are registered (no enumeration).
 */

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";
const GOLD_BTN = "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setBusy(true);
    setSendError(null);
    // resetPasswordForEmail does not reveal whether the address exists, and we
    // show the same confirmation either way, so account enumeration is not
    // possible here. The emailed link lands on /reset-password (the recovery
    // back-half), which consumes the token and lets the user set a new password.
    //
    // We DO surface failures that are not account-specific: a thrown transport
    // error (the request never left the browser) and resolved rate-limit /
    // server errors (Supabase refused or failed to send for everyone). Those
    // leak nothing about whether the account exists, and showing the "sent"
    // confirmation for them leaves the user waiting on an email that will
    // never arrive. Other resolved outcomes keep the identical success copy.
    let failed = false;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(addr, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error && (error.status === 429 || (error.status ?? 0) >= 500)) failed = true;
    } catch {
      failed = true;
    }
    setBusy(false);
    if (failed) {
      setSendError("Couldn't send right now. Check your connection and try again.");
      return;
    }
    setSent(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] p-8" style={{ background: CARD_BG }}>
        <h1 className="font-bebas text-3xl tracking-wider text-cream mb-2">Forgot your password?</h1>

        {sent ? (
          <div className="py-2">
            <p className="text-sm text-cream/70 mb-5">
              If an account exists for <span className="text-cream">{email.trim()}</span>, we just sent it a password reset link. Check your inbox, and your spam folder. The link opens a page where you can set a new password.
            </p>
            <Link href="/login" className="inline-block px-5 py-3 rounded-xl text-sm font-bold" style={{ background: GOLD_BTN, color: "#04080F" }}>
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="text-sm text-cream/60 mb-5">
              Enter the email on your account and we will send you a link to reset your password.
            </p>
            <label className="block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              className="w-full mb-5 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream outline-none focus:border-gold/40"
            />
            {sendError && (
              <p role="alert" className="mb-4 -mt-1 text-xs text-red-300">
                {sendError}
              </p>
            )}
            <button type="submit" disabled={busy} className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: GOLD_BTN, color: "#04080F" }}>
              {busy ? "Sending..." : "Send reset link"}
            </button>
            <Link href="/login" className="block text-center text-xs text-cream/50 hover:text-cream/80 mt-4">
              Back to login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
