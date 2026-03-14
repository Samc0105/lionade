"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DEVOPS_PASSWORD = "LionadeDevOps2026";


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

export default function ComingSoonPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);

  const [email1, setEmail1] = useState("");
  const [status1, setStatus1] = useState<"idle" | "loading" | "success" | "error" | "duplicate">("idle");
  const [msg1, setMsg1] = useState("");

  const clickCountRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
  }, []);

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

  const tickerContent = [...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className="min-h-screen bg-[#04080F] text-[#EEF4FF] overflow-x-hidden relative" data-force-dark>

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
        <img src="/logo-full.png" alt="Lionade" className="h-9 rounded-md" />
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

      </section>

      {/* ─── Footer ─── */}
      <footer className="px-6 sm:px-12 py-8 flex items-center justify-between flex-wrap gap-4">
        <img src="/logo-full.png" alt="Lionade" className="h-8 rounded-md" />
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
