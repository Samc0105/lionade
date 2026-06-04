"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Crown, ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { usePlan } from "@/lib/use-plan";
import { cdnUrl } from "@/lib/cdn";
import ResumeUpload, { type ResumeAnalysis } from "@/components/Coach/ResumeUpload";
import ResumeAnalysisView from "@/components/Coach/ResumeAnalysis";
import SocraticBubble from "@/components/Coach/SocraticBubble";
import FinalReview from "@/components/Coach/FinalReview";

/**
 * Resume Coach — Pro-tier exclusive page.
 *
 * Single-page experience with FOUR states driven by local component
 * state (no router shuffling — keeps Ninny's chain of thought intact):
 *   - "intro"     → landing card + ResumeUpload dropzone
 *   - "analysis"  → strengths / weaknesses / questions
 *   - "socratic"  → per-question rewrite loop
 *   - "final"     → side-by-side ORIGINAL vs IMPROVED + markdown export
 *
 * Pro gate runs BEFORE rendering the upload flow. Free users see only
 * the upsell card pointing to /pricing — no peek at the dropzone.
 */
type Phase = "intro" | "analysis" | "socratic" | "final";

export default function ResumeCoachPage() {
  const { plan, isLoading: planLoading } = usePlan();
  const isPro = plan === "pro" || plan === "platinum";

  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  // Per-question improved bullets (index → improved). Skip leaves the
  // slot null so FinalReview can show "not rewritten" for that question.
  const [improvedByIndex, setImprovedByIndex] = useState<Record<number, string>>({});
  const [socraticIndex, setSocraticIndex] = useState(0);

  const handleAnalyzed = useCallback(
    (id: string, a: ResumeAnalysis) => {
      setSessionId(id);
      setAnalysis(a);
      setImprovedByIndex({});
      setSocraticIndex(0);
      setPhase("analysis");
    },
    [],
  );

  const startSocratic = useCallback(() => {
    setSocraticIndex(0);
    setPhase("socratic");
  }, []);

  const advanceSocratic = useCallback(() => {
    if (!analysis) return;
    if (socraticIndex + 1 >= analysis.questions.length) {
      setPhase("final");
      return;
    }
    setSocraticIndex((i) => i + 1);
  }, [analysis, socraticIndex]);

  const acceptImproved = useCallback(
    (improved: string) => {
      setImprovedByIndex((prev) => ({ ...prev, [socraticIndex]: improved }));
      advanceSocratic();
    },
    [advanceSocratic, socraticIndex],
  );

  const startOver = useCallback(() => {
    setSessionId(null);
    setAnalysis(null);
    setImprovedByIndex({});
    setSocraticIndex(0);
    setPhase("intro");
  }, []);

  // Side-by-side pairs for FinalReview
  const finalPairs = useMemo(() => {
    if (!analysis) return [];
    return analysis.questions.map((q, i) => ({
      original: q.bullet,
      improved: improvedByIndex[i] ?? null,
    }));
  }, [analysis, improvedByIndex]);

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.45s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
        }
      `}</style>

      <div className="min-h-screen pt-16 pb-20 md:pb-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Back-to-Learn breadcrumb */}
          <div className="mb-6 animate-slide-up">
            <Link
              href="/learn"
              className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 hover:text-electric transition-colors"
            >
              <ArrowLeft size={12} weight="bold" aria-hidden="true" />
              back to learn
            </Link>
          </div>

          {/* Header — always visible */}
          <header className="mb-8 animate-slide-up" style={{ animationDelay: "0.02s" }}>
            <div className="flex items-center gap-3 mb-2">
              <img
                src={cdnUrl("/F.png")}
                alt="Fangs"
                className="w-7 h-7 object-contain"
              />
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/85">
                Resume Coach &middot; Pro
              </p>
            </div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.08em] leading-none">
              Get your resume reviewed by Ninny
            </h1>
            <p className="font-syne text-sm text-cream/65 mt-3 max-w-2xl">
              Upload a PDF, get a critique, then answer Socratic questions one bullet at a
              time. Ninny rewrites each line with you, not for you.
            </p>
          </header>

          {/* ── Pro gate ─────────────────────────────────────────── */}
          {!planLoading && !isPro ? (
            <ProUpsell />
          ) : planLoading ? (
            <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 text-center">
              <p className="font-syne text-sm text-cream/55">Checking your plan…</p>
            </div>
          ) : (
            <>
              {/* ── Phase: intro / upload ──────────────────────────── */}
              {phase === "intro" && (
                <>
                  <div
                    className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 mb-6 animate-slide-up"
                    style={{ animationDelay: "0.03s" }}
                  >
                    <p className="font-bebas text-lg text-cream tracking-[0.06em] mb-2">
                      How it works
                    </p>
                    <ol className="space-y-2 font-syne text-sm text-cream/75 list-decimal pl-5">
                      <li>Drop in your resume PDF (max 5 MB).</li>
                      <li>Ninny returns strengths, weaknesses, and Socratic questions.</li>
                      <li>You answer each question. Ninny rewrites the bullet on the spot.</li>
                      <li>Download a markdown of your improved bullets to paste into your resume.</li>
                    </ol>
                  </div>
                  <ResumeUpload onAnalyzed={handleAnalyzed} />
                </>
              )}

              {/* ── Phase: analysis ────────────────────────────────── */}
              {phase === "analysis" && analysis && (
                <ResumeAnalysisView analysis={analysis} onStartSocratic={startSocratic} />
              )}

              {/* ── Phase: socratic ────────────────────────────────── */}
              {phase === "socratic" && analysis && sessionId && (
                <>
                  <SocraticBubble
                    key={socraticIndex /* hard-reset bubble state per question */}
                    sessionId={sessionId}
                    questionIndex={socraticIndex}
                    total={analysis.questions.length}
                    question={analysis.questions[socraticIndex]}
                    initialImproved={improvedByIndex[socraticIndex]}
                    onAccept={acceptImproved}
                    onSkip={advanceSocratic}
                  />

                  {/* Inline nav to skip ahead to final review when the
                      user has answered enough — they can always come back. */}
                  {Object.keys(improvedByIndex).length > 0 && (
                    <div className="mt-6 flex justify-end animate-slide-up">
                      <button
                        type="button"
                        onClick={() => setPhase("final")}
                        className="inline-flex items-center gap-2 font-syne text-xs uppercase tracking-[0.15em] text-cream/65 hover:text-gold transition-colors"
                      >
                        Skip to final review
                        <ArrowRight size={12} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ── Phase: final ───────────────────────────────────── */}
              {phase === "final" && sessionId && (
                <FinalReview
                  sessionId={sessionId}
                  pairs={finalPairs}
                  onStartOver={startOver}
                />
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}

/**
 * Free-tier upsell. Shown to anyone whose effective plan is not Pro
 * (or Platinum). The server enforces the same gate — this is just to
 * keep free users out of the upload UI entirely.
 */
function ProUpsell() {
  return (
    <div
      className="rounded-2xl p-7 sm:p-10 animate-slide-up"
      style={{
        background:
          "linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(255,215,0,0.08) 60%, rgba(12,16,32,0.95) 100%)",
        border: "1px solid rgba(255,215,0,0.30)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <Crown size={22} weight="fill" color="#FFD700" aria-hidden="true" />
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold">
          pro feature
        </p>
      </div>
      <h2 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.08em] leading-tight max-w-xl">
        Resume Coach is part of Lionade Pro
      </h2>
      <p className="font-syne text-sm sm:text-base text-cream/70 mt-4 max-w-2xl">
        Pro unlocks Ninny&rsquo;s resume critique, Socratic per-bullet rewrites, and a
        markdown export you can paste into your existing resume. Plus 1.5&times; Fangs on
        every quiz, three Mastery Mode exams at once, and no popup ads.
      </p>
      <div className="mt-6 flex items-center gap-3 flex-wrap">
        <Link
          href="/pricing"
          className="btn-gold inline-flex items-center gap-2 px-6 py-3 rounded-full font-syne font-bold text-sm uppercase tracking-[0.15em]"
        >
          Upgrade to Pro
          <ArrowRight size={16} weight="bold" aria-hidden="true" />
        </Link>
        <Link
          href="/learn"
          className="inline-flex items-center gap-2 font-syne text-xs uppercase tracking-[0.15em] text-cream/55 hover:text-cream transition-colors"
        >
          Back to learn
        </Link>
      </div>
    </div>
  );
}
