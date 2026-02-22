"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const DEVOPS_PASSWORD = "LionadeDevOps2026";

const STEPS = [
  {
    num: "01",
    icon: "\uD83C\uDFAF",
    title: "Clock In Daily",
    desc: 'Open Lionade and start your <strong class="text-electric">Daily Grind</strong> \u2014 AI-generated quizzes in your subject. Every correct answer adds to your streak and your bag.',
  },
  {
    num: "02",
    icon: "\u2694\uFE0F",
    title: "Duel & Compete",
    desc: 'Challenge anyone to a <strong class="text-electric">1v1 match</strong> or enter weekly team tournaments. The more you win, the higher you climb \u2014 and the more you earn.',
  },
  {
    num: "03",
    icon: "\uD83D\uDCB0",
    title: "Stack Rewards",
    desc: 'Top performers earn <strong class="text-electric">real rewards</strong>. Coins, badges, and eventually real cash payouts \u2014 because your study time is worth something.',
  },
  {
    num: "04",
    icon: "\uD83C\uDFC6",
    title: "Get Promoted",
    desc: 'Rank up high enough and <strong class="text-electric">unlock tutoring</strong> \u2014 set your rate, help others, and earn a second income stream from your knowledge.',
  },
];

const FEATURES = [
  {
    icon: "\uD83E\uDD16",
    title: "AI-Powered Questions",
    desc: "Every quiz adapts to your level in real time. The harder you grind, the harder it gets \u2014 and the more you earn.",
  },
  {
    icon: "\uD83D\uDCDA",
    title: "Every Subject Covered",
    desc: "Math, Science, Languages, SAT/ACT, Coding, Finance, AWS, CompTIA and more. If it can be tested, it\u2019s in Lionade.",
  },
  {
    icon: "\uD83D\uDD25",
    title: "Streak Culture",
    desc: "Your streak is your attendance record. Maintain it, flex it, and watch your rewards multiply the longer you stay consistent.",
  },
  {
    icon: "\uD83D\uDC65",
    title: "Team Leagues",
    desc: "Form a squad with your friends and go head-to-head against other teams in weekly tournaments with prize pools on the line.",
  },
  {
    icon: "\uD83C\uDF0D",
    title: "For Everyone",
    desc: "Whether you\u2019re 16 prepping for the SAT or 35 chasing a cloud cert \u2014 Lionade works for every learner at every stage.",
  },
  {
    icon: "\uD83D\uDCF1",
    title: "Web First",
    desc: "No app download needed. Open your browser, clock in, and start grinding. Available anywhere, anytime.",
  },
];

const SNEAK_PEEKS = [
  {
    tag: "// Dashboard",
    title: "YOUR COMMAND CENTER",
    desc: "See your coins, streak, XP, level, and daily progress all in one place. The dashboard tracks everything so you know exactly where you stand.",
    items: [
      { icon: "\uD83E\uDE99", label: "Coin balance + transaction history" },
      { icon: "\uD83D\uDD25", label: "Current streak & best streak" },
      { icon: "\uD83D\uDCC8", label: "XP progress bar to next level" },
      { icon: "\uD83C\uDFAF", label: "Daily missions & bonus challenges" },
    ],
  },
  {
    tag: "// Quiz Engine",
    title: "SMART QUIZZES THAT ADAPT",
    desc: "No two sessions are the same. Questions adjust to your skill level in real time \u2014 answer correctly and the difficulty ramps up, increasing your coin rewards.",
    items: [
      { icon: "\u23F1\uFE0F", label: "Timed questions with countdown" },
      { icon: "\uD83E\uDDE0", label: "Difficulty scales with your level" },
      { icon: "\uD83D\uDCA1", label: "Instant explanations after each answer" },
      { icon: "\uD83D\uDCB0", label: "Harder questions = bigger coin drops" },
    ],
  },
  {
    tag: "// 1v1 Duels",
    title: "HEAD-TO-HEAD BATTLES",
    desc: "Challenge anyone to a real-time knowledge duel. Pick the subject, wager your coins, and go head-to-head. Winner takes the pot.",
    items: [
      { icon: "\u2694\uFE0F", label: "Real-time 1v1 matchmaking" },
      { icon: "\uD83E\uDE99", label: "Coin wager system" },
      { icon: "\uD83C\uDFC6", label: "Win streaks & duel rankings" },
      { icon: "\uD83D\uDCAC", label: "Challenge friends by username" },
    ],
  },
];

const SUBJECTS = [
  { icon: "\uD83E\uDDEE", name: "Math", desc: "Algebra to calculus" },
  { icon: "\uD83E\uDD2C", name: "Science", desc: "Physics, chem, bio" },
  { icon: "\uD83C\uDF0D", name: "Languages", desc: "Spanish, French +" },
  { icon: "\uD83D\uDCDD", name: "SAT / ACT", desc: "Full test prep" },
  { icon: "\uD83D\uDCBB", name: "Coding", desc: "Python, JS, DSA" },
  { icon: "\uD83D\uDCB5", name: "Finance", desc: "Investing, markets" },
  { icon: "\uD83D\uDD10", name: "Certifications", desc: "CompTIA, AWS" },
  { icon: "\u2795", name: "More Coming", desc: "Request subjects" },
];

const ROADMAP = [
  { phase: "Q1 2026", title: "Private Beta", desc: "Core quiz engine, daily streaks, coin system, and basic profiles. Invite-only access for waitlist members.", status: "active" },
  { phase: "Q2 2026", title: "1v1 Duels Launch", desc: "Real-time head-to-head matches, coin wagering, duel rankings, and friend challenges go live.", status: "upcoming" },
  { phase: "Q3 2026", title: "Team Leagues", desc: "Squad-based tournaments, weekly prize pools, team leaderboards, and crew chat.", status: "upcoming" },
  { phase: "Q4 2026", title: "Cash Payouts", desc: "Top performers can convert earned coins to real cash. Tutoring marketplace unlocks for high-rank users.", status: "upcoming" },
];

const FAQ = [
  { q: "Is Lionade actually free?", a: "Yes. Free to join, free to play, free forever. We\u2019ll never charge you to study. Revenue comes from optional premium features and sponsors \u2014 not your wallet." },
  { q: "How do I earn coins?", a: "Every correct answer on a quiz earns coins. Harder questions pay more. Maintaining a daily streak gives bonus multipliers, and winning 1v1 duels pays out the wagered coins." },
  { q: "What subjects are available?", a: "Math, Science, Languages, SAT/ACT prep, Coding, Finance, and IT Certifications (CompTIA, AWS). We\u2019re adding more based on community requests." },
  { q: "Can I actually cash out?", a: "That\u2019s the plan. Our roadmap targets Q4 2026 for real cash conversions. Early users who stack coins now will be first in line when payouts go live." },
  { q: "How are questions generated?", a: "We use a mix of expert-curated question banks and AI-generated content that adapts to your skill level. Every session is unique." },
  { q: "When does the beta launch?", a: "Private beta is rolling out Q1 2026 to waitlist members. The earlier you sign up, the sooner you get access." },
];

const TICKER_ITEMS = [
  { text: "Clock In", accent: false },
  { text: "\uD83E\uDD81 Level Up", accent: true },
  { text: "Your Knowledge", accent: false },
  { text: "\u26A1 Your Check", accent: true },
  { text: "Study Hard", accent: false },
  { text: "\uD83D\uDCB0 Get Paid", accent: true },
  { text: "Daily Grind", accent: false },
  { text: "\uD83D\uDD25 Real Rewards", accent: true },
];

export default function ComingSoonPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const [modalOpen, setModalOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);

  // Waitlist state (hero form)
  const [email1, setEmail1] = useState("");
  const [status1, setStatus1] = useState<"idle" | "loading" | "success" | "error" | "duplicate">("idle");
  const [msg1, setMsg1] = useState("");

  // Waitlist state (bottom CTA form)
  const [email2, setEmail2] = useState("");
  const [status2, setStatus2] = useState<"idle" | "loading" | "success" | "error" | "duplicate">("idle");
  const [msg2, setMsg2] = useState("");

  const clickCountRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Redirect logged-in users to dashboard
  useEffect(() => {
    if (!isLoading && user) {
      router.push("/dashboard");
    }
  }, [user, isLoading, router]);

  // Scroll reveal — runs after first render when DOM exists
  useEffect(() => {
    // Small delay to ensure DOM is painted
    const timer = setTimeout(() => {
      const reveals = document.querySelectorAll(".reveal");
      if (!reveals.length) return;

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0, rootMargin: "0px 0px 150px 0px" }
      );
      reveals.forEach((el) => observer.observe(el));

      return () => observer.disconnect();
    }, 100);

    return () => clearTimeout(timer);
  }, [isLoading, user]);

  useEffect(() => {
    if (modalOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [modalOpen]);

  const handleSecretClick = () => {
    clickCountRef.current += 1;
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0;
      setPw("");
      setError(false);
      setSuccess(false);
      setModalOpen(true);
      return;
    }
    resetTimerRef.current = window.setTimeout(() => {
      clickCountRef.current = 0;
    }, 1500);
  };

  const closeModal = () => {
    setModalOpen(false);
    setPw("");
    setError(false);
    setSuccess(false);
  };

  const handleDevOpsSubmit = () => {
    if (pw === DEVOPS_PASSWORD) {
      setError(false);
      setSuccess(true);
      localStorage.setItem("lionade_beta_access", "true");
      return;
    }
    setError(true);
    setSuccess(false);
    setPw("");
    window.setTimeout(() => closeModal(), 1200);
  };

  const submitWaitlist = async (
    email: string,
    setStatus: (s: "idle" | "loading" | "success" | "error" | "duplicate") => void,
    setMsg: (m: string) => void,
    setEmail: (e: string) => void
  ) => {
    const clean = email.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setStatus("error");
      setMsg("Please enter a valid email.");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: clean, source: "landing" }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("success");
        setMsg(data.message || "You\u2019re on the list!");
        setEmail("");
      } else if (res.status === 409) {
        setStatus("duplicate");
        setMsg(data.error || "You\u2019re already on the list!");
      } else {
        setStatus("error");
        setMsg(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMsg("Something went wrong.");
    }
  };

  if (isLoading || user) return null;

  const tickerContent = [...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className="min-h-screen bg-[#04080F] text-[#EEF4FF] overflow-x-hidden relative">
      {/* ─── Nav ──────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-6 sm:px-12 py-6"
        style={{ background: "linear-gradient(to bottom, rgba(8,8,8,0.9), transparent)" }}>
        <span className="font-bebas text-[28px] tracking-[3px] text-electric">LIONADE</span>
        <span className="font-mono text-[11px] tracking-[2px] uppercase text-electric/30">Coming Soon &mdash; 2026</span>
      </nav>

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="min-h-[100svh] flex flex-col items-center justify-center relative px-6 text-center pt-[120px] pb-20 overflow-hidden">
        {/* Orbs */}
        <div className="absolute w-[500px] h-[500px] rounded-full blur-[80px] -top-[100px] -left-[100px] pointer-events-none animate-[drift_8s_ease-in-out_infinite]"
          style={{ background: "radial-gradient(circle, rgba(74,144,217,0.15), transparent 70%)" }} />
        <div className="absolute w-[400px] h-[400px] rounded-full blur-[80px] -bottom-[50px] -right-[50px] pointer-events-none animate-[drift_8s_ease-in-out_infinite_-4s]"
          style={{ background: "radial-gradient(circle, rgba(74,144,217,0.1), transparent 70%)" }} />
        <div className="absolute w-[300px] h-[300px] rounded-full blur-[80px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none animate-[drift_8s_ease-in-out_infinite_-2s]"
          style={{ background: "radial-gradient(circle, rgba(122,184,245,0.08), transparent 70%)" }} />

        {/* Grid lines */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: "linear-gradient(rgba(74,144,217,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.05) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }} />

        {/* Ticker */}
        <div className="absolute top-[88px] left-0 right-0 overflow-hidden border-y border-electric/15 py-2"
          style={{ background: "rgba(74,144,217,0.04)" }}>
          <div className="ticker-track flex whitespace-nowrap">
            {tickerContent.map((item, i) => (
              <span key={i} className={`font-mono text-[10px] tracking-[3px] uppercase px-10 ${item.accent ? "text-electric" : "text-electric/20"}`}>
                {item.text}
              </span>
            ))}
          </div>
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-electric/[0.08] border border-electric/25 rounded-full px-5 py-2 font-mono text-[11px] tracking-[2px] uppercase text-electric mb-8 animate-[fadeUp_0.8s_ease_both]">
          <span className="w-1.5 h-1.5 bg-electric rounded-full animate-[pulse_2s_ease_infinite]" />
          <span>\uD83E\uDD81 Born from a grind &middot; Built for everyone</span>
        </div>

        {/* Headline */}
        <h1 className="font-bebas text-[clamp(72px,14vw,180px)] leading-[0.9] tracking-[2px] animate-[fadeUp_0.8s_ease_0.1s_both]">
          STUDY<br />
          <span className="text-electric">LIKE IT&apos;S</span><br />
          <span className="text-transparent" style={{ WebkitTextStroke: "2px #4A90D9" }}>YOUR JOB</span>
        </h1>

        {/* Subheadline */}
        <p className="mt-6 max-w-[560px] text-[clamp(16px,2.5vw,22px)] font-normal text-[#7A8FA6] leading-relaxed animate-[fadeUp_0.8s_ease_0.2s_both]">
          You already put in the hours. <strong className="text-[#EEF4FF] font-bold">Now get paid for them.</strong><br />
          Lionade is the platform that rewards your grind &mdash; daily quizzes, real competition, and actual cash for your knowledge.
        </p>

        {/* Stats */}
        <div className="flex gap-8 sm:gap-12 mt-12 flex-wrap justify-center animate-[fadeUp_0.8s_ease_0.3s_both]">
          {[
            { value: "\u221E", label: "Subjects" },
            { value: "$0", label: "To Join" },
            { value: "1V1", label: "Duels" },
            { value: "\uD83D\uDD25", label: "Daily Streaks" },
          ].map((stat, i, arr) => (
            <div key={stat.label} className="flex items-center gap-8 sm:gap-12">
              <div className="text-center">
                <div className="font-bebas text-[42px] text-electric leading-none">{stat.value}</div>
                <div className="font-mono text-[10px] tracking-[2px] uppercase text-[#7A8FA6] mt-1">{stat.label}</div>
              </div>
              {i < arr.length - 1 && (
                <div className="w-px self-stretch bg-electric/20 hidden sm:block" />
              )}
            </div>
          ))}
        </div>

        {/* Email Form */}
        <div className="mt-14 w-full max-w-[520px] animate-[fadeUp_0.8s_ease_0.4s_both]">
          <span className="font-mono text-[11px] tracking-[2px] uppercase text-electric/30 block mb-3">
            Join the waitlist &mdash; be first in line
          </span>

          {status1 !== "success" ? (
            <>
              <div className="flex bg-[#0D1526] border border-electric/20 rounded overflow-hidden focus-within:border-electric focus-within:shadow-[0_0_0_3px_rgba(74,144,217,0.08)] transition-all">
                <input
                  type="email"
                  value={email1}
                  onChange={(e) => { setEmail1(e.target.value); if (status1 !== "idle" && status1 !== "loading") setStatus1("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submitWaitlist(email1, setStatus1, setMsg1, setEmail1); }}
                  placeholder="your@email.com"
                  disabled={status1 === "loading"}
                  className="flex-1 bg-transparent border-none outline-none px-5 py-4 text-[#EEF4FF] font-syne text-[15px] placeholder:text-white/20"
                />
                <button
                  onClick={() => submitWaitlist(email1, setStatus1, setMsg1, setEmail1)}
                  disabled={status1 === "loading"}
                  className="bg-electric hover:bg-electric-light text-[#04080F] border-none px-7 py-4 font-bebas text-[18px] tracking-[2px] transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  {status1 === "loading" ? "..." : "LOCK IN"}
                </button>
              </div>
              {(status1 === "error" || status1 === "duplicate") && (
                <p className={`mt-3 font-mono text-[12px] tracking-[1px] ${status1 === "duplicate" ? "text-electric" : "text-red-400"}`}>
                  {msg1}
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3 px-6 py-4 bg-electric/[0.08] border border-electric/30 rounded font-mono text-[13px] tracking-[1px] text-electric">
              \u2705 You&apos;re on the list. We&apos;ll hit you when we drop. \uD83E\uDD81
            </div>
          )}
          <p className="font-mono text-[10px] text-white/20 tracking-[1px] mt-2.5">No spam. No cap. Just early access.</p>
        </div>

        {/* Scroll indicator */}
        <div className="mt-12 animate-[fadeUp_0.8s_ease_0.5s_both]">
          <a href="#how-it-works" className="flex flex-col items-center gap-2 text-electric/30 hover:text-electric/60 transition-colors">
            <span className="font-mono text-[10px] tracking-[2px] uppercase">Scroll to explore</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="animate-bounce">
              <path d="M10 4v12M4 10l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </section>

      {/* ─── How It Works ─────────────────────────────────────── */}
      <section id="how-it-works" className="max-w-[1100px] mx-auto px-6 sm:px-12 py-24 sm:py-32">
        <div className="reveal visible">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// How It Works</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16">
            YOUR DAILY<br /><span className="text-electric">GRIND</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[2px] reveal">
          {STEPS.map((step) => (
            <div key={step.num} className="group bg-[#080E1A] hover:bg-[#0D1526] p-8 sm:p-10 relative overflow-hidden transition-colors">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-electric to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="font-bebas text-[72px] leading-none text-electric/10 group-hover:text-electric/20 transition-colors mb-4">{step.num}</div>
              <div className="text-[28px] mb-4">{step.icon}</div>
              <div className="font-syne font-extrabold text-[20px] text-[#EEF4FF] mb-3">{step.title}</div>
              <div className="text-sm text-[#7A8FA6] leading-[1.7]" dangerouslySetInnerHTML={{ __html: step.desc }} />
            </div>
          ))}
        </div>
      </section>

      {/* ─── Features ─────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 pb-24 sm:pb-32">
        <div className="reveal visible">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// What You Get</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16">
            BUILT<br /><span className="text-electric">DIFFERENT</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[2px] reveal">
          {FEATURES.map((f) => (
            <div key={f.title} className="group bg-[#080E1A] hover:bg-[#0D1526] p-8 sm:p-10 border-l-2 border-transparent hover:border-electric transition-all">
              <span className="text-[32px] block mb-5">{f.icon}</span>
              <div className="font-syne font-extrabold text-[18px] text-[#EEF4FF] mb-2.5">{f.title}</div>
              <div className="text-sm text-[#7A8FA6] leading-[1.7]">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Sneak Peek ─────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-24 sm:py-32">
        <div className="reveal visible">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Sneak Peek</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-6">
            INSIDE<br /><span className="text-electric">THE APP</span>
          </h2>
          <p className="text-[#7A8FA6] text-base sm:text-lg max-w-[600px] leading-relaxed mb-16">
            Here&apos;s a look at what you&apos;ll get when you unlock your account. Every screen is designed to keep you grinding.
          </p>
        </div>

        <div className="space-y-4 reveal">
          {SNEAK_PEEKS.map((peek, idx) => (
            <div key={peek.tag} className={`group bg-[#080E1A] hover:bg-[#0D1526] p-8 sm:p-12 relative overflow-hidden transition-colors ${idx === 0 ? "border-l-2 border-electric" : "border-l-2 border-transparent hover:border-electric"}`}>
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-electric/20 to-transparent" />

              <div className="flex flex-col lg:flex-row gap-8 lg:gap-16">
                <div className="flex-1">
                  <p className="font-mono text-[10px] tracking-[3px] uppercase text-electric/40 mb-3">{peek.tag}</p>
                  <h3 className="font-bebas text-[clamp(28px,4vw,48px)] leading-[0.95] mb-4">{peek.title}</h3>
                  <p className="text-[#7A8FA6] text-sm leading-[1.7] max-w-md">{peek.desc}</p>
                </div>

                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {peek.items.map((item) => (
                    <div key={item.label} className="flex items-start gap-3 bg-[#04080F] rounded px-4 py-3 border border-electric/10 group-hover:border-electric/20 transition-colors">
                      <span className="text-xl mt-0.5">{item.icon}</span>
                      <span className="text-sm text-[#7A8FA6] leading-snug">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Subjects ─────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 pb-24 sm:pb-32">
        <div className="reveal visible">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Subjects</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16">
            PICK YOUR<br /><span className="text-electric">LANE</span>
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-[2px] reveal">
          {SUBJECTS.map((s) => (
            <div key={s.name} className="group bg-[#080E1A] hover:bg-[#0D1526] p-6 sm:p-8 text-center transition-colors relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-electric to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="text-[36px] block mb-3">{s.icon}</span>
              <div className="font-syne font-extrabold text-[16px] text-[#EEF4FF] mb-1">{s.name}</div>
              <div className="font-mono text-[10px] tracking-[1px] text-[#7A8FA6] uppercase">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Roadmap ──────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 pb-24 sm:pb-32">
        <div className="reveal visible">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Roadmap</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16">
            WHAT&apos;S<br /><span className="text-electric">COMING</span>
          </h2>
        </div>
        <div className="relative reveal">
          {/* Timeline line */}
          <div className="absolute left-4 sm:left-6 top-0 bottom-0 w-px bg-electric/15" />

          <div className="space-y-0">
            {ROADMAP.map((item) => (
              <div key={item.phase} className="relative pl-12 sm:pl-16 py-8 group">
                {/* Dot */}
                <div className={`absolute left-2.5 sm:left-4.5 top-10 w-3 h-3 rounded-full border-2 ${item.status === "active" ? "bg-electric border-electric shadow-[0_0_12px_rgba(74,144,217,0.5)]" : "bg-transparent border-electric/30"}`} />

                <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] tracking-[2px] uppercase text-electric/40 whitespace-nowrap">{item.phase}</span>
                    {item.status === "active" && (
                      <span className="font-mono text-[9px] tracking-[2px] uppercase bg-electric/15 text-electric px-2 py-0.5 rounded-full">Live</span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-syne font-extrabold text-[20px] text-[#EEF4FF] mb-2">{item.title}</h3>
                    <p className="text-sm text-[#7A8FA6] leading-[1.7] max-w-lg">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 pb-24 sm:pb-32">
        <div className="reveal visible">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// FAQ</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16">
            GOT<br /><span className="text-electric">QUESTIONS?</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[2px] reveal">
          {FAQ.map((item) => (
            <div key={item.q} className="bg-[#080E1A] hover:bg-[#0D1526] p-8 sm:p-10 transition-colors group">
              <h3 className="font-syne font-bold text-[16px] text-[#EEF4FF] mb-3 group-hover:text-electric transition-colors">{item.q}</h3>
              <p className="text-sm text-[#7A8FA6] leading-[1.7]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Big CTA ──────────────────────────────────────────── */}
      <section className="py-24 sm:py-32 px-6 text-center relative overflow-hidden">
        <span className="absolute font-bebas text-[300px] text-electric/[0.03] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap tracking-[20px] select-none">
          LIONADE
        </span>
        <h2 className="font-bebas text-[clamp(56px,10vw,130px)] leading-[0.95] relative reveal">
          STOP<br />STUDYING<br /><span className="text-electric">FOR FREE.</span>
        </h2>
        <div className="max-w-[520px] mx-auto mt-12 reveal">
          {status2 !== "success" ? (
            <>
              <div className="flex bg-[#0D1526] border border-electric/20 rounded overflow-hidden focus-within:border-electric focus-within:shadow-[0_0_0_3px_rgba(74,144,217,0.08)] transition-all">
                <input
                  type="email"
                  value={email2}
                  onChange={(e) => { setEmail2(e.target.value); if (status2 !== "idle" && status2 !== "loading") setStatus2("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submitWaitlist(email2, setStatus2, setMsg2, setEmail2); }}
                  placeholder="Drop your email, get early access"
                  disabled={status2 === "loading"}
                  className="flex-1 bg-transparent border-none outline-none px-5 py-4 text-[#EEF4FF] font-syne text-[15px] placeholder:text-white/20"
                />
                <button
                  onClick={() => submitWaitlist(email2, setStatus2, setMsg2, setEmail2)}
                  disabled={status2 === "loading"}
                  className="bg-electric hover:bg-electric-light text-[#04080F] border-none px-7 py-4 font-bebas text-[18px] tracking-[2px] transition-colors whitespace-nowrap disabled:opacity-60"
                >
                  {status2 === "loading" ? "..." : "LOCK IN"}
                </button>
              </div>
              {(status2 === "error" || status2 === "duplicate") && (
                <p className={`mt-3 font-mono text-[12px] tracking-[1px] ${status2 === "duplicate" ? "text-electric" : "text-red-400"}`}>
                  {msg2}
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3 px-6 py-4 bg-electric/[0.08] border border-electric/30 rounded font-mono text-[13px] tracking-[1px] text-electric">
              \u2705 You&apos;re on the list. We&apos;ll hit you when we drop. \uD83E\uDD81
            </div>
          )}
          <p className="font-mono text-[10px] text-white/20 tracking-[1px] mt-2.5">Free to join &middot; No credit card &middot; No cap</p>
        </div>
      </section>

      {/* ─── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-electric/10 px-6 sm:px-12 py-8 flex items-center justify-between flex-wrap gap-4">
        <span className="font-bebas text-[24px] tracking-[3px] text-electric">LIONADE</span>
        <span className="font-mono text-[10px] tracking-[2px] uppercase text-electric/30">\uD83E\uDD81 Where champions are made &mdash; 2026</span>
        <span className="font-mono text-[11px] tracking-[1px] text-white/20">&copy; 2026 getlionade.com &middot; All rights reserved</span>
      </footer>

      {/* ─── DevOps Secret Trigger ────────────────────────────── */}
      <div className="text-center py-2.5 bg-[#04080F]">
        <button
          id="devops-trigger"
          onClick={handleSecretClick}
          className="font-mono text-[10px] tracking-[1px] text-white/[0.08] hover:text-white/20 transition-colors select-none"
        >
          &copy; 2026 Lionade
        </button>
      </div>

      {/* ─── DevOps Modal ─────────────────────────────────────── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="bg-[#0D1526] border border-electric/25 rounded-lg p-10 w-full max-w-[400px] mx-6">
            <p className="font-mono text-[10px] tracking-[3px] uppercase text-electric/50 mb-3.5">// Internal Access</p>
            <h2 className="font-bebas text-[30px] tracking-[2px] text-[#EEF4FF] mb-7">DEVOPS LOGIN</h2>

            {!success && (
              <>
                <input
                  ref={inputRef}
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleDevOpsSubmit();
                    if (e.key === "Escape") closeModal();
                  }}
                  placeholder="Enter password"
                  className="w-full bg-[#080E1A] border border-electric/20 rounded px-4 py-3.5 text-[#EEF4FF] font-syne text-[15px] outline-none focus:border-electric/60 placeholder:text-white/20 mb-3 transition-colors"
                />
                <button
                  onClick={handleDevOpsSubmit}
                  className="w-full bg-electric hover:bg-electric-light text-[#04080F] border-none py-3.5 font-bebas text-[18px] tracking-[2px] rounded transition-colors"
                >
                  SUBMIT
                </button>
                {error && (
                  <p className="mt-3.5 text-center font-mono text-[11px] tracking-[2px] uppercase text-red-400">
                    Access Denied
                  </p>
                )}
              </>
            )}

            {success && (
              <div className="mt-3.5 text-center">
                <p className="font-mono text-[11px] tracking-[2px] uppercase text-electric mb-5">\u2713 Access Granted</p>
                <a href="/home" className="inline-block bg-electric hover:bg-electric-light text-[#04080F] px-9 py-3.5 font-bebas text-[20px] tracking-[2px] rounded transition-colors">
                  ENTER BETA
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
