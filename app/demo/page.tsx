"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cdnUrl } from "@/lib/cdn";
import { absoluteUrl } from "@/lib/site-config";
import {
  Brain,
  Trophy,
  Sparkle,
  ChartLineUp,
  Users,
  ArrowRight,
  Lightning,
  CheckCircle,
  Fire,
  Crown,
  PencilSimpleLine,
  Coins,
} from "@phosphor-icons/react";

const FANG_ICON = cdnUrl("/F.png");

const SECTIONS = [
  {
    eyebrow: "ONE",
    label: "DASHBOARD",
    title: "EARN FANGS FROM STUDYING",
    body: "Every focused minute pays. Hit your daily target, stack streaks, and watch Fangs compound. Cash out at $5 or burn them on power-ups inside the platform.",
    mockup: "dashboard",
  },
  {
    eyebrow: "TWO",
    label: "MASTERY MODE",
    title: "MASTER WHAT COUNTS",
    body: "Pick a topic, drop it in, and Ninny teaches plus quizzes you until the bar hits 100%. AP Bio, AWS Sec Specialty, your econ midterm, your choice.",
    mockup: "mastery",
  },
  {
    eyebrow: "THREE",
    label: "WORD BANKS",
    title: "VOCAB THAT COMPOUNDS",
    body: "Spaced-repetition review queue for every term you save. Rate your confidence, the system schedules the next look. The hard ones come back. The easy ones rest.",
    mockup: "wordbank",
  },
  {
    eyebrow: "FOUR",
    label: "PARTY",
    title: "PLAY WITH FRIENDS",
    body: "Sketchy Subjects and Bluff Trivia in real time. Spin up a room, drop the link in the group chat, study by laughing at each other. No app install needed.",
    mockup: "party",
  },
  {
    eyebrow: "FIVE",
    label: "LEADERBOARD",
    title: "LIVE LADDER",
    body: "Global ranks update in real time. Climb the podium on weekly Fangs earned, daily streak, and Mastery progress. Receipts for the grind, settled out loud.",
    mockup: "leaderboard",
  },
] as const;

type SectionKey = (typeof SECTIONS)[number]["mockup"];

export default function DemoPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lionade",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web, iOS",
    description:
      "Study app that pays you for focused minutes. Earn Fangs from studying, master any topic with AI tutoring, build vocab with spaced repetition, and compete on a live leaderboard.",
    url: absoluteUrl("/demo"),
    image: cdnUrl("/logo-full.png"),
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.8",
      ratingCount: "240",
    },
    publisher: {
      "@type": "Organization",
      name: "Lionade",
      url: absoluteUrl("/"),
    },
  };

  return (
    <div className="min-h-screen pt-24 pb-12 relative overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <BackgroundLayer />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <Hero />

        <div className="mt-20 sm:mt-28 space-y-24 sm:space-y-32">
          {SECTIONS.map((section, i) => (
            <TourSection
              key={section.mockup}
              section={section}
              index={i}
              flipped={i % 2 === 1}
            />
          ))}
        </div>

        <CtaStripe />

        <FooterMicro />
      </div>
    </div>
  );
}

function BackgroundLayer() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 opacity-25 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(74,144,217,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.07) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 30%, black 0%, transparent 80%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-[10%] left-[15%] w-[420px] h-[420px] rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(74,144,217,0.6) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-[55%] right-[8%] w-[380px] h-[380px] rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(240,180,41,0.55) 0%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute bottom-[5%] left-[30%] w-[360px] h-[360px] rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle, rgba(168,85,247,0.5) 0%, transparent 70%)",
        }}
      />
    </>
  );
}

function Hero() {
  return (
    <header className="text-center animate-slide-up">
      <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-gold/75 mb-5">
        NO SIGN UP REQUIRED
      </p>
      <h1 className="font-bebas text-6xl sm:text-7xl md:text-8xl tracking-wider leading-[0.92]">
        <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
          SEE LIONADE IN ACTION
        </span>
      </h1>
      <p className="mt-7 max-w-2xl mx-auto text-cream/65 text-base sm:text-lg leading-relaxed">
        Five looks at the surfaces grinders actually use. Real layouts, real numbers, no demo loop. Scroll, peek, decide for yourself.
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/login?signup=true"
          className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 active:scale-[0.98]"
          style={{
            background:
              "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
            color: "#04080F",
            boxShadow: "0 4px 22px rgba(240,180,41,0.32)",
          }}
        >
          Start free
          <ArrowRight size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
        <Link
          href="/demo/quiz"
          className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-electric/30 text-cream/80 hover:text-cream hover:border-electric/60 font-semibold text-sm transition-all duration-200"
        >
          Try the live quiz
        </Link>
      </div>

      <div className="mt-10 inline-flex items-center gap-5 text-[11px] font-mono uppercase tracking-[0.24em] text-cream/55">
        <span><span className="text-gold">FREE</span> TO START</span>
        <span className="h-3 w-px bg-cream/15" />
        <span>WEB + IOS</span>
        <span className="h-3 w-px bg-cream/15" />
        <span>NO CARD</span>
      </div>
    </header>
  );
}

function TourSection({
  section,
  index,
  flipped,
}: {
  section: (typeof SECTIONS)[number];
  index: number;
  flipped: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    if (mq?.matches) {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            break;
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition:
          "opacity 700ms ease-out, transform 700ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        willChange: "opacity, transform",
      }}
    >
      <div className={flipped ? "lg:order-2" : "lg:order-1"}>
        <Mockup kind={section.mockup} />
      </div>

      <div className={flipped ? "lg:order-1" : "lg:order-2"}>
        <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-gold/70 mb-3">
          {section.eyebrow} <span className="text-cream/55 mx-2">/</span> <span className="text-electric/80">{section.label}</span>
        </p>
        <h2 className="font-bebas text-5xl sm:text-6xl tracking-wider leading-[0.95] text-cream">
          {section.title}
        </h2>
        <p className="mt-5 text-cream/65 text-base sm:text-lg leading-relaxed max-w-xl">
          {section.body}
        </p>

        <div className="mt-7 flex items-center gap-3 text-[11px] font-mono tracking-[0.22em] uppercase text-cream/55">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-electric/10 text-electric font-bold tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span>OF {String(SECTIONS.length).padStart(2, "0")}</span>
        </div>
      </div>
    </section>
  );
}

function Mockup({ kind }: { kind: SectionKey }) {
  switch (kind) {
    case "dashboard":
      return <DashboardMockup />;
    case "mastery":
      return <MasteryMockup />;
    case "wordbank":
      return <WordBankMockup />;
    case "party":
      return <PartyMockup />;
    case "leaderboard":
      return <LeaderboardMockup />;
  }
}

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative rounded-3xl border border-electric/20 overflow-hidden ${className}`}
      style={{
        background:
          "linear-gradient(135deg, rgba(10,16,32,0.92) 0%, rgba(6,12,24,0.92) 100%)",
        boxShadow:
          "0 24px 70px -28px rgba(74,144,217,0.35), 0 2px 0 rgba(255,255,255,0.04) inset",
      }}
    >
      <div
        aria-hidden
        className="absolute top-0 left-0 h-full w-[3px]"
        style={{
          background:
            "linear-gradient(180deg, rgba(240,180,41,0.55) 0%, rgba(74,144,217,0.55) 100%)",
        }}
      />
      {children}
    </div>
  );
}

function FangIcon({ size = 14 }: { size?: number }) {
  return (
    <img
      src={FANG_ICON}
      alt=""
      width={size}
      height={size}
      className="inline-block align-[-2px]"
      style={{ filter: "drop-shadow(0 0 6px rgba(240,180,41,0.4))" }}
    />
  );
}

function DashboardMockup() {
  return (
    <GlassCard className="p-6 sm:p-7">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-electric/15 flex items-center justify-center">
            <Brain size={18} weight="fill" className="text-electric" aria-hidden="true" />
          </div>
          <span className="font-bebas text-lg text-cream tracking-wider">DASHBOARD</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-400/10 border border-orange-400/25">
          <Fire size={14} weight="fill" className="text-orange-400 animate-streak-fire" aria-hidden="true" />
          <span className="text-orange-300 text-xs font-bold">14 DAY STREAK</span>
        </div>
      </div>

      <div className="rounded-2xl p-5 mb-4 border border-gold/30 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(240,180,41,0.16) 0%, rgba(184,150,12,0.10) 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-50"
          style={{ background: "radial-gradient(circle, #F0B429 0%, transparent 70%)" }}
        />
        <p className="text-gold/70 text-[10px] font-mono tracking-[0.28em] uppercase mb-1.5">Total Fangs</p>
        <div className="flex items-baseline gap-2">
          <span className="font-bebas text-5xl text-gold tracking-wider tabular-nums">
            12,840
          </span>
          <FangIcon size={22} />
        </div>
        <p className="text-cream/55 text-xs mt-1.5">Worth $12.84 in cash payout</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl border border-electric/20 p-4 bg-electric/5">
          <p className="text-cream/55 text-[10px] font-mono tracking-[0.24em] uppercase mb-1">Today</p>
          <p className="font-bebas text-2xl text-cream tracking-wider">47<span className="text-cream/55 text-base ml-1">MIN</span></p>
          <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-electric" style={{ width: "78%" }} />
          </div>
        </div>
        <div className="rounded-xl border border-green-400/20 p-4 bg-green-400/5">
          <p className="text-cream/55 text-[10px] font-mono tracking-[0.24em] uppercase mb-1">This Week</p>
          <p className="font-bebas text-2xl text-cream tracking-wider">5/7<span className="text-cream/55 text-base ml-1">DAYS</span></p>
          <div className="mt-2 flex gap-1">
            {[1, 1, 1, 1, 1, 0, 0].map((d, i) => (
              <div
                key={i}
                className={`flex-1 h-1.5 rounded-full ${d ? "bg-green-400" : "bg-white/10"}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="w-full py-3 rounded-xl font-bold text-sm text-center"
        style={{
          background:
            "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
          color: "#04080F",
          boxShadow: "0 4px 18px rgba(240,180,41,0.30)",
        }}
      >
        CLAIM TODAY&apos;S BONUS
      </div>
    </GlassCard>
  );
}

function MasteryMockup() {
  return (
    <GlassCard className="p-6 sm:p-7">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <Sparkle size={18} weight="fill" className="text-purple-400" aria-hidden="true" />
          </div>
          <div>
            <span className="font-bebas text-lg text-cream tracking-wider">MASTERY MODE</span>
            <p className="text-cream/55 text-[10px] font-mono tracking-[0.22em] uppercase">AWS SEC SPECIALTY</p>
          </div>
        </div>
        <span className="text-purple-300 text-xs font-bold tabular-nums">47%</span>
      </div>

      <div className="h-2 rounded-full bg-white/8 overflow-hidden mb-5">
        <div
          className="h-full rounded-full"
          style={{
            width: "47%",
            background:
              "linear-gradient(90deg, #4A90D9 0%, #A855F7 100%)",
            boxShadow: "0 0 14px rgba(168,85,247,0.5)",
          }}
        />
      </div>

      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-400/30 flex items-center justify-center flex-shrink-0">
            <Sparkle size={14} weight="fill" className="text-purple-300" aria-hidden="true" />
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-white/5 border border-white/8 px-4 py-3 max-w-[85%]">
            <p className="text-cream/85 text-sm leading-relaxed">
              IAM policy evaluation has a strict order. <span className="text-purple-300 font-semibold">Explicit deny</span> always wins. After that, an explicit allow grants the action. Default is deny. Want a scenario?
            </p>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <div className="rounded-2xl rounded-tr-sm bg-electric/12 border border-electric/25 px-4 py-3 max-w-[80%]">
            <p className="text-electric text-sm leading-relaxed font-medium">
              Yeah, hit me with a tricky one
            </p>
          </div>
          <div className="w-8 h-8 rounded-full bg-electric/15 border border-electric/30 flex items-center justify-center flex-shrink-0">
            <span className="text-electric text-xs font-bold">YOU</span>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-400/30 flex items-center justify-center flex-shrink-0">
            <Sparkle size={14} weight="fill" className="text-purple-300" aria-hidden="true" />
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-white/5 border border-white/8 px-4 py-3 max-w-[85%]">
            <p className="text-cream/85 text-sm leading-relaxed">
              SCP denies S3 PutObject on the OU. The role&apos;s identity policy allows it. The bucket policy explicitly allows the role. Can the role write?
            </p>
            <div className="mt-2.5 flex items-center gap-1.5 text-[10px] font-mono tracking-[0.2em] uppercase text-purple-300/70">
              <Lightning size={10} weight="fill" aria-hidden="true" />
              <span>QUIZ DROP</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-white/8 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-cream/50">
          <CheckCircle size={14} weight="fill" className="text-green-400" aria-hidden="true" />
          <span>28 of 60 concepts mastered</span>
        </div>
        <span className="text-cream/55 font-mono tracking-wider">~ 4 HRS LEFT</span>
      </div>
    </GlassCard>
  );
}

function WordBankMockup() {
  return (
    <GlassCard className="p-6 sm:p-7">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-electric/15 flex items-center justify-center">
            <PencilSimpleLine size={18} weight="fill" className="text-electric" aria-hidden="true" />
          </div>
          <span className="font-bebas text-lg text-cream tracking-wider">WORD BANK REVIEW</span>
        </div>
        <span className="text-cream/55 text-[10px] font-mono tracking-[0.22em] uppercase">3 OF 12 DUE</span>
      </div>

      <div className="rounded-2xl p-6 mb-4 text-center relative overflow-hidden border border-electric/15"
        style={{
          background:
            "linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(10,16,32,0.6) 100%)",
        }}
      >
        <p className="font-mono text-[10px] tracking-[0.32em] uppercase text-electric/70 mb-3">TERM</p>
        <p className="font-bebas text-4xl text-cream tracking-wider mb-1">LOAD BALANCER</p>
        <p className="text-cream/55 text-xs">Networking · saved 9 days ago</p>

        <div className="my-5 h-px w-16 bg-gradient-to-r from-transparent via-electric/40 to-transparent mx-auto" />

        <p className="text-cream/85 text-sm leading-relaxed max-w-sm mx-auto">
          What does it mean?
        </p>
        <p className="text-cream/55 text-xs mt-2">Tap to flip and rate your confidence</p>
      </div>

      <p className="text-cream/55 text-[10px] font-mono tracking-[0.28em] uppercase text-center mb-3">HOW WELL DID YOU KNOW IT?</p>
      <div className="grid grid-cols-3 gap-2.5">
        <div aria-hidden="true" className="py-3 rounded-xl border border-red-400/25 bg-red-400/8 text-red-300 text-xs font-bold tracking-wider text-center">
          AGAIN
          <span className="block text-[9px] font-mono text-red-300/60 mt-0.5 tracking-widest">&lt; 1 MIN</span>
        </div>
        <div aria-hidden="true" className="py-3 rounded-xl border border-yellow-400/25 bg-yellow-400/8 text-yellow-300 text-xs font-bold tracking-wider text-center">
          HARD
          <span className="block text-[9px] font-mono text-yellow-300/60 mt-0.5 tracking-widest">~ 6 HRS</span>
        </div>
        <div aria-hidden="true" className="py-3 rounded-xl border border-green-400/25 bg-green-400/8 text-green-300 text-xs font-bold tracking-wider text-center">
          EASY
          <span className="block text-[9px] font-mono text-green-300/60 mt-0.5 tracking-widest">~ 4 DAYS</span>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-white/8 flex items-center justify-between text-xs">
        <span className="text-cream/50 inline-flex items-center gap-1.5">
          <FangIcon />
          <span><span className="text-gold font-bold">+8</span> per review</span>
        </span>
        <span className="text-cream/55 font-mono tracking-wider">RETENTION 94%</span>
      </div>
    </GlassCard>
  );
}

function PartyMockup() {
  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-pink-500/15 flex items-center justify-center">
            <Users size={18} weight="fill" className="text-pink-400" aria-hidden="true" />
          </div>
          <div>
            <span className="font-bebas text-lg text-cream tracking-wider">SKETCHY SUBJECTS</span>
            <p className="text-cream/55 text-[10px] font-mono tracking-[0.22em] uppercase">ROOM LION 9X4Q</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/15 border border-red-400/30">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
          <span className="text-red-300 text-[10px] font-bold tracking-wider">LIVE</span>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_140px] gap-3">
        <div
          className="aspect-[4/3] rounded-2xl border border-white/10 relative overflow-hidden"
          style={{
            background:
              "linear-gradient(180deg, #f8f5ec 0%, #ece7d6 100%)",
          }}
        >
          <div className="absolute top-2.5 left-3 text-[10px] font-mono tracking-[0.24em] uppercase text-navy/50">
            SUBJECT: PHOTOSYNTHESIS
          </div>
          <svg className="w-full h-full" viewBox="0 0 320 240" preserveAspectRatio="none" aria-hidden="true">
            <circle cx="80" cy="80" r="22" fill="none" stroke="#F0B429" strokeWidth="3" />
            <path d="M 80 102 Q 80 140 80 170" stroke="#3A8A4E" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M 80 130 Q 50 120 40 100" stroke="#3A8A4E" strokeWidth="3" fill="none" strokeLinecap="round" />
            <ellipse cx="38" cy="98" rx="12" ry="8" fill="#5BB371" stroke="#3A8A4E" strokeWidth="2" />
            <path d="M 80 145 Q 115 138 128 115" stroke="#3A8A4E" strokeWidth="3" fill="none" strokeLinecap="round" />
            <ellipse cx="130" cy="113" rx="12" ry="8" fill="#5BB371" stroke="#3A8A4E" strokeWidth="2" />
            <path d="M 200 50 L 195 65 M 220 60 L 222 78 M 240 50 L 235 70" stroke="#F0B429" strokeWidth="3" strokeLinecap="round" />
            <text x="160" y="210" fontFamily="Comic Sans MS, cursive" fontSize="16" fill="#4A90D9" textAnchor="middle">CO2 + H2O</text>
            <path d="M 230 165 L 260 175 L 250 168 M 260 175 L 252 182" stroke="#4A90D9" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <text x="285" y="178" fontFamily="Comic Sans MS, cursive" fontSize="13" fill="#3A8A4E">O2</text>
          </svg>
          <div className="absolute bottom-2.5 left-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-navy/85 border border-electric/30">
            <span className="text-electric text-[10px] font-mono tracking-widest">CHEN drawing</span>
          </div>
          <div className="absolute bottom-2.5 right-3 text-[10px] font-mono tabular-nums px-2 py-1 rounded-md bg-navy/85 text-gold border border-gold/30">
            0:42
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-cream/55 text-[10px] font-mono tracking-[0.24em] uppercase mb-1">ROOM</p>
          {[
            { name: "Chen", points: 1840, status: "drawing", color: "#F0B429" },
            { name: "Riya", points: 1620, status: "guessed", color: "#4ade80" },
            { name: "Sam", points: 1380, status: "guessing", color: "#4A90D9" },
            { name: "Mo", points: 980, status: "guessing", color: "#A855F7" },
          ].map((p) => (
            <div
              key={p.name}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/4 border border-white/8"
            >
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold"
                style={{ background: `${p.color}22`, color: p.color }}
              >
                {p.name[0]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-cream/85 text-[11px] font-semibold leading-tight truncate">{p.name}</p>
                <p className="text-cream/55 text-[9px] font-mono tabular-nums">{p.points.toLocaleString()}</p>
              </div>
              {p.status === "guessed" && (
                <CheckCircle size={12} weight="fill" className="text-green-400" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between text-xs">
        <span className="text-cream/50">Round 3 of 5</span>
        <span className="text-cream/55 inline-flex items-center gap-1.5">
          <FangIcon />
          <span><span className="text-gold font-bold">+120</span> if you guess first</span>
        </span>
      </div>
    </GlassCard>
  );
}

function LeaderboardMockup() {
  const podium = [
    { rank: 2, name: "RIYA P.", fangs: 18420, school: "MIT", color: "#C0C0C0", h: 64 },
    { rank: 1, name: "CHEN W.", fangs: 24180, school: "Stanford", color: "#F0B429", h: 92 },
    { rank: 3, name: "MO A.", fangs: 15740, school: "UT Austin", color: "#CD7F32", h: 48 },
  ];

  return (
    <GlassCard className="p-6 sm:p-7">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gold/15 flex items-center justify-center">
            <Trophy size={18} weight="fill" className="text-gold" aria-hidden="true" />
          </div>
          <div>
            <span className="font-bebas text-lg text-cream tracking-wider">GLOBAL LADDER</span>
            <p className="text-cream/55 text-[10px] font-mono tracking-[0.22em] uppercase">WEEKLY FANGS</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-500/15 border border-green-400/30">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-green-300 text-[10px] font-bold tracking-wider">LIVE</span>
        </div>
      </div>

      <div className="flex items-end justify-center gap-3 mb-5 pt-2">
        {podium.map((p) => (
          <div key={p.name} className="flex flex-col items-center w-1/3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-2 border-2"
              style={{
                background: `linear-gradient(135deg, ${p.color}40 0%, ${p.color}15 100%)`,
                borderColor: `${p.color}80`,
                boxShadow: p.rank === 1 ? `0 0 18px ${p.color}60` : "none",
              }}
            >
              {p.rank === 1 ? (
                <Crown size={20} weight="fill" style={{ color: p.color }} aria-hidden="true" />
              ) : (
                <span className="font-bebas text-lg" style={{ color: p.color }}>{p.rank}</span>
              )}
            </div>
            <p className="font-bebas text-cream text-sm tracking-wider text-center truncate w-full">{p.name}</p>
            <p className="text-cream/55 text-[10px] font-mono tracking-wider truncate w-full text-center">{p.school}</p>
            <div className="inline-flex items-center gap-1 text-xs font-bold tabular-nums mt-1" style={{ color: p.color }}>
              {p.fangs.toLocaleString()}
              <FangIcon size={11} />
            </div>
            <div
              className="w-full mt-2 rounded-t-lg border-t border-x"
              style={{
                height: p.h,
                background: `linear-gradient(180deg, ${p.color}30 0%, ${p.color}08 100%)`,
                borderColor: `${p.color}40`,
              }}
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {[
          { rank: 4, name: "SAM C.", fangs: 12840, you: true },
          { rank: 5, name: "JADA L.", fangs: 11320, you: false },
          { rank: 6, name: "AKIRA T.", fangs: 10580, you: false },
        ].map((p) => (
          <div
            key={p.name}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border ${
              p.you
                ? "bg-electric/10 border-electric/40"
                : "bg-white/4 border-white/8"
            }`}
          >
            <span className="font-bebas text-sm tabular-nums text-cream/60 w-6">#{p.rank}</span>
            <span className="flex-1 text-cream/85 text-sm font-semibold">
              {p.name}
              {p.you && (
                <span className="ml-2 text-[9px] font-mono tracking-[0.24em] text-electric uppercase">YOU</span>
              )}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-bold tabular-nums text-gold">
              {p.fangs.toLocaleString()}
              <FangIcon size={11} />
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-white/8 flex items-center justify-between text-xs">
        <span className="text-cream/50 inline-flex items-center gap-1.5">
          <ChartLineUp size={14} weight="bold" className="text-electric" aria-hidden="true" />
          <span>Resets in 2d 14h</span>
        </span>
        <span className="text-cream/55 font-mono tracking-wider">12,408 GRINDERS</span>
      </div>
    </GlassCard>
  );
}

function CtaStripe() {
  return (
    <div className="mt-28 sm:mt-32 relative">
      <div
        className="relative rounded-3xl border border-gold/30 overflow-hidden text-center p-10 sm:p-14"
        style={{
          background:
            "linear-gradient(135deg, rgba(240,180,41,0.12) 0%, rgba(74,144,217,0.10) 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute -top-20 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-3xl opacity-50 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse, rgba(240,180,41,0.35) 0%, transparent 70%)",
          }}
        />
        <div className="relative">
          <p className="font-mono text-[11px] tracking-[0.32em] uppercase text-gold/80 mb-4">
            <Coins size={14} weight="fill" className="inline-block align-[-2px] mr-1.5 text-gold" aria-hidden="true" />
            START FREE
          </p>
          <h2 className="font-bebas text-6xl sm:text-7xl tracking-wider leading-[0.9]">
            <span className="bg-gradient-to-r from-gold via-[#F0B429] to-electric bg-clip-text text-transparent">
              READY TO GRIND?
            </span>
          </h2>
          <p className="mt-5 max-w-xl mx-auto text-cream/65 text-base sm:text-lg leading-relaxed">
            Start free. Upgrade if you love it. Cash out the first $5 you stack.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/login?signup=true"
              className="group inline-flex items-center gap-2 px-9 py-4 rounded-xl font-bold text-base transition-all duration-200 active:scale-[0.98]"
              style={{
                background:
                  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
                boxShadow: "0 10px 32px rgba(240,180,41,0.40)",
              }}
            >
              Create your account
              <ArrowRight size={18} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-xl border border-cream/15 text-cream/75 hover:text-cream hover:border-cream/35 font-semibold text-sm transition-all duration-200"
            >
              See pricing
            </Link>
          </div>

          <p className="mt-7 text-[11px] font-mono tracking-[0.24em] uppercase text-cream/55">
            NO CARD <span className="text-cream/20 mx-2">·</span> CASH OUT AT $5 <span className="text-cream/20 mx-2">·</span> CANCEL ANY TIME
          </p>
        </div>
      </div>
    </div>
  );
}

function FooterMicro() {
  return (
    <div className="mt-10 text-center">
      <p className="text-cream/55 text-xs">
        Already have an account?{" "}
        <Link href="/login" className="text-electric hover:text-electric-light transition-colors font-semibold">
          Log in
        </Link>
      </p>
    </div>
  );
}
