"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const DEVOPS_PASSWORD = "LionadeDevOps2026";

const STEPS = [
  { num: "01", icon: "\uD83C\uDFAF", title: "Clock In Daily", desc: 'Open Lionade and start your <strong class="text-electric">Daily Grind</strong> \u2014 AI-generated quizzes in your subject. Every correct answer adds to your streak and your bag.' },
  { num: "02", icon: "\u2694\uFE0F", title: "Duel & Compete", desc: 'Challenge anyone to a <strong class="text-electric">1v1 match</strong> or enter weekly team tournaments. The more you win, the higher you climb \u2014 and the more you earn.' },
  { num: "03", icon: "\uD83D\uDCB0", title: "Stack Rewards", desc: 'Top performers earn <strong class="text-electric">real rewards</strong>. Coins, badges, and eventually real cash payouts \u2014 because your study time is worth something.' },
  { num: "04", icon: "\uD83C\uDFC6", title: "Get Promoted", desc: 'Rank up high enough and <strong class="text-electric">unlock tutoring</strong> \u2014 set your rate, help others, and earn a second income stream from your knowledge.' },
];

const FEATURES = [
  { icon: "\uD83E\uDD16", title: "AI-Powered Questions", desc: "Every quiz adapts to your level in real time. The harder you grind, the harder it gets \u2014 and the more you earn." },
  { icon: "\uD83D\uDCDA", title: "Every Subject Covered", desc: "Math, Science, Languages, SAT/ACT, Coding, Finance, AWS, CompTIA and more. If it can be tested, it\u2019s in Lionade." },
  { icon: "\uD83D\uDD25", title: "Streak Culture", desc: "Your streak is your attendance record. Maintain it, flex it, and watch your rewards multiply the longer you stay consistent." },
  { icon: "\uD83D\uDC65", title: "Team Leagues", desc: "Form a squad with your friends and go head-to-head against other teams in weekly tournaments with prize pools on the line." },
  { icon: "\uD83C\uDF0D", title: "For Everyone", desc: "Whether you\u2019re 16 prepping for the SAT or 35 chasing a cloud cert \u2014 Lionade works for every learner at every stage." },
  { icon: "\uD83D\uDCF1", title: "Web First", desc: "No app download needed. Open your browser, clock in, and start grinding. Available anywhere, anytime." },
];

const SNEAK_PEEKS = [
  { tag: "// Dashboard", title: "YOUR COMMAND CENTER", desc: "See your coins, streak, XP, level, and daily progress all in one place. The dashboard tracks everything so you know exactly where you stand.", items: [{ icon: "\uD83E\uDE99", label: "Coin balance + transaction history" }, { icon: "\uD83D\uDD25", label: "Current streak & best streak" }, { icon: "\uD83D\uDCC8", label: "XP progress bar to next level" }, { icon: "\uD83C\uDFAF", label: "Daily missions & bonus challenges" }] },
  { tag: "// Quiz Engine", title: "SMART QUIZZES THAT ADAPT", desc: "No two sessions are the same. Questions adjust to your skill level in real time \u2014 answer correctly and the difficulty ramps up, increasing your coin rewards.", items: [{ icon: "\u23F1\uFE0F", label: "Timed questions with countdown" }, { icon: "\uD83E\uDDE0", label: "Difficulty scales with your level" }, { icon: "\uD83D\uDCA1", label: "Instant explanations after each answer" }, { icon: "\uD83D\uDCB0", label: "Harder questions = bigger coin drops" }] },
  { tag: "// 1v1 Duels", title: "HEAD-TO-HEAD BATTLES", desc: "Challenge anyone to a real-time knowledge duel. Pick the subject, wager your coins, and go head-to-head. Winner takes the pot.", items: [{ icon: "\u2694\uFE0F", label: "Real-time 1v1 matchmaking" }, { icon: "\uD83E\uDE99", label: "Coin wager system" }, { icon: "\uD83C\uDFC6", label: "Win streaks & duel rankings" }, { icon: "\uD83D\uDCAC", label: "Challenge friends by username" }] },
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
  { text: "Clock In", accent: false }, { text: "\uD83E\uDD81 Level Up", accent: true },
  { text: "Your Knowledge", accent: false }, { text: "\u26A1 Your Check", accent: true },
  { text: "Study Hard", accent: false }, { text: "\uD83D\uDCB0 Get Paid", accent: true },
  { text: "Daily Grind", accent: false }, { text: "\uD83D\uDD25 Real Rewards", accent: true },
];

/* ── Reusable SVG shapes ── */
function WaveDivider({ flip = false, color = "rgba(74,144,217,0.08)" }: { flip?: boolean; color?: string }) {
  return (
    <div className="wave-divider" style={flip ? { transform: "rotate(180deg)" } : {}}>
      <svg viewBox="0 0 1440 100" preserveAspectRatio="none" style={{ height: "60px" }}>
        <path d="M0,40 C360,100 720,0 1080,60 C1260,80 1380,20 1440,40 L1440,100 L0,100 Z" fill={color} />
      </svg>
    </div>
  );
}

function FloatingShapes() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Diamond */}
      <div className="geo-float" style={{ top: "12%", left: "8%", animationDelay: "0s", animationDuration: "14s" }}>
        <div style={{ width: 24, height: 24, border: "1.5px solid rgba(74,144,217,0.2)", transform: "rotate(45deg)" }} />
      </div>
      {/* Triangle */}
      <div className="geo-float" style={{ top: "25%", right: "10%", animationDelay: "-3s", animationDuration: "16s" }}>
        <div style={{ width: 0, height: 0, borderLeft: "14px solid transparent", borderRight: "14px solid transparent", borderBottom: "24px solid rgba(255,215,0,0.12)" }} />
      </div>
      {/* Ring */}
      <div className="geo-spin" style={{ top: "60%", left: "5%", animationDuration: "25s" }}>
        <div style={{ width: 40, height: 40, border: "1.5px solid rgba(74,144,217,0.15)", borderRadius: "50%" }} />
      </div>
      {/* Hexagon */}
      <div className="geo-float" style={{ top: "70%", right: "7%", animationDelay: "-5s", animationDuration: "18s" }}>
        <svg width="30" height="26" viewBox="0 0 30 26"><polygon points="15,0 30,7 30,19 15,26 0,19 0,7" fill="none" stroke="rgba(255,215,0,0.1)" strokeWidth="1.5" /></svg>
      </div>
      {/* Small circle */}
      <div className="geo-float" style={{ top: "40%", left: "85%", animationDelay: "-7s", animationDuration: "13s" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(74,144,217,0.15)" }} />
      </div>
      {/* Cross */}
      <div className="geo-spin" style={{ top: "85%", left: "45%", animationDuration: "30s" }}>
        <svg width="20" height="20" viewBox="0 0 20 20"><line x1="10" y1="2" x2="10" y2="18" stroke="rgba(255,215,0,0.1)" strokeWidth="1.5" /><line x1="2" y1="10" x2="18" y2="10" stroke="rgba(255,215,0,0.1)" strokeWidth="1.5" /></svg>
      </div>
      {/* Dots */}
      <div className="geo-float" style={{ top: "15%", left: "55%", animationDelay: "-2s", animationDuration: "11s" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,215,0,0.15)" }} />
      </div>
      <div className="geo-float" style={{ top: "50%", left: "20%", animationDelay: "-9s", animationDuration: "15s" }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(74,144,217,0.12)" }} />
      </div>
    </div>
  );
}

function WireframeSphere() {
  const rings = [
    { size: 280, rotateX: 70, color: "rgba(74,144,217,0.08)" },
    { size: 280, rotateX: 110, color: "rgba(74,144,217,0.06)" },
    { size: 280, rotateX: 30, color: "rgba(255,215,0,0.05)" },
    { size: 280, rotateX: 150, color: "rgba(74,144,217,0.05)" },
    { size: 260, rotateX: 90, color: "rgba(74,144,217,0.07)" },
    { size: 240, rotateX: 50, color: "rgba(255,215,0,0.04)" },
    { size: 200, rotateX: 0, color: "rgba(74,144,217,0.06)" },
  ];

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ perspective: "800px" }}>
      <div className="wireframe-sphere relative" style={{ width: 320, height: 320 }}>
        {rings.map((r, i) => (
          <div key={i} className="wireframe-ring" style={{
            width: r.size, height: r.size,
            marginTop: -r.size / 2, marginLeft: -r.size / 2,
            borderColor: r.color,
            transform: `rotateX(${r.rotateX}deg)`,
          }} />
        ))}
      </div>
    </div>
  );
}

/* ── Step card with animated ring ── */
function StepCard({ step, idx }: { step: typeof STEPS[0]; idx: number }) {
  const radius = 30;
  const circ = 2 * Math.PI * radius;
  const shapes = [
    "rounded-[28px]",
    "rounded-tr-[48px] rounded-bl-[48px] rounded-tl-[8px] rounded-br-[8px]",
    "rounded-[28px]",
    "rounded-tl-[48px] rounded-br-[48px] rounded-tr-[8px] rounded-bl-[8px]",
  ];

  return (
    <div className={`tilt-card group relative p-8 sm:p-10 overflow-hidden transition-all duration-300 ${shapes[idx]}`}
      style={{ background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)", border: "1px solid rgba(74,144,217,0.12)" }}>
      {/* Top glow line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#FFD700]/40 via-electric/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Step number with ring */}
      <div className="relative w-[72px] h-[72px] mb-5">
        <svg className="absolute inset-0" width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={radius} fill="none" stroke="rgba(74,144,217,0.1)" strokeWidth="2" />
          <circle cx="36" cy="36" r={radius} fill="none" stroke="#FFD700" strokeWidth="2"
            className="step-ring" style={{ strokeDasharray: circ, strokeDashoffset: circ, animationDelay: `${idx * 0.3}s` }}
            strokeLinecap="round" transform="rotate(-90 36 36)" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-bebas text-[28px] text-electric/40 group-hover:text-electric transition-colors">
          {step.num}
        </span>
      </div>

      <div className="text-[28px] mb-4">{step.icon}</div>
      <div className="font-syne font-extrabold text-[20px] text-[#EEF4FF] mb-3">{step.title}</div>
      <div className="text-sm text-[#7A8FA6] leading-[1.7]" dangerouslySetInnerHTML={{ __html: step.desc }} />
    </div>
  );
}

export default function ComingSoonPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const [modalOpen, setModalOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);

  const [email1, setEmail1] = useState("");
  const [status1, setStatus1] = useState<"idle" | "loading" | "success" | "error" | "duplicate">("idle");
  const [msg1, setMsg1] = useState("");
  const [email2, setEmail2] = useState("");
  const [status2, setStatus2] = useState<"idle" | "loading" | "success" | "error" | "duplicate">("idle");
  const [msg2, setMsg2] = useState("");

  const clickCountRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (!isLoading && user) router.push("/dashboard"); }, [user, isLoading, router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const reveals = document.querySelectorAll(".reveal");
      if (!reveals.length) return;
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); } });
      }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });
      reveals.forEach((el) => observer.observe(el));
      return () => observer.disconnect();
    }, 100);
    return () => clearTimeout(timer);
  }, [isLoading, user]);

  useEffect(() => { if (modalOpen && inputRef.current) inputRef.current.focus(); }, [modalOpen]);

  const handleSecretClick = () => {
    clickCountRef.current += 1;
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    if (clickCountRef.current >= 5) { clickCountRef.current = 0; setPw(""); setError(false); setSuccess(false); setModalOpen(true); return; }
    resetTimerRef.current = window.setTimeout(() => { clickCountRef.current = 0; }, 1500);
  };

  const closeModal = () => { setModalOpen(false); setPw(""); setError(false); setSuccess(false); };

  const handleDevOpsSubmit = () => {
    if (pw === DEVOPS_PASSWORD) { setError(false); setSuccess(true); localStorage.setItem("lionade_beta_access", "true"); return; }
    setError(true); setSuccess(false); setPw(""); window.setTimeout(() => closeModal(), 1200);
  };

  const submitWaitlist = async (email: string, setStatus: (s: "idle" | "loading" | "success" | "error" | "duplicate") => void, setMsg: (m: string) => void, setEmail: (e: string) => void) => {
    const clean = email.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) { setStatus("error"); setMsg("Please enter a valid email."); return; }
    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: clean, source: "landing" }) });
      const data = await res.json();
      if (res.ok) { setStatus("success"); setMsg(data.message || "You\u2019re on the list!"); setEmail(""); }
      else if (res.status === 409) { setStatus("duplicate"); setMsg(data.error || "You\u2019re already on the list!"); }
      else { setStatus("error"); setMsg(data.error || "Something went wrong."); }
    } catch { setStatus("error"); setMsg("Something went wrong."); }
  };

  if (isLoading || user) return null;

  const tickerContent = [...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className="min-h-screen bg-[#04080F] text-[#EEF4FF] overflow-x-hidden relative">

      {/* Global floating shapes */}
      <FloatingShapes />

      {/* ─── Nav ─── */}
      <nav className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-6 sm:px-12 py-6"
        style={{ background: "linear-gradient(to bottom, rgba(4,8,15,0.95), transparent)" }}>
        <span className="font-bebas text-[28px] tracking-[3px] text-electric">LIONADE</span>
        <span className="font-mono text-[11px] tracking-[2px] uppercase text-electric/30">Coming Soon &mdash; 2026</span>
      </nav>

      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="min-h-[100svh] flex flex-col items-center justify-center relative px-6 text-center pt-[120px] pb-20 overflow-hidden">
        {/* Wireframe sphere */}
        <WireframeSphere />

        {/* Gradient orbs */}
        <div className="absolute w-[600px] h-[600px] rounded-full blur-[120px] -top-[150px] -left-[150px] pointer-events-none animate-[drift_10s_ease-in-out_infinite]"
          style={{ background: "radial-gradient(circle, rgba(74,144,217,0.12), transparent 70%)" }} />
        <div className="absolute w-[500px] h-[500px] rounded-full blur-[100px] -bottom-[100px] -right-[100px] pointer-events-none animate-[drift_10s_ease-in-out_infinite_-5s]"
          style={{ background: "radial-gradient(circle, rgba(255,215,0,0.06), transparent 70%)" }} />

        {/* Ticker */}
        <div className="absolute top-[88px] left-0 right-0 overflow-hidden border-y border-electric/10 py-2"
          style={{ background: "rgba(74,144,217,0.03)" }}>
          <div className="ticker-track flex whitespace-nowrap">
            {tickerContent.map((item, i) => (
              <span key={i} className={`font-mono text-[10px] tracking-[3px] uppercase px-10 ${item.accent ? "text-electric" : "text-electric/20"}`}>{item.text}</span>
            ))}
          </div>
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-electric/[0.06] border border-electric/20 rounded-full px-5 py-2 font-mono text-[11px] tracking-[2px] uppercase text-electric mb-8 animate-[fadeUp_0.8s_ease_both] relative z-10">
          <span className="w-1.5 h-1.5 bg-electric rounded-full animate-[pulse_2s_ease_infinite]" />
          <span>Born from a grind &middot; Built for everyone</span>
        </div>

        {/* Headline */}
        <div className="radial-burst relative z-10">
          <h1 className="font-bebas text-[clamp(72px,14vw,180px)] leading-[0.9] tracking-[2px] animate-[fadeUp_0.8s_ease_0.1s_both]">
            <span className="text-reveal-wrap"><span className="text-reveal-inner">STUDY</span></span><br />
            <span className="text-reveal-wrap"><span className="text-reveal-inner text-electric" style={{ animationDelay: "0.15s" }}>LIKE IT&apos;S</span></span><br />
            <span className="text-reveal-wrap"><span className="text-reveal-inner text-transparent" style={{ WebkitTextStroke: "2px #4A90D9", animationDelay: "0.3s" }}>YOUR JOB</span></span>
          </h1>
        </div>

        {/* Subheadline */}
        <p className="mt-6 max-w-[560px] text-[clamp(16px,2.5vw,22px)] font-normal text-[#7A8FA6] leading-relaxed animate-[fadeUp_0.8s_ease_0.2s_both] relative z-10">
          You already put in the hours. <strong className="text-[#EEF4FF] font-bold">Now get paid for them.</strong><br />
          Lionade is the platform that rewards your grind &mdash; daily quizzes, real competition, and actual cash for your knowledge.
        </p>

        {/* Stats */}
        <div className="flex gap-8 sm:gap-12 mt-12 flex-wrap justify-center animate-[fadeUp_0.8s_ease_0.3s_both] relative z-10">
          {[
            { value: "\u221E", label: "Subjects" }, { value: "$0", label: "To Join" },
            { value: "1V1", label: "Duels" }, { value: "\uD83D\uDD25", label: "Daily Streaks" },
          ].map((stat, i, arr) => (
            <div key={stat.label} className="flex items-center gap-8 sm:gap-12">
              <div className="text-center">
                <div className="font-bebas text-[42px] text-electric leading-none">{stat.value}</div>
                <div className="font-mono text-[10px] tracking-[2px] uppercase text-[#7A8FA6] mt-1">{stat.label}</div>
              </div>
              {i < arr.length - 1 && <div className="w-px self-stretch bg-electric/20 hidden sm:block" />}
            </div>
          ))}
        </div>

        {/* Email Form */}
        <div className="mt-14 w-full max-w-[520px] animate-[fadeUp_0.8s_ease_0.4s_both] relative z-10">
          <span className="font-mono text-[11px] tracking-[2px] uppercase text-electric/30 block mb-3">
            Join the waitlist &mdash; be first in line
          </span>
          {status1 !== "success" ? (
            <>
              <div className="flex bg-[#0D1526] border border-electric/20 rounded-full overflow-hidden focus-within:border-[#FFD700]/50 focus-within:shadow-[0_0_20px_rgba(255,215,0,0.08)] transition-all">
                <input type="email" value={email1}
                  onChange={(e) => { setEmail1(e.target.value); if (status1 !== "idle" && status1 !== "loading") setStatus1("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submitWaitlist(email1, setStatus1, setMsg1, setEmail1); }}
                  placeholder="your@email.com" disabled={status1 === "loading"}
                  className="flex-1 bg-transparent border-none outline-none px-6 py-4 text-[#EEF4FF] font-syne text-[15px] placeholder:text-white/20" />
                <button onClick={() => submitWaitlist(email1, setStatus1, setMsg1, setEmail1)} disabled={status1 === "loading"}
                  className="gold-btn border-none px-8 py-4 font-bebas text-[18px] tracking-[2px] whitespace-nowrap disabled:opacity-60 rounded-full m-1">
                  {status1 === "loading" ? "..." : "LOCK IN"}
                </button>
              </div>
              {(status1 === "error" || status1 === "duplicate") && (
                <p className={`mt-3 font-mono text-[12px] tracking-[1px] ${status1 === "duplicate" ? "text-electric" : "text-red-400"}`}>{msg1}</p>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center gap-3 px-6 py-4 bg-[#FFD700]/[0.08] border border-[#FFD700]/30 rounded-full font-mono text-[13px] tracking-[1px] text-[#FFD700] animate-[fadeUp_0.5s_ease_both]">
              You&apos;re on the list. We&apos;ll hit you when we drop.
            </div>
          )}
          <p className="font-mono text-[10px] text-white/20 tracking-[1px] mt-2.5">No spam. No cap. Just early access.</p>
        </div>

        {/* Scroll indicator */}
        <div className="mt-12 animate-[fadeUp_0.8s_ease_0.5s_both] relative z-10">
          <a href="#how-it-works" className="flex flex-col items-center gap-2 text-electric/30 hover:text-electric/60 transition-colors">
            <span className="font-mono text-[10px] tracking-[2px] uppercase">Scroll to explore</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="animate-bounce">
              <path d="M10 4v12M4 10l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </section>

      {/* Wave → How It Works */}
      <WaveDivider color="rgba(74,144,217,0.05)" />

      {/* ═══════════════════ HOW IT WORKS ═══════════════════ */}
      <section id="how-it-works" className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28 relative">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// How It Works</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16 radial-burst highlight-sweep inline-block">
            YOUR DAILY<br /><span className="text-electric">GRIND</span>
          </h2>
        </div>

        {/* Connecting line */}
        <div className="hidden lg:block absolute left-1/2 -translate-x-1/2 top-[220px] bottom-[80px] w-px"
          style={{ background: "linear-gradient(to bottom, transparent, rgba(255,215,0,0.15) 20%, rgba(74,144,217,0.15) 80%, transparent)" }} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 reveal">
          {STEPS.map((step, idx) => <StepCard key={step.num} step={step} idx={idx} />)}
        </div>
      </section>

      {/* Wave → Features */}
      <WaveDivider flip color="rgba(255,215,0,0.03)" />

      {/* ═══════════════════ FEATURES ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// What You Get</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16 highlight-sweep inline-block">
            BUILT<br /><span className="text-electric">DIFFERENT</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 reveal">
          {FEATURES.map((f, i) => {
            const shapes = [
              "rounded-[32px]",
              "rounded-tr-[48px] rounded-bl-[48px] rounded-tl-[12px] rounded-br-[12px]",
              "rounded-[32px]",
              "rounded-tl-[48px] rounded-br-[48px] rounded-tr-[12px] rounded-bl-[12px]",
              "rounded-[32px]",
              "rounded-tr-[48px] rounded-bl-[48px] rounded-tl-[12px] rounded-br-[12px]",
            ];
            return (
              <div key={f.title} className={`tilt-card group p-8 sm:p-10 transition-all duration-300 ${shapes[i]}`}
                style={{ background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)", border: "1px solid rgba(74,144,217,0.1)" }}>
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#FFD700]/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <span className="text-[36px] block mb-5">{f.icon}</span>
                <div className="font-syne font-extrabold text-[18px] text-[#EEF4FF] mb-2.5 group-hover:text-electric transition-colors">{f.title}</div>
                <div className="text-sm text-[#7A8FA6] leading-[1.7]">{f.desc}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Wave → Sneak Peek */}
      <WaveDivider color="rgba(74,144,217,0.04)" />

      {/* ═══════════════════ SNEAK PEEK ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Sneak Peek</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-6 highlight-sweep inline-block">
            INSIDE<br /><span className="text-electric">THE APP</span>
          </h2>
          <p className="text-[#7A8FA6] text-base sm:text-lg max-w-[600px] leading-relaxed mb-16">
            Here&apos;s a look at what you&apos;ll get when you unlock your account. Every screen is designed to keep you grinding.
          </p>
        </div>

        <div className="space-y-6 reveal">
          {SNEAK_PEEKS.map((peek, idx) => (
            <div key={peek.tag} className={`tilt-card group p-8 sm:p-12 relative overflow-hidden transition-all duration-300 ${
              idx === 0 ? "rounded-[32px] rounded-tl-[8px]" : idx === 1 ? "rounded-[32px] rounded-tr-[8px]" : "rounded-[32px] rounded-br-[8px]"
            }`} style={{ background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)", border: "1px solid rgba(74,144,217,0.1)" }}>
              {/* Accent glow */}
              <div className={`absolute top-0 ${idx % 2 === 0 ? "left-0" : "right-0"} w-[200px] h-[200px] rounded-full blur-[80px] pointer-events-none`}
                style={{ background: idx === 0 ? "rgba(74,144,217,0.06)" : idx === 1 ? "rgba(255,215,0,0.04)" : "rgba(74,144,217,0.05)" }} />

              <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 relative z-10">
                <div className="flex-1">
                  <p className="font-mono text-[10px] tracking-[3px] uppercase text-electric/40 mb-3">{peek.tag}</p>
                  <h3 className="font-bebas text-[clamp(28px,4vw,48px)] leading-[0.95] mb-4">{peek.title}</h3>
                  <p className="text-[#7A8FA6] text-sm leading-[1.7] max-w-md">{peek.desc}</p>
                </div>
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {peek.items.map((item) => (
                    <div key={item.label} className="flex items-start gap-3 bg-[#04080F]/60 rounded-2xl px-4 py-3 border border-electric/10 group-hover:border-electric/20 transition-colors backdrop-blur-sm">
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

      {/* Wave → Subjects */}
      <WaveDivider flip color="rgba(255,215,0,0.03)" />

      {/* ═══════════════════ SUBJECTS ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Subjects</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16 highlight-sweep inline-block">
            PICK YOUR<br /><span className="text-electric">LANE</span>
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 reveal">
          {SUBJECTS.map((s, i) => (
            <div key={s.name} className={`tilt-card group p-6 sm:p-8 text-center transition-all duration-300 relative overflow-hidden ${
              i % 3 === 0 ? "rounded-[28px]" : i % 3 === 1 ? "rounded-full" : "rounded-[28px] rounded-tl-[8px] rounded-br-[8px]"
            }`} style={{ background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)", border: "1px solid rgba(74,144,217,0.1)" }}>
              <span className="text-[36px] block mb-3 group-hover:scale-110 transition-transform duration-300">{s.icon}</span>
              <div className="font-syne font-extrabold text-[16px] text-[#EEF4FF] mb-1 group-hover:text-electric transition-colors">{s.name}</div>
              <div className="font-mono text-[10px] tracking-[1px] text-[#7A8FA6] uppercase">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Wave → Roadmap */}
      <WaveDivider color="rgba(74,144,217,0.04)" />

      {/* ═══════════════════ ROADMAP ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Roadmap</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16 highlight-sweep inline-block">
            WHAT&apos;S<br /><span className="text-electric">COMING</span>
          </h2>
        </div>
        <div className="relative reveal">
          {/* Glowing timeline line */}
          <div className="absolute left-4 sm:left-6 top-0 bottom-0 w-px"
            style={{ background: "linear-gradient(to bottom, rgba(255,215,0,0.3), rgba(74,144,217,0.2), rgba(74,144,217,0.05))" }} />

          <div className="space-y-0">
            {ROADMAP.map((item) => (
              <div key={item.phase} className="relative pl-12 sm:pl-16 py-8 group">
                <div className={`absolute left-2.5 sm:left-4.5 top-10 w-3 h-3 rounded-full border-2 transition-all duration-300 ${
                  item.status === "active"
                    ? "bg-[#FFD700] border-[#FFD700] shadow-[0_0_12px_rgba(255,215,0,0.5)]"
                    : "bg-transparent border-electric/30 group-hover:border-electric/60"
                }`} />
                <div className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-6">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[11px] tracking-[2px] uppercase text-electric/40 whitespace-nowrap">{item.phase}</span>
                    {item.status === "active" && (
                      <span className="font-mono text-[9px] tracking-[2px] uppercase bg-[#FFD700]/15 text-[#FFD700] px-2 py-0.5 rounded-full">Live</span>
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

      {/* Wave → FAQ */}
      <WaveDivider flip color="rgba(255,215,0,0.03)" />

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// FAQ</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16 highlight-sweep inline-block">
            GOT<br /><span className="text-electric">QUESTIONS?</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 reveal">
          {FAQ.map((item, i) => (
            <div key={item.q} className={`tilt-card group p-8 sm:p-10 transition-all duration-300 ${
              i % 2 === 0 ? "rounded-[28px] rounded-tr-[8px]" : "rounded-[28px] rounded-tl-[8px]"
            }`} style={{ background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)", border: "1px solid rgba(74,144,217,0.08)" }}>
              <h3 className="font-syne font-bold text-[16px] text-[#EEF4FF] mb-3 group-hover:text-electric transition-colors">{item.q}</h3>
              <p className="text-sm text-[#7A8FA6] leading-[1.7]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Wave → CTA */}
      <WaveDivider color="rgba(255,215,0,0.04)" />

      {/* ═══════════════════ BIG CTA ═══════════════════ */}
      <section className="py-24 sm:py-32 px-6 text-center relative overflow-hidden">
        {/* Background text */}
        <span className="absolute font-bebas text-[300px] text-electric/[0.03] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap tracking-[20px] select-none">
          LIONADE
        </span>
        {/* Radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,215,0,0.04) 0%, transparent 60%)" }} />

        <div className="radial-burst">
          <h2 className="font-bebas text-[clamp(56px,10vw,130px)] leading-[0.95] relative reveal">
            STOP<br />STUDYING<br /><span className="text-electric">FOR FREE.</span>
          </h2>
        </div>
        <div className="max-w-[520px] mx-auto mt-12 reveal relative z-10">
          {status2 !== "success" ? (
            <>
              <div className="flex bg-[#0D1526] border border-electric/20 rounded-full overflow-hidden focus-within:border-[#FFD700]/50 focus-within:shadow-[0_0_20px_rgba(255,215,0,0.08)] transition-all">
                <input type="email" value={email2}
                  onChange={(e) => { setEmail2(e.target.value); if (status2 !== "idle" && status2 !== "loading") setStatus2("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submitWaitlist(email2, setStatus2, setMsg2, setEmail2); }}
                  placeholder="Drop your email, get early access" disabled={status2 === "loading"}
                  className="flex-1 bg-transparent border-none outline-none px-6 py-4 text-[#EEF4FF] font-syne text-[15px] placeholder:text-white/20" />
                <button onClick={() => submitWaitlist(email2, setStatus2, setMsg2, setEmail2)} disabled={status2 === "loading"}
                  className="gold-btn border-none px-8 py-4 font-bebas text-[18px] tracking-[2px] whitespace-nowrap disabled:opacity-60 rounded-full m-1">
                  {status2 === "loading" ? "..." : "LOCK IN"}
                </button>
              </div>
              {(status2 === "error" || status2 === "duplicate") && (
                <p className={`mt-3 font-mono text-[12px] tracking-[1px] ${status2 === "duplicate" ? "text-electric" : "text-red-400"}`}>{msg2}</p>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center gap-3 px-6 py-4 bg-[#FFD700]/[0.08] border border-[#FFD700]/30 rounded-full font-mono text-[13px] tracking-[1px] text-[#FFD700] animate-[fadeUp_0.5s_ease_both]">
              You&apos;re on the list. We&apos;ll hit you when we drop.
            </div>
          )}
          <p className="font-mono text-[10px] text-white/20 tracking-[1px] mt-2.5">Free to join &middot; No credit card &middot; No cap</p>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-electric/10 px-6 sm:px-12 py-8 flex items-center justify-between flex-wrap gap-4">
        <span className="font-bebas text-[24px] tracking-[3px] text-electric">LIONADE</span>
        <span className="font-mono text-[10px] tracking-[2px] uppercase text-electric/30">Where champions are made &mdash; 2026</span>
        <span className="font-mono text-[11px] tracking-[1px] text-white/20">&copy; 2026 getlionade.com &middot; All rights reserved</span>
      </footer>

      {/* ─── DevOps Secret Trigger ─── */}
      <div className="text-center py-2.5 bg-[#04080F]">
        <button id="devops-trigger" onClick={handleSecretClick}
          className="font-mono text-[10px] tracking-[1px] text-white/[0.08] hover:text-white/20 transition-colors select-none">
          &copy; 2026 Lionade
        </button>
      </div>

      {/* ─── DevOps Modal ─── */}
      {modalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="bg-[#0D1526] border border-electric/25 rounded-2xl p-10 w-full max-w-[400px] mx-6">
            <p className="font-mono text-[10px] tracking-[3px] uppercase text-electric/50 mb-3.5">// Internal Access</p>
            <h2 className="font-bebas text-[30px] tracking-[2px] text-[#EEF4FF] mb-7">DEVOPS LOGIN</h2>
            {!success && (
              <>
                <input ref={inputRef} type="password" value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleDevOpsSubmit(); if (e.key === "Escape") closeModal(); }}
                  placeholder="Enter password"
                  className="w-full bg-[#080E1A] border border-electric/20 rounded-xl px-4 py-3.5 text-[#EEF4FF] font-syne text-[15px] outline-none focus:border-electric/60 placeholder:text-white/20 mb-3 transition-colors" />
                <button onClick={handleDevOpsSubmit}
                  className="w-full bg-electric hover:bg-electric-light text-[#04080F] border-none py-3.5 font-bebas text-[18px] tracking-[2px] rounded-xl transition-colors">
                  SUBMIT
                </button>
                {error && <p className="mt-3.5 text-center font-mono text-[11px] tracking-[2px] uppercase text-red-400">Access Denied</p>}
              </>
            )}
            {success && (
              <div className="mt-3.5 text-center">
                <p className="font-mono text-[11px] tracking-[2px] uppercase text-electric mb-5">{"\u2713"} Access Granted</p>
                <a href="/home" className="inline-block bg-electric hover:bg-electric-light text-[#04080F] px-9 py-3.5 font-bebas text-[20px] tracking-[2px] rounded-xl transition-colors">ENTER BETA</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
