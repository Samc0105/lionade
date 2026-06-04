"use client";

import { CheckCircle, Warning, Question, ArrowRight } from "@phosphor-icons/react";
import { cdnUrl } from "@/lib/cdn";
import type { ResumeAnalysis } from "./ResumeUpload";

interface Props {
  analysis: ResumeAnalysis;
  onStartSocratic: () => void;
}

/**
 * Three-section critique panel. Cards use the standard
 * white/5 backdrop-blur shell. Each list is staggered for a calm reveal.
 */
export default function ResumeAnalysisView({ analysis, onStartSocratic }: Props) {
  return (
    <div className="space-y-6 animate-slide-up" style={{ animationDelay: "0.04s" }}>
      {/* Header with Fangs icon — sets the tone that Ninny did the read */}
      <div className="flex items-center gap-3">
        <img
          src={cdnUrl("/F.png")}
          alt="Fangs"
          className="w-8 h-8 object-contain"
        />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-electric/80">
            ninny&rsquo;s read
          </p>
          <h2 className="font-bebas text-2xl text-cream tracking-[0.08em] leading-none mt-1">
            Here&rsquo;s where your resume stands
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Strengths */}
        <section
          className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-5 animate-slide-up"
          style={{ animationDelay: "0.08s" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={18} weight="fill" color="#22C55E" aria-hidden="true" />
            <h3 className="font-bebas text-sm text-cream tracking-[0.2em]">STRENGTHS</h3>
            <span className="font-mono text-[10px] text-cream/45 ml-auto tabular-nums">
              {analysis.strengths.length}
            </span>
          </div>
          <ul className="space-y-3">
            {analysis.strengths.map((s, i) => (
              <li
                key={i}
                className="font-syne text-sm text-cream/90 leading-snug flex gap-2"
              >
                <span className="text-green-400/70 select-none mt-0.5">+</span>
                <span className="flex-1">{s}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Weaknesses */}
        <section
          className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-5 animate-slide-up"
          style={{ animationDelay: "0.12s" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Warning size={18} weight="fill" color="#F97316" aria-hidden="true" />
            <h3 className="font-bebas text-sm text-cream tracking-[0.2em]">NEEDS WORK</h3>
            <span className="font-mono text-[10px] text-cream/45 ml-auto tabular-nums">
              {analysis.weaknesses.length}
            </span>
          </div>
          <ul className="space-y-3">
            {analysis.weaknesses.map((w, i) => (
              <li
                key={i}
                className="font-syne text-sm text-cream/90 leading-snug flex gap-2"
              >
                <span className="text-orange-400/80 select-none mt-0.5">!</span>
                <span className="flex-1">{w}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Questions */}
        <section
          className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-5 animate-slide-up"
          style={{ animationDelay: "0.16s" }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Question size={18} weight="fill" color="#A855F7" aria-hidden="true" />
            <h3 className="font-bebas text-sm text-cream tracking-[0.2em]">
              NINNY WANTS TO ASK
            </h3>
            <span className="font-mono text-[10px] text-cream/45 ml-auto tabular-nums">
              {analysis.questions.length}
            </span>
          </div>
          <ul className="space-y-3">
            {analysis.questions.map((q, i) => (
              <li
                key={i}
                className="rounded-lg px-3 py-2.5 border border-white/[0.06] bg-white/[0.02]"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#A855F7]/80 mb-1">
                  about line {i + 1}
                </p>
                <p className="font-syne text-xs text-cream/55 italic line-clamp-2 mb-1.5">
                  &ldquo;{q.bullet}&rdquo;
                </p>
                <p className="font-syne text-sm text-cream/90 leading-snug">{q.ask}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div
        className="flex justify-center pt-2 animate-slide-up"
        style={{ animationDelay: "0.20s" }}
      >
        <button
          type="button"
          onClick={onStartSocratic}
          className="btn-gold inline-flex items-center gap-2 px-6 py-3 rounded-full font-syne font-bold text-sm uppercase tracking-[0.15em]"
        >
          Answer Ninny&rsquo;s questions
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
