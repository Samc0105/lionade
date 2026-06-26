"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Check, X, Sparkle, Crown, CaretLeft } from "@phosphor-icons/react";
import BackButton from "@/components/BackButton";
import {
  PLAN_PRICING,
  PLAN_EXAM_LIMITS,
  PLAN_FANG_MULTIPLIER,
  PLAN_ADS,
} from "@/lib/mastery-plan";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { useAuth } from "@/lib/auth";
import { usePlan } from "@/lib/use-plan";
import { apiPost } from "@/lib/api-client";
import { toastError, toastInfo } from "@/lib/toast";

/**
 * Public pricing page. Shows the three plans (free / pro / platinum) with
 * a monthly/annual toggle. All prices, limits, and features flow from
 * `lib/mastery-plan.ts` so marketing copy and server-side gating stay
 * in sync.
 *
 * Checkout flow: Pro / Platinum CTAs POST to /api/stripe/checkout
 * (3-day trial included) and redirect to the Stripe-hosted Checkout URL.
 * Already-subscribed users get a "Manage plan" button on their current
 * tier that opens the Stripe Customer Portal via /api/stripe/portal.
 * Signed-out users bounce to /login?next=/pricing.
 *
 * Visual shell only redesigned (2026-05-15): glassy cards + page-local
 * Lionade WebGL shader. Plan DATA, the cycle toggle, the annual price
 * math, and every mailto CTA are unchanged.
 */

const FAQ = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Cancel from Settings → Subscription. You keep access through the end of your current billing period, then drop back to Free. No prorated refunds for partial months.",
  },
  {
    q: "Why are there ads on Free?",
    a: "AI costs real money. The adaptive exam prep runs on advanced AI, and ads on Free cover those costs so Lionade stays genuinely free for anyone who can't or doesn't want to pay. Pro removes popups; Platinum removes ads entirely.",
  },
  {
    q: "How does the annual discount work?",
    a: "Annual plans save you about two months. Pro annual is $69.99 (vs $83.88 monthly), Platinum annual is $149.99 (vs $179.88 monthly). Billed once per year. Cancel anytime for no charge on the next cycle.",
  },
  {
    q: "What's a Fang multiplier?",
    a: "Fangs are Lionade's in-app currency. You earn them for correct quiz answers, winning duels, streaks, and Clock-In bonuses. Pro earns 1.5× Fangs on everything; Platinum earns 2×. More Fangs = more shop buys and eventual cash-out.",
  },
  {
    q: "What happens to my data if I downgrade?",
    a: "Nothing gets deleted. You keep your history, streaks, Fangs, and every exam you've created. But going from Pro (3 exams) to Free (1) means extra exams archive automatically. You can unarchive later by upgrading.",
  },
  {
    q: "Do you offer refunds?",
    a: `Hit us at ${SUPPORT_EMAIL} within 7 days of purchase and we'll sort it. Past 7 days, subscription is non-refundable but always cancellable.`,
  },
];

type Cycle = "monthly" | "annual";

/**
 * VerticalCutReveal — inlined, minimal port of the danielpetho/vertical-cut-reveal
 * signature effect (NOT the external boilerplate file — implemented here with the
 * framer-motion already imported above, zero new deps, no new component file).
 *
 * Splits `text` into WORDS deterministically (`text.split(" ")` — NO Math.random,
 * staggerFrom is always the first/left word) so the rendered element tree is
 * byte-identical on the server and the first client render. Each word sits in an
 * `overflow-hidden` mask; its inner `motion.span` springs up from y:110% → 0 with
 * a left-to-right per-word stagger, so the words "cut up" out of the mask line by
 * line. Hydration-safe: framer-motion `initial="hidden"` / `animate="visible"`
 * renders the hidden state on the server and hydrates to the identical tree on
 * the client, THEN animates — no `mounted`/state-driven DOM swap, no
 * document/window at render. Under reduced motion the words render at their final
 * position with the SAME tree and no transform.
 *
 * Accessibility: the whole output is `aria-hidden` (the visible word spans are
 * purely decorative); the human-readable heading is exposed once via a single
 * page-level `<span className="sr-only">` in the <h1>.
 */
function VerticalCutReveal({
  text,
  reduce,
  startDelay = 0,
  className,
}: {
  text: string;
  reduce: boolean;
  startDelay?: number;
  className?: string;
}) {
  const words = text.split(" ");
  return (
    <span aria-hidden="true" className={className}>
      {words.map((word, i) => (
        <span
          key={i}
          className="inline-flex overflow-hidden align-bottom"
        >
          <motion.span
            className="inline-block"
            initial={reduce ? false : "hidden"}
            animate={reduce ? false : "visible"}
            variants={{
              hidden: { y: "110%" },
              visible: { y: 0 },
            }}
            transition={{
              type: "spring",
              stiffness: 250,
              damping: 30,
              delay: startDelay + i * 0.08,
            }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </span>
  );
}

/**
 * Deterministic sparkle field. Fixed array (NO Math.random at render) so the
 * server-rendered DOM is byte-identical to the first client render — zero
 * hydration risk. Each entry: left%, top%, size(px), twinkle duration(s),
 * delay(s), and a brand tint. Rendered purely with CSS keyframes (see the
 * inline <style> below) — no canvas, no WebGL, no particle engine.
 */
const SPARKLES: ReadonlyArray<{
  x: number; y: number; s: number; d: number; delay: number; c: string;
}> = [
  { x: 6, y: 14, s: 3, d: 4.2, delay: 0.0, c: "rgba(124,58,237,0.9)" },
  { x: 17, y: 62, s: 2, d: 5.1, delay: 0.7, c: "rgba(74,144,217,0.9)" },
  { x: 24, y: 28, s: 4, d: 3.8, delay: 1.4, c: "rgba(255,215,0,0.85)" },
  { x: 33, y: 81, s: 2, d: 4.9, delay: 0.3, c: "rgba(124,58,237,0.8)" },
  { x: 41, y: 11, s: 3, d: 5.4, delay: 1.1, c: "rgba(74,144,217,0.85)" },
  { x: 48, y: 49, s: 2, d: 4.0, delay: 2.0, c: "rgba(255,215,0,0.7)" },
  { x: 55, y: 73, s: 3, d: 4.6, delay: 0.9, c: "rgba(124,58,237,0.85)" },
  { x: 62, y: 19, s: 2, d: 5.6, delay: 1.7, c: "rgba(74,144,217,0.8)" },
  { x: 69, y: 57, s: 4, d: 3.9, delay: 0.5, c: "rgba(255,215,0,0.8)" },
  { x: 76, y: 35, s: 2, d: 5.0, delay: 2.3, c: "rgba(124,58,237,0.8)" },
  { x: 83, y: 78, s: 3, d: 4.4, delay: 1.3, c: "rgba(74,144,217,0.85)" },
  { x: 89, y: 23, s: 2, d: 5.3, delay: 0.2, c: "rgba(255,215,0,0.7)" },
  { x: 94, y: 52, s: 3, d: 4.1, delay: 1.9, c: "rgba(124,58,237,0.85)" },
  { x: 12, y: 90, s: 2, d: 5.5, delay: 0.6, c: "rgba(74,144,217,0.8)" },
  { x: 38, y: 38, s: 2, d: 4.7, delay: 2.6, c: "rgba(255,215,0,0.65)" },
  { x: 58, y: 92, s: 3, d: 4.3, delay: 1.0, c: "rgba(124,58,237,0.8)" },
  { x: 72, y: 8, s: 2, d: 5.2, delay: 2.1, c: "rgba(74,144,217,0.8)" },
  { x: 86, y: 64, s: 4, d: 3.7, delay: 0.4, c: "rgba(255,215,0,0.75)" },
];

export default function PricingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { plan, isPaid, isLoading: planLoading } = usePlan();
  const [cycle, setCycle] = useState<Cycle>("monthly");
  // Tier currently in-flight to /api/stripe/checkout so we can disable the
  // exact button + show a spinner without locking the other plan's CTA.
  const [pendingTier, setPendingTier] = useState<"pro" | "platinum" | null>(null);

  // Show a polite toast if the user returned from a canceled Stripe Checkout
  // session. Strip the query param so a back/forward navigation doesn't
  // re-fire the toast. Runs once on mount and whenever the param changes.
  useEffect(() => {
    if (searchParams?.get("upgrade") !== "canceled") return;
    toastInfo("Checkout canceled. You can subscribe anytime.");
    router.replace("/pricing");
  }, [searchParams, router]);

  /**
   * CTA click handler for Pro / Platinum.
   *   - Signed-out → /login?next=/pricing
   *   - Already on this paid tier → open Stripe Customer Portal (manage)
   *   - Otherwise → POST /api/stripe/checkout and follow the returned URL
   */
  async function handleUpgrade(tier: "pro" | "platinum") {
    if (!user) {
      router.push("/login?next=/pricing");
      return;
    }
    if (pendingTier) return;
    setPendingTier(tier);
    try {
      const isManaging = isPaid && plan === tier;
      const res = isManaging
        ? await apiPost<{ url: string }>("/api/stripe/portal", {})
        : await apiPost<{ url: string }>("/api/stripe/checkout", { tier, cycle });
      if (!res.ok || !res.data?.url) {
        console.error("[pricing:checkout] failed", res.error);
        toastError("Couldn't open checkout. Try again.");
        setPendingTier(null);
        return;
      }
      window.location.href = res.data.url;
    } catch (e) {
      console.error("[pricing:checkout] threw", e);
      toastError("Couldn't open checkout. Try again.");
      setPendingTier(null);
    }
  }
  // Returns true when the OS requests reduced motion. On the server this is
  // `null` (falsy) and on the client it resolves — but we ONLY ever use it to
  // pick animation *values*, never to add/remove DOM nodes, so the element
  // tree is identical SSR↔client (no hydration mismatch). The CSS sparkle /
  // gradient / ring layers additionally honor a @media reduced-motion rule.
  const reduce = useReducedMotion();

  // Premium, restrained reveal. Under reduced motion we keep the same element
  // tree but collapse the motion to an instant no-op.
  const ease = [0.22, 1, 0.36, 1] as const;
  const reveal = (delay: number) =>
    reduce
      ? { initial: false as const, animate: { opacity: 1 } }
      : {
          initial: { opacity: 0, y: 22, filter: "blur(6px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.55, ease, delay },
        };

  return (
    <div
      data-force-dark
      className="min-h-screen pt-20 pb-24 relative"
      style={{
        isolation: "isolate",
        // Self-contained dark interstellar — inline so it CANNOT be defeated
        // by CSS specificity, a missing html.light class, or stale globals.css.
        // Purple + navy nebula glow ("floating"), opaque #04080F base. Renders
        // correctly in every theme even if WebGL/PricingShader fails.
        backgroundColor: "#04080F",
        backgroundImage: `
          radial-gradient(60rem 60rem at 78% 6%, rgba(124,58,237,0.30) 0%, transparent 60%),
          radial-gradient(55rem 55rem at 10% 78%, rgba(30,58,138,0.30) 0%, transparent 62%),
          radial-gradient(42rem 42rem at 52% 42%, rgba(88,28,135,0.20) 0%, transparent 66%),
          radial-gradient(50rem 50rem at 22% 62%, rgba(124,58,237,0.18) 0%, transparent 64%),
          radial-gradient(48rem 48rem at 80% 65%, rgba(74,144,217,0.16) 0%, transparent 64%),
          radial-gradient(46rem 46rem at 90% 88%, rgba(37,99,235,0.16) 0%, transparent 60%)
        `,
      }}
    >
      {/* Decorative glowing concentric ring — PURE CSS. No WebGL, no
          document/window, no rAF, no DOM observers, no client branching.
          Identical markup SSR + client (cannot hydration-mismatch) and
          cannot crash the render the way the WebGL shader did. */}
      <div
        aria-hidden="true"
        data-lpring
        className="pointer-events-none absolute left-1/2 top-[42%] h-[40rem] w-[40rem] max-w-[95vw] max-h-[95vw] rounded-full"
        style={{
          transform: "translate(-50%,-50%)",
          background:
            "radial-gradient(circle, transparent 30%, rgba(74,144,217,0.22) 33%, rgba(124,58,237,0.30) 36%, transparent 39%, transparent 45%, rgba(124,58,237,0.16) 47%, rgba(255,215,0,0.13) 49%, transparent 52%)",
          filter: "blur(1px)",
          animation: "lpRingPulse 7s ease-in-out infinite",
        }}
      />
      {/* Slow-drifting brand nebula — PURE CSS animated gradient layered over
          the static interstellar base. Adds the "more colorful / alive" feel
          (Lionade purple #7C3AED + electric #4A90D9 + gold #FFD700) without
          any JS, canvas, or particle engine. Deterministic, SSR===client. */}
      <div
        aria-hidden="true"
        data-lpdrift
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `
            radial-gradient(50rem 50rem at 20% 18%, rgba(124,58,237,0.20) 0%, transparent 60%),
            radial-gradient(46rem 46rem at 82% 30%, rgba(74,144,217,0.16) 0%, transparent 62%),
            radial-gradient(44rem 44rem at 35% 62%, rgba(124,58,237,0.12) 0%, transparent 64%),
            radial-gradient(40rem 40rem at 60% 80%, rgba(255,215,0,0.07) 0%, transparent 64%)
          `,
          backgroundSize: "180% 180%",
          animation: "lpDrift 26s ease-in-out infinite",
        }}
      />

      {/* Pure-CSS sparkle field. Deterministic positions from SPARKLES — no
          Math.random, no canvas, no WebGL. behind content, non-interactive. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {SPARKLES.map((sp, i) => (
          <span
            key={i}
            data-lpspark
            className="absolute rounded-full"
            style={{
              left: `${sp.x}%`,
              top: `${sp.y}%`,
              width: sp.s,
              height: sp.s,
              backgroundColor: sp.c,
              boxShadow: `0 0 ${sp.s * 2.5}px ${sp.s * 0.8}px ${sp.c}`,
              filter: "blur(0.5px)",
              animation: `lpTwinkle ${sp.d}s ease-in-out ${sp.delay}s infinite`,
            }}
          />
        ))}
      </div>

      <style>{`@keyframes lpRingPulse{0%,100%{opacity:.55}50%{opacity:1}}@keyframes lpDrift{0%,100%{background-position:0% 0%}50%{background-position:100% 100%}}@keyframes lpTwinkle{0%,100%{opacity:.15;transform:scale(.6)}50%{opacity:1;transform:scale(1.15)}}@media (prefers-reduced-motion:reduce){[data-lpring]{animation:none!important;opacity:.8!important}[data-lpdrift]{animation:none!important}[data-lpspark]{animation:none!important;opacity:.55!important}}`}</style>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <BackButton />

        {/* Header is now a plain element: the eyebrow + subcopy keep the exact
            same reveal(0.05) fade/blur as before (moved onto them individually,
            identical values → visually unchanged), while the <h1> opts OUT of
            the blanket fade so its reveal is purely the per-word vertical cut. */}
        <header className="text-center mb-10">
          <motion.p
            className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold mb-3"
            {...reveal(0.05)}
          >
            Pricing
          </motion.p>
          {/* Per-word VerticalCutReveal (replaces the old fade/blur slide-up).
              Exact text + two-part / styled-span structure + colors preserved:
              line 1 in text-cream, line 2 in text-cream/50, with the original
              <br/> line break between them. */}
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-[0.06em] leading-none mb-4">
            <span className="sr-only">Study Like It&apos;s Your Job. Get Paid Like It Is.</span>
            <VerticalCutReveal text="Study Like It's Your Job." reduce={!!reduce} startDelay={0.05} />
            <br aria-hidden="true" />
            <VerticalCutReveal
              text="Get Paid Like It Is."
              reduce={!!reduce}
              startDelay={0.05 + 5 * 0.08}
              className="text-cream/50"
            />
          </h1>
          <motion.p
            className="text-cream/60 text-[14px] max-w-lg mx-auto leading-relaxed"
            {...reveal(0.05)}
          >
            Start free forever. Upgrade when you're ready to grind harder. Every plan
            runs on the same adaptive AI, same duels, same leaderboard.
          </motion.p>
        </header>

        {/* Monthly / Annual toggle — segmented glass pill with a Framer Motion
            layoutId slider. cycle / setCycle / all price math unchanged. */}
        <motion.div className="flex justify-center mb-9" {...reveal(0.12)}>
          <div
            role="group"
            aria-label="Billing cycle"
            className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] backdrop-blur border border-white/10 p-1"
          >
            <button
              onClick={() => setCycle("monthly")}
              aria-pressed={cycle === "monthly"}
              className={`relative font-mono text-[10px] uppercase tracking-[0.25em] px-5 py-2 rounded-full transition-colors duration-200 ${
                cycle === "monthly" ? "text-cream" : "text-cream/50 hover:text-cream/80"
              }`}
            >
              {cycle === "monthly" && (
                <motion.span
                  layoutId="lpCyclePill"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-white/[0.10] border border-white/10 shadow-[0_0_18px_-6px_rgba(124,58,237,0.6)]"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 360, damping: 30 }
                  }
                />
              )}
              <span className="relative z-10">Monthly</span>
            </button>
            <button
              onClick={() => setCycle("annual")}
              aria-pressed={cycle === "annual"}
              className={`relative font-mono text-[10px] uppercase tracking-[0.25em] px-5 py-2 rounded-full transition-colors duration-200 ${
                cycle === "annual" ? "text-cream" : "text-cream/50 hover:text-cream/80"
              }`}
            >
              {cycle === "annual" && (
                <motion.span
                  layoutId="lpCyclePill"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-white/[0.10] border border-white/10 shadow-[0_0_18px_-6px_rgba(124,58,237,0.6)]"
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 360, damping: 30 }
                  }
                />
              )}
              <span className="relative z-10">Annual</span>
              <span className="absolute -top-2.5 -right-2.5 z-20 bg-gold text-navy font-mono text-[8.5px] px-1.5 py-0.5 rounded-full tracking-wider shadow-[0_0_12px_-2px_rgba(255,215,0,0.6)]">
                Save 2 months
              </span>
            </button>
          </div>
        </motion.div>

        {/* Plan cards — staggered Framer Motion entrance. CTA copy is now
            tier-aware: paid users get "Manage plan" on their current tier so
            the same button opens the Stripe Customer Portal. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-14">
          <motion.div {...reveal(0.20)}>
            <PlanCard
              tier="free"
              name="Free"
              tagline="Grind for free. Forever. No card."
              price={0}
              reduce={!!reduce}
              cta={{ label: user ? "You're on Free" : "Start free", href: user ? "/dashboard" : "/login" }}
            />
          </motion.div>
          <motion.div {...reveal(0.30)}>
            <PlanCard
              tier="pro"
              name="Pro"
              tagline="For students who actually mean it."
              price={cycle === "monthly" ? PLAN_PRICING.pro.monthly : PLAN_PRICING.pro.annual}
              cycle={cycle}
              highlight
              reduce={!!reduce}
              cta={{
                label: planLoading ? "" : plan === "pro" ? "Manage plan" : "Go Pro",
                onClick: () => handleUpgrade("pro"),
                loading: pendingTier === "pro",
                pending: planLoading,
                disabled: pendingTier !== null || planLoading,
              }}
            />
          </motion.div>
          <motion.div {...reveal(0.40)}>
            <PlanCard
              tier="platinum"
              name="Platinum"
              tagline="Everything on. Zero ads. Full send."
              price={cycle === "monthly" ? PLAN_PRICING.platinum.monthly : PLAN_PRICING.platinum.annual}
              cycle={cycle}
              reduce={!!reduce}
              cta={{
                label: planLoading ? "" : plan === "platinum" ? "Manage plan" : "Go Platinum",
                onClick: () => handleUpgrade("platinum"),
                loading: pendingTier === "platinum",
                pending: planLoading,
                disabled: pendingTier !== null || planLoading,
              }}
            />
          </motion.div>
        </div>

        {/* Detailed comparison */}
        <motion.section
          className="mb-14"
          {...(reduce
            ? { initial: false as const }
            : {
                initial: { opacity: 0, y: 22, filter: "blur(6px)" },
                whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
                viewport: { once: true, amount: 0.15 },
                transition: { duration: 0.55, ease },
              })}
        >
          <h2 className="font-bebas text-2xl tracking-[0.15em] text-cream/80 text-center mb-5">
            Full Comparison
          </h2>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl overflow-hidden">
            <div className="grid grid-cols-4 text-[12px] font-mono uppercase tracking-[0.18em] text-cream/50 bg-white/[0.04] px-4 sm:px-6 py-3 border-b border-white/10">
              <div>Feature</div>
              <div className="text-center">Free</div>
              <div className="text-center text-gold">Pro</div>
              <div className="text-center">Platinum</div>
            </div>
            <CompareRow label="Active Mastery Mode targets" values={[PLAN_EXAM_LIMITS.free, PLAN_EXAM_LIMITS.pro, PLAN_EXAM_LIMITS.platinum]} />
            <CompareRow label="AI-adaptive exam prep" values={[true, true, true]} />
            <CompareRow label="Daily Clock-In Fangs" values={[true, true, true]} />
            <CompareRow label="Quizzes, duels, leaderboards" values={[true, true, true]} />
            <CompareRow label="Fangs earn rate" values={[
              `${PLAN_FANG_MULTIPLIER.free}×`,
              `${PLAN_FANG_MULTIPLIER.pro}×`,
              `${PLAN_FANG_MULTIPLIER.platinum}×`,
            ]} />
            <CompareRow label="Session Report PDF" values={[false, true, true]} />
            <CompareRow label="Popup ads" values={[
              PLAN_ADS.free.popups,
              PLAN_ADS.pro.popups,
              PLAN_ADS.platinum.popups,
            ]} invertTruth />
            <CompareRow label="Background / banner ads" values={[
              PLAN_ADS.free.background,
              PLAN_ADS.pro.background,
              PLAN_ADS.platinum.background,
            ]} invertTruth />
            <CompareRow label="Priority AI routing" values={[false, false, true]} />
            <CompareRow label="Early access to new features" values={[false, false, true]} />
            <CompareRow label="Priority support" values={[false, true, true]} last />
          </div>
        </motion.section>

        {/* FAQ */}
        <motion.section
          id="faq"
          className="mb-16"
          {...(reduce
            ? { initial: false as const }
            : {
                initial: { opacity: 0, y: 22, filter: "blur(6px)" },
                whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
                viewport: { once: true, amount: 0.15 },
                transition: { duration: 0.55, ease },
              })}
        >
          <h2 className="font-bebas text-2xl tracking-[0.15em] text-cream/80 text-center mb-5">
            Questions
          </h2>
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl overflow-hidden"
              >
                <summary className="cursor-pointer px-4 py-3 flex items-center justify-between gap-3 text-[13.5px] text-cream/90 hover:text-cream transition-colors [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <CaretLeft size={12} weight="bold" className="shrink-0 -rotate-90 group-open:rotate-90 transition-transform text-cream/60" />
                </summary>
                <div className="px-4 pb-4 text-[13px] text-cream/65 leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </motion.section>

        {/* Trust footer */}
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
          Prices in USD · Cancel anytime · Questions? {" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-cream transition-colors">
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </div>
  );
}

// ── Plan card ────────────────────────────────────────────────────────────────
type PlanCardCta =
  | { label: string; href: string }
  | {
      label: string;
      onClick: () => void;
      /** Checkout / portal request in flight — shows the "Opening checkout" spinner. */
      loading?: boolean;
      /** Plan/auth still resolving — shows a neutral pulse so we don't flash "Go Pro" at a subscriber. */
      pending?: boolean;
      disabled?: boolean;
    };

function PlanCard({
  tier, name, tagline, price, cycle, highlight, reduce, cta,
}: {
  tier: "free" | "pro" | "platinum";
  name: string;
  tagline: string;
  price: number;
  cycle?: Cycle;
  highlight?: boolean;
  reduce?: boolean;
  cta: PlanCardCta;
}) {
  const isFree = tier === "free";
  const isPlatinum = tier === "platinum";

  const perks: string[] = isFree
    ? [
        `${PLAN_EXAM_LIMITS.free} active Mastery Mode target`,
        "Quizzes, duels, leaderboards, all in",
        `Daily Clock-In Fangs (${PLAN_FANG_MULTIPLIER.free}×)`,
        "Free includes popup + banner ads",
      ]
    : tier === "pro"
      ? [
          `${PLAN_EXAM_LIMITS.pro} active Mastery Mode targets`,
          `${PLAN_FANG_MULTIPLIER.pro}× Fangs on everything`,
          "Unlimited Session Report PDFs",
          "Popups gone",
          "Priority support",
        ]
      : [
          `${PLAN_EXAM_LIMITS.platinum} active Mastery Mode targets`,
          `${PLAN_FANG_MULTIPLIER.platinum}× Fangs, the max`,
          "Zero ads. Clean surface.",
          "Priority AI routing",
          "Early access to everything new",
        ];

  // Pro = gold gradient ring; Platinum = silver/electric ring; Free = plain glass.
  const ringClass = highlight
    ? "bg-gradient-to-b from-gold/40 via-gold/10 to-transparent"
    : isPlatinum
      ? "bg-gradient-to-b from-[#C0C6D6]/40 via-electric/10 to-transparent"
      : "bg-white/10";

  return (
    <div
      className={`relative rounded-3xl p-px ${ringClass} ${
        highlight ? "shadow-[0_0_40px_-8px_rgba(255,215,0,0.35)]" : ""
      }`}
    >
      {/* Vivid purple↔electric brand glow behind the focal (Pro) card. Always
          rendered for highlight so SSR===client; only the gentle pulse is
          animated, and that is disabled under reduced motion. */}
      {highlight && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-2 rounded-[2rem] blur-2xl"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 0%, rgba(124,58,237,0.40) 0%, rgba(74,144,217,0.22) 45%, transparent 70%)",
          }}
          animate={reduce ? { opacity: 0.6 } : { opacity: [0.45, 0.85, 0.45] }}
          transition={reduce ? { duration: 0 } : { duration: 6, ease: "easeInOut", repeat: Infinity }}
        />
      )}

      <div className="relative h-full rounded-[calc(1.5rem-1px)] p-5 sm:p-6 flex flex-col bg-[#070c16]/80 backdrop-blur-xl overflow-hidden">
        {/* Top inner light — pure CSS gradient, no animation. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/[0.06] to-transparent"
        />

        {highlight && (
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold text-navy font-mono text-[9px] uppercase tracking-[0.25em] px-2.5 py-1 rounded-full shadow-[0_0_16px_-2px_rgba(255,215,0,0.7)]">
            Most popular
          </span>
        )}

        <div className="relative flex items-center gap-2 mb-1">
          {tier === "pro" && <Sparkle size={14} className="text-gold" weight="fill" />}
          {tier === "platinum" && <Crown size={14} className="text-[#E8EAF2]" weight="fill" />}
          <h3 className="font-bebas text-[24px] tracking-wider text-cream">{name}</h3>
        </div>
        <p className="relative text-[12.5px] text-cream/55 mb-5">{tagline}</p>

        <div className="relative mb-5">
          {isFree ? (
            <div className="flex items-baseline gap-1.5">
              <span className="font-bebas text-6xl sm:text-7xl tracking-wider text-cream leading-none">
                $0
              </span>
              <span className="text-cream/50 text-[12px]">forever</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-1.5">
              <span className="font-bebas text-6xl sm:text-7xl tracking-wider text-cream leading-none tabular-nums">
                <span className="text-cream/45 text-[0.45em] align-top mr-0.5">$</span>
                {/* Price number crossfades/slides on monthly↔annual flip.
                    The displayed value is the SAME math as before — only the
                    presentation animates. Reduced motion → instant swap. */}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={cycle === "annual" ? `a-${price}` : `m-${price}`}
                    className="inline-block"
                    initial={reduce ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14 }}
                    transition={
                      reduce ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
                    }
                  >
                    {cycle === "annual" ? Math.round(price / 12 * 100) / 100 : price}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="text-cream/50 text-[12px]">/ mo</span>
              {cycle === "annual" && (
                <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold/80">
                  ${price}/yr
                </span>
              )}
            </div>
          )}
        </div>

        <ul className="relative flex-1 flex flex-col gap-2 mb-6">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-2 text-[13px] text-cream/85 leading-snug">
              <Check size={13} weight="bold" className="text-gold mt-[3px] shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>

        {"href" in cta ? (
          <Link
            href={cta.href}
            className={`relative w-full text-center rounded-full font-mono text-[11px] uppercase tracking-[0.25em] py-3 transition-all duration-200 active:scale-[0.98] ${
              highlight
                ? "btn-gold !rounded-full !py-3"
                : isPlatinum
                  ? "bg-gradient-to-r from-[#C0C6D6] to-[#E8EAF2] text-navy hover:brightness-110"
                  : "border border-white/15 text-cream hover:bg-white/[0.06]"
            }`}
          >
            {cta.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={cta.onClick}
            disabled={cta.disabled || cta.loading}
            className={`relative w-full text-center rounded-full font-mono text-[11px] uppercase tracking-[0.25em] py-3 transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
              highlight
                ? "btn-gold !rounded-full !py-3"
                : isPlatinum
                  ? "bg-gradient-to-r from-[#C0C6D6] to-[#E8EAF2] text-navy hover:brightness-110"
                  : "border border-white/15 text-cream hover:bg-white/[0.06]"
            }`}
          >
            {cta.pending ? (
              <span className="inline-flex items-center justify-center" aria-label="Loading your plan">
                <span
                  aria-hidden="true"
                  className="inline-block w-12 h-2.5 rounded-full bg-current animate-pulse"
                  style={{ opacity: 0.4 }}
                />
              </span>
            ) : cta.loading ? (
              <span className="inline-flex items-center gap-2 justify-center">
                <span
                  aria-hidden="true"
                  className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                />
                Opening checkout
              </span>
            ) : (
              cta.label
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Compare-row ──────────────────────────────────────────────────────────────
function CompareRow({
  label, values, invertTruth, last,
}: {
  label: string;
  values: Array<string | number | boolean>;
  /** For ad rows: `true` means "has ads" — render a red X, not a green check. */
  invertTruth?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-4 items-center text-[13px] px-4 sm:px-6 py-3 ${
        last ? "" : "border-b border-white/[0.06]"
      }`}
    >
      <div className="text-cream/85">{label}</div>
      {values.map((v, i) => (
        <div key={i} className="text-center">
          {typeof v === "boolean"
            ? (v
                ? (invertTruth
                    ? <X size={14} weight="bold" className="inline text-[#EF4444]/70" aria-label="not included" />
                    : <Check size={14} weight="bold" className="inline text-[#22C55E]/80" aria-label="included" />)
                : (invertTruth
                    ? <Check size={14} weight="bold" className="inline text-[#22C55E]/80" aria-label="included" />
                    : <X size={14} weight="bold" className="inline text-cream/25" aria-label="not included" />)
              )
            : <span className="font-mono text-[12.5px] tabular-nums text-cream/80">{v}</span>
          }
        </div>
      ))}
    </div>
  );
}
