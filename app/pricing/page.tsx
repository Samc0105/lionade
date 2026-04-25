"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X, Sparkle, Crown, Lightning, CaretLeft } from "@phosphor-icons/react";
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
    <div className="min-h-screen pt-20 pb-24 relative">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
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

        {/* Monthly / Annual toggle */}
        <div className="flex items-center justify-center gap-2 mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
          <button
            onClick={() => setCycle("monthly")}
            className={`font-mono text-[10px] uppercase tracking-[0.25em] px-4 py-2 rounded-full transition-colors ${
              cycle === "monthly"
                ? "bg-white/[0.08] text-cream border border-white/[0.15]"
                : "text-cream/50 hover:text-cream border border-transparent"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setCycle("annual")}
            className={`font-mono text-[10px] uppercase tracking-[0.25em] px-4 py-2 rounded-full transition-colors relative ${
              cycle === "annual"
                ? "bg-white/[0.08] text-cream border border-white/[0.15]"
                : "text-cream/50 hover:text-cream border border-transparent"
            }`}
          >
            Annual
            <span className="absolute -top-2 -right-2 bg-gold text-navy font-mono text-[8.5px] px-1.5 py-0.5 rounded-full tracking-wider">
              Save ~17%
            </span>
          </button>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-14 animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <PlanCard
            tier="free"
            name="Free"
            tagline="For anyone who just wants to grind."
            price={0}
            cta={{ label: "Start free", href: "/login" }}
          />
          <PlanCard
            tier="pro"
            name="Pro"
            tagline="For students and certifiers who mean it."
            price={cycle === "monthly" ? PLAN_PRICING.pro.monthly : PLAN_PRICING.pro.annual}
            cycle={cycle}
            highlight
            cta={{ label: "Go Pro", href: "mailto:" + SUPPORT_EMAIL + "?subject=Upgrade%20to%20Lionade%20Pro" }}
          />
          <PlanCard
            tier="platinum"
            name="Platinum"
            tagline="For the fully-committed. Every feature, zero ads."
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
          <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.02] overflow-hidden">
            <div className="grid grid-cols-4 text-[12px] font-mono uppercase tracking-[0.18em] text-cream/50 bg-white/[0.03] px-4 sm:px-6 py-3 border-b border-white/[0.06]">
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
        <section className="mb-16 animate-slide-up" style={{ animationDelay: "0.2s" }}>
          <h2 className="font-bebas text-2xl tracking-[0.15em] text-cream/80 text-center mb-5">
            Questions
          </h2>
          <div className="max-w-3xl mx-auto flex flex-col gap-3">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group rounded-[10px] border border-white/[0.06] bg-white/[0.02] overflow-hidden"
              >
                <summary className="cursor-pointer px-4 py-3 flex items-center justify-between gap-3 text-[13.5px] text-cream/90 hover:text-cream transition-colors [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <CaretLeft size={12} weight="bold" className="shrink-0 -rotate-90 group-open:rotate-90 transition-transform text-cream/40" />
                </summary>
                <div className="px-4 pb-4 text-[13px] text-cream/65 leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* Trust footer */}
        <p className="text-center font-mono text-[10px] uppercase tracking-[0.25em] text-cream/30">
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
        `${PLAN_EXAM_LIMITS.free} active Mastery target`,
        "Quizzes, duels, leaderboards",
        `Daily Clock-In (Fangs ${PLAN_FANG_MULTIPLIER.free}×)`,
        "Includes popup + banner ads",
      ]
    : tier === "pro"
      ? [
          `${PLAN_EXAM_LIMITS.pro} active Mastery targets`,
          "Session Report PDF — unlimited",
          `${PLAN_FANG_MULTIPLIER.pro}× Fangs earn rate`,
          "No popup ads",
          "Priority support",
        ]
      : [
          `${PLAN_EXAM_LIMITS.platinum} active Mastery targets`,
          `${PLAN_FANG_MULTIPLIER.platinum}× Fangs earn rate — highest`,
          "ZERO ads — clean surface",
          "Priority AI routing",
          "Early access to new features",
        ];

  return (
    <div
      className={`
        relative rounded-[14px] p-5 sm:p-6 flex flex-col
        transition-all duration-300
        ${highlight
          ? "border-2 border-gold/60 bg-gradient-to-br from-gold/[0.06] to-transparent shadow-[0_0_30px_rgba(255,215,0,0.12)]"
          : isPlatinum
            ? "border border-white/[0.15] bg-gradient-to-br from-white/[0.04] to-transparent"
            : "border border-white/[0.08] bg-white/[0.02]"
        }
      `}
    >
      {highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold text-navy font-mono text-[9px] uppercase tracking-[0.25em] px-2.5 py-1 rounded-full">
          Most popular
        </span>
      )}

      <div className="flex items-center gap-2 mb-1">
        {tier === "pro" && <Sparkle size={14} className="text-gold" weight="fill" />}
        {tier === "platinum" && <Crown size={14} className="text-[#E8EAF2]" weight="fill" />}
        <h3 className="font-bebas text-[24px] tracking-wider text-cream">{name}</h3>
      </div>
      <p className="text-[12.5px] text-cream/55 mb-5">{tagline}</p>

      <div className="mb-5">
        {isFree ? (
          <div className="flex items-baseline gap-1">
            <span className="font-bebas text-[44px] tracking-wider text-cream leading-none">$0</span>
            <span className="text-cream/40 text-[12px]">forever</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className="font-bebas text-[44px] tracking-wider text-cream leading-none tabular-nums">
              ${cycle === "annual" ? Math.round(price / 12 * 100) / 100 : price}
            </span>
            <span className="text-cream/40 text-[12px]">/ month</span>
            {cycle === "annual" && (
              <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold/80">
                ${price}/yr
              </span>
            )}
          </div>
        )}
      </div>

      <ul className="flex-1 flex flex-col gap-2 mb-6">
        {perks.map((p) => (
          <li key={p} className="flex items-start gap-2 text-[13px] text-cream/85 leading-snug">
            <Check size={13} weight="bold" className="text-gold mt-[3px] shrink-0" />
            <span>{p}</span>
          </li>
        ))}
      </ul>

      <Link
        href={cta.href}
        className={`
          w-full text-center rounded-full
          font-mono text-[11px] uppercase tracking-[0.25em]
          py-3 transition-all duration-200 active:scale-[0.98]
          ${highlight
            ? "bg-gold text-navy hover:bg-gold/90 shadow-md shadow-gold/20"
            : isPlatinum
              ? "bg-gradient-to-r from-[#C0C6D6] to-[#E8EAF2] text-navy hover:brightness-110"
              : "border border-white/[0.15] text-cream hover:bg-white/[0.05]"
          }
        `}
      >
        {cta.label}
      </Link>
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
        last ? "" : "border-b border-white/[0.05]"
      }`}
    >
      <div className="text-cream/85">{label}</div>
      {values.map((v, i) => (
        <div key={i} className="text-center">
          {typeof v === "boolean"
            ? (v
                ? (invertTruth
                    ? <X size={14} weight="bold" className="inline text-[#EF4444]/70" aria-label="included" />
                    : <Check size={14} weight="bold" className="inline text-[#22C55E]/80" aria-label="included" />)
                : (invertTruth
                    ? <Check size={14} weight="bold" className="inline text-[#22C55E]/80" aria-label="not included" />
                    : <X size={14} weight="bold" className="inline text-cream/25" aria-label="not included" />)
              )
            : <span className="font-mono text-[12.5px] tabular-nums text-cream/80">{v}</span>
          }
        </div>
      ))}
    </div>
  );
}
