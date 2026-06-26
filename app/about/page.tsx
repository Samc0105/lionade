"use client";

import Link from "next/link";
import BackButton from "@/components/BackButton";
import { cdnUrl } from "@/lib/cdn";

const PILLARS = [
  {
    eyebrow: "WHAT WE DO",
    title: "PAY YOU TO STUDY",
    body: "Every focused minute on Lionade earns Fangs. Burn them on power-ups inside the platform today, with gift-card redemptions and cash-out arriving as Lionade grows. Studying is the only side hustle that compounds for the rest of your life. We are building it to pay.",
  },
  {
    eyebrow: "HOW IT WORKS",
    title: "EARN, COMPETE, CASH OUT",
    body: "Hit your daily focus target. Climb the leaderboard. Win head-to-head trivia in Compete. Run Mastery Mode on any subject you can name. The more you put in, the more Fangs you stack. No gimmicks, no fake currency. Real rewards, real progress.",
  },
  {
    eyebrow: "WHO IT IS FOR",
    title: "GRINDERS, NOT TOURISTS",
    body: "If you already study every day, you should already be getting paid for it. Lionade is built for students taking AP exams seriously, learners stacking certs, anyone who treats their brain like an asset. We are not a habit-tracker. We are a payroll system for your discipline.",
  },
];

const TIMELINE = [
  {
    date: "2025",
    title: "Founded",
    body: "Started as a side project between students tired of grinding for grades that paid nothing. The first version was a stopwatch and a spreadsheet.",
  },
  {
    date: "EARLY 2026",
    title: "Closed Beta",
    body: "Hundreds of students earned their first Fangs studying for AP exams, the SAT, and college finals. Daily streaks, Compete, and Mastery Mode shipped.",
  },
  {
    date: "MAY 2026",
    title: "Public Launch",
    body: "Lionade went live at getlionade.com. Daily quizzes, 1v1 Compete, and Mastery Mode all shipped. Cash-out lands with V2.",
  },
  {
    date: "NOW",
    title: "Building Loud",
    body: "Shipping every week. Word Banks, Sketchy Subjects, Bluff Trivia, Academia, and more. If you have ideas, the Contact page is right there.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen pt-20 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <BackButton />

        {/* Hero */}
        <section className="text-center mt-4 mb-20 animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-gold/75 mb-5">
            Built for grinders
          </p>
          <img
            src={cdnUrl("/logo-icon.png")}
            alt="Lionade"
            className="h-20 w-20 rounded-2xl demo-logo-glow mx-auto mb-6"
          />
          <h1 className="font-bebas text-6xl sm:text-7xl md:text-8xl tracking-wider leading-[0.92]">
            <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
              STUDYING SHOULD PAY YOU.
            </span>
          </h1>
          <p className="mt-7 max-w-2xl mx-auto text-cream/65 text-base sm:text-lg leading-relaxed">
            Lionade is the first study app that turns focused minutes into real money. We made it because every student we know was already grinding. The least we could do was put a price on the hours.
          </p>

          <div className="mt-10 inline-flex items-center gap-6 text-xs font-mono uppercase tracking-[0.22em] text-cream/55">
            <span><span className="text-gold">Web</span> + <span className="text-electric">iOS</span></span>
            <span className="h-3 w-px bg-cream/15" />
            <span>Live since May 2026</span>
            <span className="h-3 w-px bg-cream/15" />
            <span>Student-built</span>
          </div>
        </section>

        {/* Pillars */}
        <section className="space-y-5 mb-24">
          {PILLARS.map((pillar, i) => (
            <div
              key={pillar.title}
              className="rounded-2xl border border-electric/20 p-7 sm:p-9 animate-slide-up relative overflow-hidden"
              style={{
                animationDelay: `${0.05 + i * 0.06}s`,
                background:
                  "linear-gradient(135deg, rgba(10,16,32,0.85) 0%, rgba(6,12,24,0.85) 100%)",
              }}
            >
              <div
                aria-hidden
                className="absolute top-0 left-0 h-full w-[3px]"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(240,180,41,0.5) 0%, rgba(76,150,225,0.5) 100%)",
                }}
              />
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold/70 mb-3">
                {pillar.eyebrow}
              </p>
              <h2 className="font-bebas text-3xl sm:text-4xl tracking-wider mb-4">
                <span className="bg-gradient-to-r from-electric to-[#6AABF0] bg-clip-text text-transparent">
                  {pillar.title}
                </span>
              </h2>
              <p className="text-cream/70 text-base leading-relaxed max-w-3xl">
                {pillar.body}
              </p>
            </div>
          ))}
        </section>

        {/* Timeline */}
        <section className="mb-24 animate-slide-up" style={{ animationDelay: "0.2s" }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-gold/70 mb-3 text-center">
            How we got here
          </p>
          <h2 className="font-bebas text-4xl sm:text-5xl tracking-wider text-center mb-12 text-cream">
            THE SHORT VERSION
          </h2>

          <div className="relative">
            <div
              aria-hidden
              className="absolute left-4 sm:left-1/2 sm:-translate-x-px top-2 bottom-2 w-px"
              style={{
                background:
                  "linear-gradient(180deg, rgba(240,180,41,0.0) 0%, rgba(240,180,41,0.35) 12%, rgba(76,150,225,0.35) 88%, rgba(76,150,225,0.0) 100%)",
              }}
            />
            <ul className="space-y-10">
              {TIMELINE.map((item, i) => {
                const leftSide = i % 2 === 0;
                return (
                  <li
                    key={item.title}
                    className="relative pl-12 sm:pl-0 sm:grid sm:grid-cols-2 sm:gap-10 items-start"
                  >
                    <span
                      aria-hidden
                      className="absolute left-4 sm:left-1/2 top-2 -translate-x-1/2 w-2.5 h-2.5 rounded-full"
                      style={{
                        background: "#F0B429",
                        boxShadow: "0 0 12px rgba(240,180,41,0.7)",
                      }}
                    />
                    <div className={leftSide ? "sm:text-right sm:pr-8" : "sm:col-start-2 sm:pl-8"}>
                      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold/75 mb-1.5">
                        {item.date}
                      </p>
                      <h3 className="font-bebas text-2xl tracking-wider text-cream mb-2">
                        {item.title}
                      </h3>
                      <p className="text-cream/65 text-sm leading-relaxed">{item.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* From the team */}
        <section
          className="mb-20 rounded-2xl border border-gold/25 p-8 sm:p-10 animate-slide-up"
          style={{
            animationDelay: "0.25s",
            background: "linear-gradient(135deg, rgba(20,16,8,0.7) 0%, rgba(8,6,4,0.7) 100%)",
          }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold/75 mb-4">
            From the team
          </p>
          <p className="text-cream/80 text-base sm:text-lg leading-relaxed">
            We built Lionade because we were the customer first. We were the students putting in the hours with nothing to show for it but a transcript. If you study with us, you are not a user. You are a teammate. Every feature on this site exists because someone studying for something real asked for it. Keep asking. We are listening.
          </p>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.28em] text-cream/55">
            The Lionade team
          </p>
        </section>

        {/* CTA */}
        <section
          className="text-center animate-slide-up"
          style={{ animationDelay: "0.3s" }}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-gold/70 mb-4">
            Ready to start?
          </p>
          <h2 className="font-bebas text-4xl sm:text-5xl tracking-wider mb-8 text-cream">
            START STUDYING FOR FANGS
          </h2>
          <Link
            href="/dashboard"
            prefetch={false}
            className="inline-block px-9 py-4 rounded-full font-bold text-base transition-transform duration-150 active:scale-[0.98] hover:scale-[1.02] will-change-transform"
            style={{
              background:
                "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
              color: "#04080F",
              boxShadow:
                "0 8px 28px rgba(240,180,41,0.35), inset 0 1px 0 rgba(255,255,255,0.3)",
            }}
          >
            OPEN DASHBOARD
          </Link>
          <p className="mt-6 text-cream/55 text-xs">
            No credit card. Free Fangs from your first session.
          </p>
        </section>
      </div>
    </div>
  );
}
