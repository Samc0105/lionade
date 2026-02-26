"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function ProductLandingPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [hasAccess, setHasAccess] = useState(false);
  const [checking, setChecking] = useState(true);

  // Check beta access gate + auth redirect
  useEffect(() => {
    if (!isLoading && user) {
      router.push("/dashboard");
      return;
    }

    const access = localStorage.getItem("lionade_beta_access");
    if (access === "true") {
      setHasAccess(true);
    } else {
      router.push("/");
    }
    setChecking(false);
  }, [user, isLoading, router]);

  if (isLoading || user || checking || !hasAccess) return null;

  return (
    <div className="min-h-screen text-cream overflow-hidden relative">
      <div className="absolute inset-0 grid-bg opacity-60" />
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(74,144,217,0.18), transparent 70%)" }} />
      <div className="absolute -bottom-40 -right-24 w-[28rem] h-[28rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(74,144,217,0.12), transparent 70%)" }} />

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center pt-16">
        <div className="inline-flex items-center gap-2 border border-electric/30 bg-electric/10 rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-electric mb-8">
          Study Rewards Platform
        </div>

        <h1 className="font-bebas text-[clamp(3.5rem,12vw,9.5rem)] leading-[0.9] tracking-[0.08em] text-cream">
          STUDY<br />
          <span className="text-electric">LIKE IT&apos;S</span><br />
          <span className="shimmer-text">YOUR JOB</span>
        </h1>

        <p className="mt-6 max-w-2xl text-cream/60 text-base sm:text-lg">
          Lionade is the rewards platform for students who grind. Daily quizzes, 1v1 duels,
          and real payouts for your knowledge. Sign up free and start earning today.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4">
          <Link href="/login" className="btn-gold px-10 py-3 text-sm sm:text-base">
            Get Started &mdash; It&apos;s Free
          </Link>
          <Link href="/login" className="btn-outline px-8 py-3 text-sm sm:text-base">
            Log In
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-3xl w-full">
          {[
            { label: "Subjects", value: "\u221E" },
            { label: "To Join", value: "$0" },
            { label: "Duels", value: "1v1" },
            { label: "Daily Streaks", value: "\uD83D\uDD25" },
          ].map((stat) => (
            <div key={stat.label} className="card text-center py-4">
              <p className="font-bebas text-3xl text-electric leading-none">{stat.value}</p>
              <p className="text-cream/40 text-xs font-semibold mt-1 uppercase tracking-widest">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── How It Works ─────────────────────────────────────── */}
      <section id="how-it-works" className="relative z-10 py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-electric mb-3">How It Works</p>
          <h2 className="font-bebas text-5xl sm:text-6xl tracking-wider text-cream mb-16">
            THREE STEPS TO START EARNING
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Sign Up",
                desc: "Create your free account in seconds. No credit card, no catch \u2014 just pick a username and go.",
                icon: "\uD83D\uDE80",
              },
              {
                step: "02",
                title: "Study & Compete",
                desc: "Take daily quizzes across any subject, challenge friends to 1v1 duels, and build your streak.",
                icon: "\uD83C\uDFAF",
              },
              {
                step: "03",
                title: "Earn Rewards",
                desc: "Every correct answer earns coins. Climb the leaderboard, unlock badges, and cash in your knowledge.",
                icon: "\uD83E\uDE99",
              },
            ].map((item) => (
              <div key={item.step} className="card-hover text-center p-8">
                <span className="text-4xl mb-4 block">{item.icon}</span>
                <p className="text-electric font-bebas text-lg tracking-[0.2em] mb-1">STEP {item.step}</p>
                <h3 className="font-bebas text-2xl tracking-wider text-cream mb-3">{item.title}</h3>
                <p className="text-cream/50 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─────────────────────────────────────────── */}
      <section id="features" className="relative z-10 py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-electric mb-3">Features</p>
          <h2 className="font-bebas text-5xl sm:text-6xl tracking-wider text-cream mb-16">
            EVERYTHING YOU NEED TO GRIND
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: "\uD83D\uDCDD",
                title: "Daily Quizzes",
                desc: "Fresh questions every day across Math, Science, Languages, SAT/ACT, Coding, Finance, and more.",
              },
              {
                icon: "\u2694\uFE0F",
                title: "1v1 Duels",
                desc: "Challenge any player head-to-head. Wager coins, answer fast, and prove who knows more.",
              },
              {
                icon: "\uD83E\uDE99",
                title: "Coin Rewards",
                desc: "Earn coins for every correct answer. Harder questions pay more. Stack your wallet.",
              },
              {
                icon: "\uD83D\uDD25",
                title: "Streaks",
                desc: "Study every day to build your streak. Longer streaks unlock bonus multipliers and badges.",
              },
              {
                icon: "\uD83D\uDCDA",
                title: "Multiple Subjects",
                desc: "From algebra to cybersecurity \u2014 pick your lane or study across all subjects to maximize earnings.",
              },
              {
                icon: "\uD83C\uDFC6",
                title: "Leaderboards",
                desc: "Compete globally or with friends. Top earners get featured and earn exclusive rewards.",
              },
            ].map((feature) => (
              <div key={feature.title} className="card-hover text-left p-6">
                <span className="text-3xl mb-3 block">{feature.icon}</span>
                <h3 className="font-bebas text-xl tracking-wider text-cream mb-2">{feature.title}</h3>
                <p className="text-cream/50 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── About ─────────────────────────────────────────────── */}
      <section id="about" className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-electric mb-3">About</p>
          <h2 className="font-bebas text-5xl sm:text-6xl tracking-wider text-cream mb-8">
            BUILT FOR STUDENTS WHO GRIND
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-12">
            {[
              { value: "7+", label: "Subjects" },
              { value: "500+", label: "Questions" },
              { value: "Free", label: "Forever" },
              { value: "24/7", label: "Access" },
            ].map((stat) => (
              <div key={stat.label} className="card text-center py-5">
                <p className="font-bebas text-3xl text-electric leading-none">{stat.value}</p>
                <p className="text-cream/40 text-xs font-semibold mt-1 uppercase tracking-widest">{stat.label}</p>
              </div>
            ))}
          </div>

          <p className="text-cream/60 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed mb-12">
            We believe studying should feel rewarding &mdash; not like a chore. Lionade turns every quiz
            into an opportunity to earn, compete, and level up. Whether you&apos;re prepping for the
            SAT or brushing up on Python, your effort pays off here.
          </p>

          <Link href="/login" className="btn-gold px-12 py-4 text-base sm:text-lg inline-block">
            Start Studying Today
          </Link>
        </div>
      </section>

      {/* ─── Footer ───────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-electric/10 py-8 px-6 text-center">
        <p className="text-cream/30 text-xs">getlionade.com &middot; all rights reserved</p>
      </footer>
    </div>
  );
}
