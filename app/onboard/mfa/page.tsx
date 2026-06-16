"use client";

/**
 * /onboard/mfa — TOTP enrollment for staff accounts.
 *
 * The team-mfa-enforce cron auto-suspends any founder / engineer / support
 * member with Lionade access who has not enrolled a verified TOTP factor
 * within 7 days of provisioning. This page is that enrollment path. TeamGate
 * routes enforced-MFA members here (after the password gate) until a verified
 * TOTP factor exists on their account.
 *
 * Flow:
 *   1. on mount: supabase.auth.mfa.enroll({ factorType: 'totp' })
 *      -> render totp.qr_code (an inline SVG string) + a copyable totp.secret
 *   2. user scans the QR (or types the secret) into their authenticator
 *   3. on submit: supabase.auth.mfa.challenge({ factorId }) then
 *      supabase.auth.mfa.verify({ factorId, challengeId, code })
 *   4. on verified: redirect /dashboard
 *
 * Secrets (the TOTP secret + QR) are never logged. Enroll/verify errors are
 * surfaced inline with generic copy.
 *
 * Re-entry: if an unverified factor already exists from a prior abandoned
 * attempt, enroll() can fail with "factor already exists." We list factors,
 * unenroll any stale unverified TOTP factor, then retry once.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { cdnUrl } from "@/lib/cdn";
import { Check, Warning, ShieldCheck, Copy } from "@phosphor-icons/react";

const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";
const GOLD_BG =
  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)";

interface EnrollState {
  factorId: string;
  qrCode: string;
  secret: string;
}

export default function OnboardMfaPage() {
  const router = useRouter();

  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [enrollError, setEnrollError] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [copied, setCopied] = useState(false);

  // Guard against React 18 StrictMode double-mount firing enroll twice.
  const startedRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.dataset.theme = "dark";
  }, []);

  const startEnrollment = useCallback(async () => {
    setEnrollError("");

    const doEnroll = async () => {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
      });
      return { data, error };
    };

    let { data, error } = await doEnroll();

    // If a stale unverified factor blocks re-enrollment, clear it and retry
    // once. Never log the factor list (it can reference secrets).
    if (error) {
      try {
        const { data: list } = await supabase.auth.mfa.listFactors();
        const stale = (list?.all ?? []).filter(
          (f: { factor_type?: string; status?: string; id: string }) =>
            f.factor_type === "totp" && f.status !== "verified",
        );
        for (const f of stale) {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
        if (stale.length > 0) {
          ({ data, error } = await doEnroll());
        }
      } catch {
        // fall through to the error surface below
      }
    }

    if (error || !data?.totp) {
      setEnrollError("Could not start enrollment. Refresh to try again.");
      return;
    }

    setEnroll({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void startEnrollment();
  }, [startEnrollment]);

  const copySecret = async () => {
    if (!enroll?.secret) return;
    try {
      await navigator.clipboard.writeText(enroll.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the secret is still visible for manual copy.
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying || !enroll) return;
    setVerifyError("");

    const clean = code.replace(/\D/g, "");
    if (clean.length !== 6) {
      setVerifyError("Enter the 6-digit code from your authenticator");
      return;
    }

    setVerifying(true);

    // challenge -> verify. (challengeAndVerify is equivalent; we keep the two
    // calls explicit so a challenge-create failure is distinguishable.)
    const { data: challenge, error: challengeErr } =
      await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
    if (challengeErr || !challenge?.id) {
      setVerifying(false);
      setVerifyError("Could not verify the code. Try again.");
      return;
    }

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId: enroll.factorId,
      challengeId: challenge.id,
      code: clean,
    });

    setVerifying(false);

    if (verifyErr) {
      setVerifyError("That code did not match. Check the time on your device and try again.");
      setCode("");
      return;
    }

    // Verified. The session is now AAL2 and a verified TOTP factor exists, so
    // the gate is satisfied on the next read.
    router.replace("/dashboard");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden py-8">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(74,144,217,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.08) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        className="absolute bottom-1/4 right-1/3 w-72 h-72 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }}
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
              Turn on two-factor
            </h1>
          </div>
          <p className="text-cream/60 text-sm leading-relaxed mb-6">
            Two-factor authentication is required for all staff accounts. You
            have 7 days from setup to enroll before access is paused. Scan the
            code below with an authenticator app like Google Authenticator,
            Authy, or 1Password, then enter the 6-digit code it shows.
          </p>

          {enrollError && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/10 border border-red-400/30 mb-5">
              <Warning size={16} weight="fill" color="#EF4444" className="flex-shrink-0" aria-hidden="true" />
              <p className="text-red-400 text-sm font-semibold">{enrollError}</p>
            </div>
          )}

          {!enroll && !enrollError && (
            <div className="flex items-center gap-3 text-sm text-cream/60 py-8 justify-center">
              <span className="w-4 h-4 rounded-full border-2 border-cream/20 border-t-cream/60 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Preparing your code...
            </div>
          )}

          {enroll && (
            <>
              {/* QR code. supabase-js returns an inline SVG string built from
                  the otpauth:// enrollment URI. We render it via a data-URI
                  <img> (not dangerouslySetInnerHTML) so the SVG cannot execute
                  in the document scope even though it is a trusted value. */}
              <div className="flex justify-center mb-5">
                <div className="bg-white rounded-xl p-3 w-44 h-44 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/svg+xml;utf-8,${encodeURIComponent(enroll.qrCode)}`}
                    alt="Two-factor QR code"
                    className="w-full h-full"
                  />
                </div>
              </div>

              {/* Manual-entry secret */}
              <div className="mb-6">
                <p className="text-cream/50 text-[11px] font-bold uppercase tracking-widest mb-2 text-center">
                  Can't scan? Enter this key
                </p>
                <button
                  type="button"
                  onClick={copySecret}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 hover:border-electric/40 transition-colors"
                >
                  <span className="font-dm-mono text-xs text-cream/80 break-all select-all">
                    {enroll.secret}
                  </span>
                  {copied ? (
                    <Check size={14} className="text-green-400 flex-shrink-0" aria-hidden="true" />
                  ) : (
                    <Copy size={14} className="text-cream/50 flex-shrink-0" aria-hidden="true" />
                  )}
                </button>
                {copied && (
                  <p className="text-green-400 text-[11px] text-center mt-1.5">Copied</p>
                )}
              </div>

              <form onSubmit={verify}>
                <label className="block text-cream/60 text-xs font-bold uppercase tracking-widest mb-2">
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                  className="w-full bg-white/5 border border-electric/20 rounded-xl px-4 py-3.5 text-cream placeholder-cream/25 text-center text-2xl font-dm-mono tracking-[0.5em] focus:outline-none focus:border-electric focus:bg-electric/5 transition-all"
                />

                {verifyError && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/10 border border-red-400/30 mt-4">
                    <Warning size={16} weight="fill" color="#EF4444" className="flex-shrink-0" aria-hidden="true" />
                    <p className="text-red-400 text-sm font-semibold">{verifyError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={verifying || code.length !== 6}
                  className="w-full py-4 rounded-xl font-bold text-base mt-6 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                  style={{ background: GOLD_BG, color: "#04080F" }}
                >
                  {verifying ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin motion-reduce:animate-none" />
                      Verifying...
                    </span>
                  ) : (
                    "Verify and continue"
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
