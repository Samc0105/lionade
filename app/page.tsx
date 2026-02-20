"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const DEVOPS_PASSWORD = "LionadeDevOps2026";

export default function ComingSoonPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [success, setSuccess] = useState(false);

  const clickCountRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const handleSubmit = () => {
    if (pw === DEVOPS_PASSWORD) {
      setError(false);
      setSuccess(true);
      return;
    }

    setError(true);
    setSuccess(false);
    setPw("");
    window.setTimeout(() => {
      closeModal();
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-navy text-cream overflow-hidden relative">
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(74,144,217,0.18), transparent 70%)" }} />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(74,144,217,0.12), transparent 70%)" }} />

      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="inline-flex items-center gap-2 border border-electric/30 bg-electric/10 rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-electric mb-8">
          Coming Soon · 2026
        </div>

        <h1 className="font-bebas text-[clamp(3.5rem,12vw,9.5rem)] leading-[0.9] tracking-[0.08em] text-cream">
          STUDY<br />
          <span className="text-electric">LIKE IT&apos;S</span><br />
          <span className="shimmer-text">YOUR JOB</span>
        </h1>

        <p className="mt-6 max-w-2xl text-cream/60 text-base sm:text-lg">
          Lionade is the rewards platform for students who grind. Daily quizzes, 1v1 duels,
          and real payouts for your knowledge. We&apos;re opening soon.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <button className="btn-gold px-10 py-3 text-sm sm:text-base">Join the Waitlist</button>
          <button className="btn-outline px-8 py-3 text-sm sm:text-base">Get Notified</button>
        </div>

        <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl w-full">
          {[
            { label: "Subjects", value: "∞" },
            { label: "To Join", value: "$0" },
            { label: "Duels", value: "1v1" },
            { label: "Daily Streaks", value: "🔥" },
          ].map((stat) => (
            <div key={stat.label} className="card text-center py-4">
              <p className="font-bebas text-3xl text-electric leading-none">{stat.value}</p>
              <p className="text-cream/40 text-xs font-semibold mt-1 uppercase tracking-widest">{stat.label}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="relative z-10 border-t border-electric/10 py-8 px-6 text-center">
        <p className="text-cream/30 text-xs">getlionade.com · all rights reserved</p>
      </footer>

      <div className="relative z-10 text-center pb-6">
        <button
          id="devops-trigger"
          onClick={handleSecretClick}
          className="text-[10px] font-mono tracking-[0.2em] text-cream/10 hover:text-cream/30 transition-colors"
          aria-label="Copyright"
        >
          © 2026 Lionade
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-electric/30 bg-[#0b1222] p-8 text-left">
            <p className="text-xs uppercase tracking-[0.3em] text-electric/60">Internal Access</p>
            <h2 className="font-bebas text-3xl tracking-wider text-cream mt-3">DevOps Login</h2>

            {!success && (
              <>
                <input
                  ref={inputRef}
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                    if (e.key === "Escape") closeModal();
                  }}
                  placeholder="Enter password"
                  className="mt-6 w-full rounded-lg border border-electric/20 bg-[#0a1020] px-4 py-3 text-sm text-cream placeholder-cream/30 focus:outline-none focus:border-electric"
                />
                <button
                  onClick={handleSubmit}
                  className="btn-primary w-full mt-4"
                >
                  Submit
                </button>
                {error && (
                  <p className="mt-4 text-center text-xs font-semibold tracking-[0.2em] text-red-400 uppercase">
                    Access Denied
                  </p>
                )}
              </>
            )}

            {success && (
              <div className="mt-6 text-center">
                <p className="text-xs uppercase tracking-[0.3em] text-electric">Access Granted</p>
                <Link href="/dashboard" className="btn-gold inline-flex mt-5 px-10 py-3">
                  Enter Beta
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
