"use client";

import Link from "next/link";
import BackButton from "@/components/BackButton";

const SECTIONS = [
  {
    title: "OUR MISSION",
    body: "Lionade was built to give back to students. Oftentimes students work hard and burn out with little recognition. Lionade was built by students for other students. We allow all learners \u2014 novice or advanced \u2014 to be seen, valued, and acknowledged. We reward growth and achievement in a tangible way, empowering students with not just recognition but true support.",
    icon: "\uD83C\uDFAF",
  },
  {
    title: "ABOUT US",
    body: "Created by a team of ambitious students looking for a way to revolutionize studying. Lionade is the platform we wish existed before us. We look to give back to a community that already gives so much, and further self improvement around the world.",
    icon: "\uD83E\uDD1D",
  },
  {
    title: "OUR VISION",
    body: "Lionade aims to completely redefine the way studying is done \u2014 rewarding discipline and focus in a measurable way with active compensation for investing your time in self improvement, giving top performers real-world success.",
    icon: "\uD83D\uDE80",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-navy pt-20 pb-16">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <BackButton />

        {/* Logo */}
        <div className="text-center mb-12 animate-slide-up">
          <img
            src="/logo-icon.png"
            alt="Lionade"
            className="h-24 rounded-2xl demo-logo-glow mx-auto mb-6"
          />
          <h1 className="font-bebas text-5xl sm:text-6xl tracking-wider">
            <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
              ABOUT LIONADE
            </span>
          </h1>
          <p className="text-cream/40 text-sm mt-3 max-w-md mx-auto">
            Built by students, for students. Rewarding the grind since day one.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-6">
          {SECTIONS.map((section, i) => (
            <div
              key={section.title}
              className="rounded-2xl border border-electric/20 p-6 sm:p-8 animate-slide-up"
              style={{
                animationDelay: `${0.1 + i * 0.1}s`,
                background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{section.icon}</span>
                <h2 className="font-bebas text-2xl sm:text-3xl tracking-wider">
                  <span className="bg-gradient-to-r from-electric to-[#6AABF0] bg-clip-text text-transparent">
                    {section.title}
                  </span>
                </h2>
              </div>
              <p className="text-cream/70 text-sm sm:text-base leading-relaxed">
                {section.body}
              </p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-12 animate-slide-up" style={{ animationDelay: "0.4s" }}>
          <Link href="/login">
            <button
              className="px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
                boxShadow: "0 4px 20px rgba(240,180,41,0.3)",
              }}
            >
              Join Lionade
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
