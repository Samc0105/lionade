"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X, Sparkle, Crown, CaretLeft } from "@phosphor-icons/react";
import BackButton from "@/components/BackButton";
import {
  PLAN_PRICING,
  PLAN_EXAM_LIMITS,
  PLAN_FANG_MULTIPLIER,
  PLAN_ADS,
} from "@/lib/mastery-plan";
import { SUPPORT_EMAIL } from "@/lib/site-config";

/**
 * Public pricing page. Shows the three plans (free / pro / platinum) with
 * a monthly/annual toggle. All prices, limits, and features flow from
 * `lib/mastery-plan.ts` so marketing copy and server-side gating stay
 * in sync.
 *
 * Checkout is not wired yet — "Upgrade" CTAs point to a mailto so the
 * founder handles manual upgrades until Stripe is live. Easy swap later.
 * (Stripe self-serve lands behind the same hrefs via /settings/subscription.)
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
    a: "AI costs real money — the adaptive exam prep runs on OpenAI. Ads on Free cover those costs so Lionade stays genuinely free for anyone who can't or doesn't want to pay. Pro removes popups; Platinum removes ads entirely.",
  },
  {
    q: "How does the annual discount work?",
    a: "Annual plans save you about two months — Pro annual is $69.99 (vs $83.88 monthly), Platinum annual is $149.99 (vs $179.88 monthly). Billed once per year. Cancel anytime for no charge on the next cycle.",
  },
  {
    q: "What's a Fang multiplier?",
    a: "Fangs are Lionade's in-app currency — you earn them for correct quiz answers, winning duels, streaks, and Clock-In bonuses. Pro earns 1.5× Fangs on everything; Platinum earns 2×. More Fangs = more shop buys and eventual cash-out.",
  },
  {
    q: "What happens to my data if I downgrade?",
    a: "Nothing gets deleted. You keep your history, streaks, Fangs, and every exam you've created. But going from Pro (3 exams) to Free (1) means extra exams archive automatically — you can unarchive later by upgrading.",
  },
  {
    q: "Do you offer refunds?",
    a: `Hit us at ${SUPPORT_EMAIL} within 7 days of purchase and we'll sort it. Past 7 days, subscription is non-refundable but always cancellable.`,
  },
];

type Cycle = "monthly" | "annual";

export default function PricingPage() {
  const [cycle, setCycle] = useState<Cycle>("monthly");

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
      <style>{`@keyframes lpRingPulse{0%,100%{opacity:.55}50%{opacity:1}}@media (prefers-reduced-motion:reduce){[data-lpring]{animation:none!important;opacity:.8!important}}`}</style>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6">
        <BackButton />

        <header className="text-center mb-10 animate-slide-up">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold mb-3">
            Pricing
          </p>
          <h1 className="font-bebas text-5xl sm:text-6xl text-cream tracking-[0.06em] leading-none mb-4">
            Study Like It's Your Job.
            <br />
            <span className="text-cream/50">Get Paid Like It Is.</span>
          </h1>
          <p className="text-cream/60 text-[14px] max-w-lg mx-auto leading-relaxed">
            Start free forever. Upgrade when you're ready to grind harder — every plan
            runs on the same adaptive AI, same duels, same leaderboard.
          </p>
        </header>

        {/* Monthly / Annual toggle — segmented glass pill */}
        <div
          className="flex justify-center mb-9 animate-slide-up"
          style={{ animationDelay: "0.05s" }}
        >
          <div
            role="group"
            aria-label="Billing cycle"
            className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] backdrop-blur border border-white/10 p-1"
          >
            <button
              onClick={() => setCycle("monthly")}
              aria-pressed={cycle === "monthly"}
              className={`font-mono text-[10px] uppercase tracking-[0.25em] px-5 py-2 rounded-full transition-all duration-200 ${
                cycle === "monthly"
                  ? "bg-white/[0.10] text-cream"
                  : "text-cream/50 hover:text-cream/80"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setCycle("annual")}
              aria-pressed={cycle === "annual"}
              className={`relative font-mono text-[10px] uppercase tracking-[0.25em] px-5 py-2 rounded-full transition-all duration-200 ${
                cycle === "annual"
                  ? "bg-white/[0.10] text-cream"
                  : "text-cream/50 hover:text-cream/80"
              }`}
            >
              Annual
              <span className="absolute -top-2.5 -right-2.5 bg-gold text-navy font-mono text-[8.5px] px-1.5 py-0.5 rounded-full tracking-wider shadow-[0_0_12px_-2px_rgba(255,215,0,0.6)]">
                Save ~17%
              </span>
            </button>
          </div>
        </div>

        {/* Plan cards */}
        <div
          className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-14 animate-slide-up"
          style={{ animationDelay: "0.1s" }}
        >
          <PlanCard
            tier="free"
            name="Free"
            tagline="Grind for free. Forever. No card."
            price={0}
            cta={{ label: "Start free", href: "/login" }}
          />
          <PlanCard
            tier="pro"
            name="Pro"
            tagline="For students who actually mean it."
            price={cycle === "monthly" ? PLAN_PRICING.pro.monthly : PLAN_PRICING.pro.annual}
            cycle={cycle}
            highlight
            cta={{ label: "Go Pro", href: "mailto:" + SUPPORT_EMAIL + "?subject=Upgrade%20to%20Lionade%20Pro" }}
          />
          <PlanCard
            tier="platinum"
            name="Platinum"
            tagline="Everything on. Zero ads. Full send."
            price={cycle === "monthly" ? PLAN_PRICING.platinum.monthly : PLAN_PRICING.platinum.annual}
            cycle={cycle}
            cta={{ label: "Go Platinum", href: "mailto:" + SUPPORT_EMAIL + "?subject=Upgrade%20to%20Lionade%20Platinum" }}
          />
        </div>

        {/* Detailed comparison */}
        <section className="mb-14 animate-slide-up" style={{ animationDelay: "0.15s" }}>
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
        </section>

        {/* FAQ */}
        <section id="faq" className="mb-16 animate-slide-up" style={{ animationDelay: "0.2s" }}>
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
        </section>

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
function PlanCard({
  tier, name, tagline, price, cycle, highlight, cta,
}: {
  tier: "free" | "pro" | "platinum";
  name: string;
  tagline: string;
  price: number;
  cycle?: Cycle;
  highlight?: boolean;
  cta: { label: string; href: string };
}) {
  const isFree = tier === "free";
  const isPlatinum = tier === "platinum";

  const perks: string[] = isFree
    ? [
        `${PLAN_EXAM_LIMITS.free} Mastery target`,
        "Quizzes, duels, leaderboards — all in",
        `Daily Clock-In Fangs (${PLAN_FANG_MULTIPLIER.free}×)`,
        "Free includes popup + banner ads",
      ]
    : tier === "pro"
      ? [
          `${PLAN_EXAM_LIMITS.pro} Mastery targets`,
          `${PLAN_FANG_MULTIPLIER.pro}× Fangs on everything`,
          "Session Report PDF — unlimited",
          "Popups gone",
          "Priority support",
        ]
      : [
          `${PLAN_EXAM_LIMITS.platinum} Mastery targets`,
          `${PLAN_FANG_MULTIPLIER.platinum}× Fangs — the max`,
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
                {cycle === "annual" ? Math.round(price / 12 * 100) / 100 : price}
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
