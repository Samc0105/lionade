"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  { icon: "\uD83E\uDDEE", name: "Math", desc: "Algebra to calculus", color: "#EF4444" },
  { icon: "\uD83E\uDDEA", name: "Science", desc: "Physics, chem, bio", color: "#22C55E" },
  { icon: "\uD83C\uDF0D", name: "Languages", desc: "Spanish, French +", color: "#3B82F6" },
  { icon: "\uD83D\uDCDD", name: "SAT / ACT", desc: "Full test prep", color: "#A855F7" },
  { icon: "\uD83D\uDCBB", name: "Coding", desc: "Python, JS, DSA", color: "#6B7280" },
  { icon: "\uD83D\uDCB5", name: "Finance", desc: "Investing, markets", color: "#EAB308" },
  { icon: "\uD83D\uDD10", name: "Certifications", desc: "CompTIA, AWS", color: "#F97316" },
  { icon: "\u2795", name: "More Coming", desc: "Request subjects", color: "#06B6D4" },
];

const ROADMAP = [
  { phase: "Q1 2026", title: "Private Beta", desc: "Core quiz engine, daily streaks, coin system, and basic profiles. Invite-only access for early waitlist members. You\u2019re watching us build in real time.", status: "active" },
  { phase: "Summer 2026", title: "V1 \u2014 Public Launch", desc: "Lionade goes live for everyone. 1v1 Duels, full leaderboards, friend challenges, and every subject unlocked. Free to join, free to grind.", status: "upcoming" },
  { phase: "December 2026", title: "V2 \u2014 Lionade Pro", desc: "Paid subscriptions arrive. Pro tiers with advanced analytics, bonus coin multipliers, exclusive tournaments, and priority matchmaking. Plus \u2014 real cash payouts go live. Start converting your earned coins into real money.", status: "upcoming" },
  { phase: "March 2027", title: "V3 \u2014 The Full Vision", desc: "Meet Ninny \u2014 your AI-powered study companion. Team leagues, tutoring marketplace, and the complete Lionade ecosystem. Cash payouts get a 10% boost across the board \u2014 the longer you\u2019ve been grinding, the more you earn.", status: "upcoming" },
];

const FAQ = [
  { q: "Is Lionade actually free?", a: "100%. Free to join, free to play, free forever. We\u2019ll never charge you to study. Revenue comes from optional premium features \u2014 not your wallet." },
  { q: "How do I earn coins?", a: "Every correct answer earns coins. Harder questions pay more. Daily streaks give bonus multipliers, and winning 1v1 Duels pays out the wagered coins." },
  { q: "What subjects are available?", a: "Math, Science, Languages, SAT/ACT prep, Coding, Finance, and IT Certifications like CompTIA and AWS. More subjects are added based on community requests." },
  { q: "Can I actually cash out?", a: "That\u2019s the plan. Our roadmap targets V2 for real cash conversions. Early users who stack coins now will be first in line when payouts go live." },
  { q: "How are questions generated?", a: "We use a mix of expert-curated question banks and AI-generated content that adapts to your skill level. Every session is unique to you." },
  { q: "What are 1v1 Duels?", a: "Challenge any other user to a head-to-head quiz match. Both players wager coins, answer the same questions, and the winner takes the pot." },
  { q: "Do I need to download an app?", a: "Nope. Lionade is web-first \u2014 just open your browser, log in, and start grinding. Works on any device, anywhere, anytime. No app store needed." },
  { q: "What\u2019s a streak and why does it matter?", a: "Your streak tracks how many consecutive days you\u2019ve studied. The longer your streak, the higher your coin multiplier. Break it and you start over." },
  { q: "When does the public version launch?", a: "V1 launches Summer 2026 and will be free for everyone. Right now we\u2019re in private beta \u2014 join the waitlist to get early access before anyone else." },
];

const TICKER_ITEMS = [
  { text: "Clock In", accent: false }, { text: "\uD83E\uDD81 Level Up", accent: true },
  { text: "Your Knowledge", accent: false }, { text: "\u26A1 Your Check", accent: true },
  { text: "Study Hard", accent: false }, { text: "\uD83D\uDCB0 Get Paid", accent: true },
  { text: "Daily Grind", accent: false }, { text: "\uD83D\uDD25 Real Rewards", accent: true },
];

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

function StarField() {
  const stars = useMemo(() => {
    // Seeded PRNG to avoid hydration mismatch
    let seed = 42;
    const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed - 1) / 2147483646; };
    return Array.from({ length: 80 }, (_, i) => ({
      id: i,
      x: rand() * 100,
      y: rand() * 100,
      size: 1 + rand() * 2,
      delay: rand() * 5,
      duration: 3 + rand() * 4,
    }));
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
      {stars.map((s) => (
        <div key={s.id} className="star" style={{
          left: `${s.x}%`,
          top: `${s.y}%`,
          width: s.size,
          height: s.size,
          animationDelay: `${s.delay}s`,
          animationDuration: `${s.duration}s`,
        }} />
      ))}
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

  return (
    <div className="tilt-card group relative p-8 sm:p-10 overflow-hidden transition-all duration-300 rounded-[28px] min-h-[320px] flex flex-col"
      style={{ background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)", border: "1px solid rgba(74,144,217,0.12)" }}>
      {/* Top glow line */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[#FFD700]/40 via-electric/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Step number with ring */}
      <div className="relative w-[72px] h-[72px] mb-5 shrink-0">
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

      <div className="text-[28px] mb-4 shrink-0">{step.icon}</div>
      <div className="font-syne font-extrabold text-[20px] text-[#EEF4FF] mb-3 shrink-0">{step.title}</div>
      <div className="text-sm text-[#B0BEC5] leading-[1.7]" dangerouslySetInnerHTML={{ __html: step.desc }} />
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

      {/* Star field — fixed behind everything */}
      <StarField />

      {/* Global floating shapes */}
      <FloatingShapes />

      {/* Nebula clouds — subtle atmospheric color */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        {/* Cloud 1: blue — hero area */}
        <div className="absolute" style={{ top: "5%", left: "30%", width: 600, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(74,144,217,0.06), transparent 70%)", filter: "blur(70px)" }} />
        {/* Cloud 2: blue — near orbital section, left */}
        <div className="absolute" style={{ top: "30%", left: "5%", width: 500, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(74,144,217,0.05), transparent 70%)", filter: "blur(80px)" }} />
        {/* Cloud 3: gold — near orbital section, right */}
        <div className="absolute" style={{ top: "35%", right: "5%", width: 450, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,215,0,0.04), transparent 70%)", filter: "blur(70px)" }} />
        {/* Cloud 4: blue — subjects area */}
        <div className="absolute" style={{ top: "60%", left: "40%", width: 550, height: 350, borderRadius: "50%", background: "radial-gradient(circle, rgba(74,144,217,0.05), transparent 70%)", filter: "blur(75px)" }} />
        {/* Cloud 5: gold aurora — bottom CTA */}
        <div className="absolute" style={{ bottom: "2%", left: "20%", width: 700, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,215,0,0.04), transparent 70%)", filter: "blur(60px)" }} />
      </div>

      {/* ─── Nav ─── */}
      <nav className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-between px-6 sm:px-12 py-6"
        style={{ background: "linear-gradient(to bottom, rgba(4,8,15,0.95), transparent)" }}>
        <span className="font-bebas text-[28px] tracking-[3px] text-electric">LIONADE</span>
        <span className="font-mono text-[11px] tracking-[2px] uppercase text-[#94A3B8]">Coming Soon &mdash; 2026</span>
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
        <p className="mt-6 max-w-[560px] text-[clamp(16px,2.5vw,22px)] font-normal text-white leading-relaxed animate-[fadeUp_0.8s_ease_0.2s_both] relative z-10">
          You already put in the hours. <strong className="text-white font-bold">Now get paid for them.</strong><br />
          Lionade is the platform that rewards your grind &mdash; daily quizzes, real competition, and actual cash for your knowledge.
        </p>

        {/* Stats */}
        <div className="flex gap-8 sm:gap-12 mt-12 flex-wrap justify-center animate-[fadeUp_0.8s_ease_0.3s_both] relative z-10">
          {[
            { value: "\u26A1", label: "Blitz" }, { value: "\u221E", label: "Subjects" }, { value: "$0", label: "To Join" },
            { value: "1V1", label: "Duels" }, { value: "\uD83D\uDD25", label: "Daily Streaks" },
          ].map((stat, i, arr) => (
            <div key={stat.label} className="flex items-center gap-8 sm:gap-12">
              <div className="text-center">
                <div className={`font-bebas text-[42px] leading-none ${stat.label === "Blitz" ? "text-[#FFD700]" : "text-electric"}`}>{stat.value}</div>
                <div className="font-mono text-[10px] tracking-[2px] uppercase text-[#B0BEC5] mt-1">{stat.label}</div>
              </div>
              {i < arr.length - 1 && <div className="w-px self-stretch bg-electric/20 hidden sm:block" />}
            </div>
          ))}
        </div>

        {/* Email Form */}
        <div className="mt-14 w-full max-w-[520px] animate-[fadeUp_0.8s_ease_0.4s_both] relative z-10">
          <span className="font-mono text-[11px] tracking-[2px] uppercase text-[#94A3B8] block mb-3">
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
          <p className="font-mono text-[10px] text-[#94A3B8] tracking-[1px] mt-2.5">No spam. No cap. Just early access.</p>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 reveal mx-auto max-w-[1100px]">
          {STEPS.map((step, idx) => <StepCard key={step.num} step={step} idx={idx} />)}
        </div>
      </section>

      {/* ═══════════════════ FEATURES — ORBITAL ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal text-center mb-16">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric">// What You Get</p>
        </div>

        {/* ── Desktop: Orbital layout (lg+) ── */}
        <div className="hidden lg:flex justify-center reveal">
          <div className="relative" style={{ width: 680, height: 680 }}>
            {/* Orbit container — slowly rotates */}
            <div className="feature-orbit absolute inset-0">
              {/* Dashed orbit ring */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 680 680">
                <circle cx="340" cy="340" r="250" fill="none" stroke="rgba(74,144,217,0.12)"
                  strokeWidth="1" strokeDasharray="8 6"
                  style={{ animation: "dash-spin 12s linear infinite" }} />
              </svg>

              {/* 6 orbital nodes */}
              {FEATURES.map((f, i) => {
                const positions = [
                  { top: "8%",  left: "50%" },
                  { top: "27%", left: "87%" },
                  { top: "73%", left: "87%" },
                  { top: "92%", left: "50%" },
                  { top: "73%", left: "13%" },
                  { top: "27%", left: "13%" },
                ];
                const isGold = i % 2 === 1;
                const glowColor = isGold ? "rgba(255,215,0," : "rgba(74,144,217,";
                const pos = positions[i];

                return (
                  <div key={f.title} className="feature-orbit-node absolute" style={{ top: pos.top, left: pos.left }}>
                    <div className="flip-card" style={{ width: 180, height: 180 }}>
                      <div className="flip-card-inner">
                        {/* FRONT */}
                        <div className="flip-card-face"
                          style={{
                            background: "linear-gradient(135deg, #080E1A 0%, #0D1526 100%)",
                            border: `1.5px solid ${glowColor}0.25)`,
                            boxShadow: `0 0 20px ${glowColor}0.08), inset 0 0 30px ${glowColor}0.04)`,
                            padding: 20,
                            transition: "box-shadow 0.3s ease, border-color 0.3s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.boxShadow = `0 0 35px ${glowColor}0.25), inset 0 0 30px ${glowColor}0.06)`;
                            e.currentTarget.style.borderColor = `${glowColor}0.5)`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.boxShadow = `0 0 20px ${glowColor}0.08), inset 0 0 30px ${glowColor}0.04)`;
                            e.currentTarget.style.borderColor = `${glowColor}0.25)`;
                          }}>
                          <span className="text-[40px] mb-3 block">{f.icon}</span>
                          <span className="font-syne font-extrabold text-[13px] text-[#EEF4FF] leading-tight">{f.title}</span>
                        </div>
                        {/* BACK */}
                        <div className="flip-card-face flip-card-back"
                          style={{
                            background: "linear-gradient(135deg, #0D1526 0%, #080E1A 100%)",
                            border: `1.5px solid ${glowColor}0.4)`,
                            boxShadow: `0 0 30px ${glowColor}0.2), inset 0 0 30px ${glowColor}0.06)`,
                            padding: 18,
                          }}>
                          <span className="text-[20px] mb-2 block">{f.icon}</span>
                          <p className="text-[11px] text-[#B0BEC5] leading-[1.6] font-syne">{f.desc}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Center anchor */}
              <div className="feature-orbit-center absolute flex items-center justify-center" style={{ top: "50%", left: "50%", width: 0, height: 0 }}>
                <div className="flex flex-col items-center justify-center" style={{ width: "max-content" }}>
                  <h2 className="font-bebas text-[38px] leading-[1] tracking-[3px] text-center flex flex-col items-center">
                    <span className="text-[#3B82F6] block text-center">WE</span>
                    <span className="text-white block text-center">ARE</span>
                    <span className="text-[#EAB308] block text-center">BUILT</span>
                    <span className="text-white block text-center">DIFFERENT</span>
                  </h2>
                  <p className="font-mono text-[8px] tracking-[2px] uppercase text-[#94A3B8] mt-3 text-center">Hover to explore</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Mobile: 2-column flip grid (below lg) ── */}
        <div className="lg:hidden reveal">
          <h2 className="font-bebas text-[clamp(48px,7vw,72px)] leading-[0.95] mb-10 text-center">
            BUILT<br /><span className="text-electric">DIFFERENT</span>
          </h2>
          <div className="grid grid-cols-2 gap-4 max-w-[400px] mx-auto">
            {FEATURES.map((f, i) => {
              const isGold = i % 2 === 1;
              const glowColor = isGold ? "rgba(255,215,0," : "rgba(74,144,217,";
              return (
                <div key={f.title} className="flip-card mx-auto" style={{ width: 160, height: 160 }}>
                  <div className="flip-card-inner">
                    <div className="flip-card-face"
                      style={{
                        background: "linear-gradient(135deg, #080E1A 0%, #0D1526 100%)",
                        border: `1.5px solid ${glowColor}0.25)`,
                        boxShadow: `0 0 16px ${glowColor}0.08)`,
                        padding: 16,
                      }}>
                      <span className="text-[32px] mb-2 block">{f.icon}</span>
                      <span className="font-syne font-extrabold text-[12px] text-[#EEF4FF] leading-tight">{f.title}</span>
                    </div>
                    <div className="flip-card-face flip-card-back"
                      style={{
                        background: "linear-gradient(135deg, #0D1526 0%, #080E1A 100%)",
                        border: `1.5px solid ${glowColor}0.4)`,
                        boxShadow: `0 0 20px ${glowColor}0.15)`,
                        padding: 14,
                      }}>
                      <span className="text-[16px] mb-1.5 block">{f.icon}</span>
                      <p className="text-[10px] text-[#B0BEC5] leading-[1.5] font-syne">{f.desc}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════ SNEAK PEEK ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Sneak Peek</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-6 highlight-sweep inline-block">
            INSIDE<br /><span className="text-electric">THE APP</span>
          </h2>
          <p className="text-[#B0BEC5] text-base sm:text-lg max-w-[600px] leading-relaxed mb-16">
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
                  <p className="text-[#B0BEC5] text-sm leading-[1.7] max-w-md">{peek.desc}</p>
                </div>
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {peek.items.map((item) => (
                    <div key={item.label} className="flex items-start gap-3 bg-[#04080F]/60 rounded-2xl px-4 py-3 border border-electric/10 group-hover:border-electric/20 transition-colors backdrop-blur-sm">
                      <span className="text-xl mt-0.5">{item.icon}</span>
                      <span className="text-sm text-[#B0BEC5] leading-snug">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════ SUBJECTS ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// Subjects</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16 highlight-sweep inline-block">
            PICK YOUR<br /><span className="text-electric">LANE</span>
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 reveal max-w-[900px] mx-auto">
          {SUBJECTS.map((s) => (
            <div key={s.name}
              className="group relative rounded-[24px] p-6 sm:p-7 text-center transition-all duration-300 ease-out hover:-translate-y-1 cursor-default"
              style={{
                background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)",
                border: `1.5px solid ${s.color}30`,
                boxShadow: `0 0 12px ${s.color}10`,
                minHeight: 170,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = s.color;
                e.currentTarget.style.boxShadow = `0 0 28px ${s.color}40, 0 0 8px ${s.color}20`;
                e.currentTarget.style.background = `linear-gradient(135deg, ${s.color}0A 0%, ${s.color}05 100%)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = `${s.color}30`;
                e.currentTarget.style.boxShadow = `0 0 12px ${s.color}10`;
                e.currentTarget.style.background = "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)";
              }}>
              <span className="text-[36px] block mb-3 transition-transform duration-300 group-hover:scale-110">{s.icon}</span>
              <div className="font-syne font-extrabold text-[16px] text-[#EEF4FF] mb-1">{s.name}</div>
              <div className="font-mono text-[10px] tracking-[1px] text-[#B0BEC5] uppercase">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

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
                    <p className="text-sm text-[#B0BEC5] leading-[1.7] max-w-lg">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <section className="max-w-[1100px] mx-auto px-6 sm:px-12 py-20 sm:py-28">
        <div className="reveal">
          <p className="font-mono text-[11px] tracking-[3px] uppercase text-electric mb-4">// FAQ</p>
          <h2 className="font-bebas text-[clamp(48px,7vw,96px)] leading-[0.95] mb-16 highlight-sweep inline-block">
            GOT<br /><span className="text-electric">QUESTIONS?</span>
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 reveal max-w-[1100px] mx-auto">
          {FAQ.map((item) => (
            <div key={item.q} className="group rounded-[24px] p-7 sm:p-8 transition-all duration-300 ease-out hover:-translate-y-1 flex flex-col"
              style={{
                background: "linear-gradient(135deg, #080E1A 0%, #0a1225 100%)",
                border: "1px solid rgba(74,144,217,0.1)",
                minHeight: 200,
              }}>
              <h3 className="font-syne font-bold text-[16px] text-[#EEF4FF] mb-3 group-hover:text-electric transition-colors">{item.q}</h3>
              <p className="text-sm text-[#B0BEC5] leading-[1.7]">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════ BIG CTA ═══════════════════ */}
      <section className="py-24 sm:py-32 px-6 text-center relative overflow-hidden">
        {/* Background text */}
        <span className="absolute font-bebas text-[300px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none whitespace-nowrap tracking-[20px] select-none z-0 watermark-flash" style={{ color: "rgba(74,144,217,0.03)" }}>
          LIONADE
        </span>
        {/* Radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, rgba(255,215,0,0.04) 0%, transparent 60%)" }} />

        <div className="radial-burst relative z-10">
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
          <p className="font-mono text-[10px] text-[#94A3B8] tracking-[1px] mt-2.5">Free to join &middot; No credit card &middot; No cap</p>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="px-6 sm:px-12 py-8 flex items-center justify-between flex-wrap gap-4">
        <span className="font-bebas text-[24px] tracking-[3px] text-electric">LIONADE</span>
        <span className="font-mono text-[10px] tracking-[2px] uppercase text-[#8899A6]">Where champions are made &mdash; 2026</span>
        <span className="font-mono text-[11px] tracking-[1px] text-[#8899A6]">&copy; 2026 getlionade.com &middot; All rights reserved</span>
      </footer>

      {/* ─── DevOps Secret Trigger ─── */}
      <div className="text-center py-2.5 bg-[#04080F]">
        <button id="devops-trigger" onClick={handleSecretClick}
          className="font-mono text-[10px] tracking-[1px] text-white/[0.08] select-none cursor-default">
          &copy; 2026 Lionade
        </button>
      </div>

      {/* ─── DevOps Modal ─── */}
      {modalOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="bg-[#0D1526] border border-electric/25 rounded-2xl p-10 w-full max-w-[400px] mx-6">
            <p className="font-mono text-[10px] tracking-[3px] uppercase text-electric/50 mb-3.5">// Internal Access</p>
            <h2 className="font-bebas text-[30px] tracking-[2px] text-[#EEF4FF] mb-7">ADMIN LOGIN</h2>
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
