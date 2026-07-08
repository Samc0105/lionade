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
    // POST to /api/auth/reset-password, which mints a recovery link and sends
    // it via Resend (NOT Supabase SMTP — that credential silently died and took
    // the old client-side resetPasswordForEmail down with it). The route is
    // enumeration-safe: it returns an identical 200 whether or not the address
    // has an account, so we show the same confirmation on success either way.
    // We only surface account-INDEPENDENT failures: 429 (rate-limited) and 503
    // (email not configured / temporarily down). Those leak nothing about
    // whether the account exists.
    let status = 0;
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr }),
      });
      status = res.status;
    } catch {
      status = 0; // request never left the browser
    }
    setBusy(false);
    if (status === 200) {
      setSent(true);
      return;
    }
    if (status === 429) {
      setSendError("Too many requests. Wait a few minutes and try again.");
      return;
    }
    setSendError("Couldn't send right now. Check your connection and try again.");
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
