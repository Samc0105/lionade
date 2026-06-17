"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Lock, X, Sparkle } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import type { StudySheetInput } from "@/components/Mastery/studySheetPdf";

/**
 * "Session Report" button — inline in the Mastery session header. Always
 * visible so the upgrade surface stays prominent without interrupting the
 * chat flow.
 *
 * - Pro / Platinum users  click  PDF downloads immediately
 * - Free users            click  paywall modal with upgrade CTA
 * - If the `plan` column hasn't shipped to Supabase yet (migration 032),
 *   we treat the user as `free`. The feature is opt-in, so fail-closed is
 *   the right default here.
 */

const PAID_PLANS = new Set(["pro", "platinum"]);

// Minimum overall mastery before Session Report unlocks. There's nothing
// meaningful to report until the user has done real work.
const UNLOCK_PCT = 33;

type Plan = "free" | "pro" | "platinum" | "unknown";

interface Props {
  userId: string | undefined;
  buildInput: () => StudySheetInput | null;
  /** Current overall display % for the session. Button disables below UNLOCK_PCT. */
  overallPct: number;
}

export default function SessionReportFab({
  userId,
  buildInput,
  overallPct,
}: Props) {
  const [plan, setPlan] = useState<Plan>("unknown");
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Fetch the user's plan once on mount. Handles the "column missing" case
  // by defaulting to 'free' — works in dev envs where the migration hasn't
  // been applied yet.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("plan")
          .eq("id", userId)
          .single();
        if (cancelled) return;
        if (error || !data) {
          setPlan("free");
          return;
        }
        const p = String((data as { plan?: string }).plan ?? "free");
        setPlan(PAID_PLANS.has(p) ? (p as Plan) : "free");
      } catch {
        if (!cancelled) setPlan("free");
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const isPaid = plan === "pro" || plan === "platinum";
  const unlocked = overallPct >= UNLOCK_PCT;

  const handleClick = async () => {
    if (!unlocked) return; // locked below 33% — button is visible but inert
    if (!isPaid) {
      setPaywallOpen(true);
      return;
    }
    const input = buildInput();
    if (!input) return;
    setDownloading(true);
    try {
      // Dynamic import so jspdf (~135 KB) only lands in the bundle the first
      // time a paid user actually clicks Download. Keeps the main session
      // bundle lean for the common (non-downloading) path.
      const mod = await import("@/components/Mastery/studySheetPdf");
      mod.downloadStudySheet(input);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={downloading || plan === "unknown"}
        aria-label={unlocked ? "Session Report" : `Reach ${UNLOCK_PCT}% mastery to unlock Session Report`}
        title={unlocked ? undefined : `Unlocks at ${UNLOCK_PCT}% mastery`}
        className={`
          inline-flex items-center gap-2 min-h-[36px] rounded-full
          font-mono uppercase tracking-[0.25em]
          px-3 py-1.5 text-[10px]
          transition-transform duration-200 motion-reduce:transition-none
          disabled:cursor-not-allowed
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
          ${unlocked
            ? "bg-gradient-to-r from-gold to-[#F0B429] text-navy shadow-[0_8px_24px_rgba(255,215,0,0.22)] hover:scale-[1.03] active:scale-[0.98] motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
            : "bg-white/[0.05] border border-white/[0.1] text-cream/55 cursor-not-allowed"
          }
        `}
      >
        {!unlocked
          ? <Lock size={12} weight="fill" aria-hidden="true" />
          : isPaid
            ? <FileText size={14} weight="fill" aria-hidden="true" />
            : <Lock size={12} weight="fill" aria-hidden="true" />
        }
        <span>
          {downloading
            ? "Preparing…"
            : !unlocked
              ? `${Math.round(overallPct)} / ${UNLOCK_PCT}%`
              : "Session Report"}
        </span>
        {unlocked && !isPaid && (
          <span className="font-bebas text-[13px] tracking-wider leading-none pl-1 border-l border-navy/30 ml-1">
            Pro
          </span>
        )}
      </button>
      {paywallOpen && <Paywall onClose={() => setPaywallOpen(false)} />}
    </>
  );
}

// ── Paywall modal ────────────────────────────────────────────────────────────
function Paywall({ onClose }: { onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
    >
      <div ref={panelRef} className="relative w-full max-w-md rounded-[14px] border border-gold/30 bg-gradient-to-br from-navy to-[#0a0f1d] p-6 shadow-2xl animate-slide-up">
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Close Session Report upgrade dialog"
          className="absolute top-3 right-3 text-cream/55 hover:text-cream grid place-items-center w-9 h-9 rounded-full hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <Sparkle size={14} className="text-gold" weight="fill" aria-hidden="true" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Pro feature
          </span>
        </div>
        <h3
          id="paywall-title"
          className="font-bebas text-[30px] tracking-wider text-cream leading-tight mb-2"
        >
          Your whole session, in one file.
        </h3>
        <p className="text-[13.5px] text-cream/75 leading-relaxed mb-5">
          Ninny only keeps your last few messages on screen. Pro gives you the
          full picture: every teach card, mnemonic, and common pitfall, plus a
          subtopic-by-subtopic breakdown of where you&apos;re strong and where
          you&apos;re shaky. Yours to print, share, or drop into your notes app.
        </p>

        <ul className="flex flex-col gap-1.5 mb-5 text-[12.5px] text-cream/75">
          <li className="flex items-start gap-2">
            <span className="text-gold mt-[5px] shrink-0">•</span>
            <span>Full Session Report PDF on demand</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gold mt-[5px] shrink-0">•</span>
            <span>3 active mastery targets in parallel (vs 1 on free)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-gold mt-[5px] shrink-0">•</span>
            <span>Platinum: 8 targets + priority support</span>
          </li>
        </ul>

        <div className="flex items-baseline gap-2 mb-5">
          <span className="font-bebas text-[36px] tracking-wider text-gold leading-none tabular-nums">$4.99</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">/ month</span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-full border border-white/[0.1] text-cream/75 hover:text-cream hover:border-white/[0.25] font-mono text-[11px] uppercase tracking-[0.25em] py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            Maybe later
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[11px] uppercase tracking-[0.25em] py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            Upgrade to Pro
          </button>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/55 text-center mt-4">
          Billing isn&apos;t live yet · reach out to upgrade today
        </p>
      </div>
    </div>
  );
}
