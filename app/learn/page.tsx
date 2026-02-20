"use client";

import { useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";

function ComingSoonModal({ title, description, onClose }: { title: string; description: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative card max-w-sm w-full text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-4xl mb-3">&#x1F680;</div>
        <p className="font-bebas text-2xl text-cream tracking-wider mb-2">{title}</p>
        <p className="text-cream/50 text-sm leading-relaxed mb-5">{description}</p>
        <button
          onClick={onClose}
          className="font-syne font-bold text-sm px-6 py-2 rounded-lg transition-all duration-200
            active:scale-95 text-navy bg-electric hover:bg-electric-light"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export default function LearnPage() {
  const [modal, setModal] = useState<{ title: string; description: string } | null>(null);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy pt-16 pb-20 md:pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header */}
          <div className="mb-8 animate-slide-up">
            <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider">LEARN</h1>
            <p className="text-cream/40 text-sm mt-1">Pick your path. Every question earns you coins.</p>
          </div>

          {/* ═══ Quick Practice ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            <h2 className="font-bebas text-lg text-cream/60 tracking-wider mb-3">QUICK PRACTICE</h2>
            <Link href="/quiz">
              <div className="card-hover p-6 rounded-xl group cursor-pointer" style={{ borderColor: "#4A90D930" }}>
                <div className="flex items-center gap-4">
                  <span className="text-4xl group-hover:scale-110 transition-transform duration-300 inline-block">&#x1F9E0;</span>
                  <div className="flex-1">
                    <p className="font-bebas text-2xl tracking-wider text-electric">Daily Quiz</p>
                    <p className="text-cream/50 text-sm mt-0.5">Test your knowledge with 10 questions. Earn coins and XP for every correct answer.</p>
                  </div>
                  <span className="text-cream/30 text-xl hidden sm:block">&#x2192;</span>
                </div>
              </div>
            </Link>
          </div>

          {/* ═══ Structured Learning ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <h2 className="font-bebas text-lg text-cream/60 tracking-wider mb-3">STRUCTURED LEARNING</h2>
            <Link href="/quiz">
              <div className="card-hover p-6 rounded-xl group cursor-pointer" style={{ borderColor: "#9B59B630" }}>
                <div className="flex items-center gap-4">
                  <span className="text-4xl group-hover:scale-110 transition-transform duration-300 inline-block">&#x1F4DA;</span>
                  <div className="flex-1">
                    <p className="font-bebas text-2xl tracking-wider" style={{ color: "#9B59B6" }}>Subjects</p>
                    <p className="text-cream/50 text-sm mt-0.5">Pick a subject and practice at your own pace. Track mastery across 7 categories.</p>
                  </div>
                  <span className="text-cream/30 text-xl hidden sm:block">&#x2192;</span>
                </div>
              </div>
            </Link>
          </div>

          {/* ═══ Focus Mode ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.15s" }}>
            <h2 className="font-bebas text-lg text-cream/60 tracking-wider mb-3">FOCUS MODE</h2>
            <Link href="/quiz">
              <div className="card-hover p-6 rounded-xl group cursor-pointer" style={{ borderColor: "#2ECC7130" }}>
                <div className="flex items-center gap-4">
                  <span className="text-4xl group-hover:scale-110 transition-transform duration-300 inline-block">&#x1F4DD;</span>
                  <div className="flex-1">
                    <p className="font-bebas text-2xl tracking-wider" style={{ color: "#2ECC71" }}>Practice Sets</p>
                    <p className="text-cream/50 text-sm mt-0.5">Curated question sets grouped by difficulty. Perfect for focused study sessions.</p>
                  </div>
                  <span className="text-cream/30 text-xl hidden sm:block">&#x2192;</span>
                </div>
              </div>
            </Link>
          </div>

          {/* ═══ AI Study Mode ═══ */}
          <div className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
            <h2 className="font-bebas text-lg text-cream/60 tracking-wider mb-3">AI STUDY MODE</h2>
            <div className="relative card p-6 rounded-xl" style={{ borderColor: "#E67E2230" }}>
              <span className="absolute top-4 right-4 text-[10px] font-bold uppercase tracking-widest
                px-2 py-0.5 rounded-full border text-cream/50"
                style={{ borderColor: "#E67E2240", background: "#E67E2215" }}>
                Soon
              </span>
              <div className="flex items-start gap-4">
                <span className="text-4xl">&#x1F916;</span>
                <div className="flex-1">
                  <p className="font-bebas text-2xl tracking-wider" style={{ color: "#E67E22" }}>Study With Ninny</p>
                  <p className="text-cream/50 text-sm mt-0.5 leading-relaxed">
                    Upload anything or tell Ninny what you&apos;re studying. Get summaries, flashcards, and practice questions.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => setModal({
                        title: "Upload Material",
                        description: "Soon you\u2019ll be able to upload PDFs, notes, slides, or images. Ninny will generate summaries, flashcards, and custom practice questions from your material.",
                      })}
                      className="font-syne font-semibold text-sm px-4 py-2 rounded-lg border border-electric/30
                        text-cream/70 hover:text-cream hover:bg-electric/10 transition-all duration-200"
                    >
                      Upload Material
                    </button>
                    <button
                      onClick={() => setModal({
                        title: "Tell Ninny What to Study",
                        description: "Describe a topic, paste a question, or tell Ninny what exam you\u2019re preparing for. Ninny will create a personalized study plan with practice questions and explanations.",
                      })}
                      className="font-syne font-semibold text-sm px-4 py-2 rounded-lg border border-electric/30
                        text-cream/70 hover:text-cream hover:bg-electric/10 transition-all duration-200"
                    >
                      Tell Ninny What to Study
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Coming Soon Modal */}
      {modal && (
        <ComingSoonModal
          title={modal.title}
          description={modal.description}
          onClose={() => setModal(null)}
        />
      )}
    </ProtectedRoute>
  );
}
