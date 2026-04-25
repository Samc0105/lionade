"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  ArrowRight, Brain, Target, Clock, Sparkle,
  CaretLeft, NotePencil, Warning, X, Lock,
} from "@phosphor-icons/react";
import { PLAN_EXAM_LIMITS } from "@/lib/mastery-plan";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiPost, swrFetcher } from "@/lib/api-client";
import MasteryProgressBar from "@/components/Mastery/MasteryProgressBar";

/**
 * Mastery Mode landing page.
 *
 * Two surfaces in one route:
 *   1. The new-target funnel — a single big textarea, submit, Ninny parses
 *      and either asks to narrow or returns subtopics. The user confirms
 *      and an exam row is created, then the user is redirected to the
 *      session page.
 *   2. The list of existing targets (if any) — glass cards with overall
 *      display % and time-to-master so far.
 */

interface ExamSummary {
  id: string;
  title: string;
  scope: string;
  targetDate: string | null;
  readyThreshold: number;
  totalActiveSeconds: number;
  reachedMasteryAt: string | null;
  updatedAt: string;
  overallDisplayPct: number;
  subtopicCount: number;
  activeSessionId: string | null;
}

interface ParsedSubtopic {
  slug: string;
  name: string;
  weight: number;
  short_summary: string;
  contentHash: string;
}

type ParsedResponse =
  | { scope: "broad"; clarification: string }
  | { scope: "specific"; title: string; topicHash: string; subtopics: ParsedSubtopic[] };

export default function MasteryLandingPage() {
  const router = useRouter();
  // When this page is opened from inside a class notebook, the URL carries
  // ?classId=<uuid>. Created exam targets get attached to that class so
  // they show up under the right notebook automatically.
  const searchParams = useSearchParams();
  const classIdContext = searchParams?.get("classId") ?? null;
  const { data, isLoading: loadingExams } = useSWR<{ exams: ExamSummary[] }>(
    "/api/mastery/exams", swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const exams = data?.exams ?? [];

  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [limitHit, setLimitHit] = useState<null | { plan: string; limit: number; current: number; message: string }>(null);

  const submit = async () => {
    const cleaned = input.trim();
    if (cleaned.length < 3 || parsing) return;
    setParsing(true);
    setError(null);
    try {
      const r = await apiPost<ParsedResponse>("/api/mastery/parse", { input: cleaned });
      if (!r.ok || !r.data) {
        setError(r.error || "Couldn't parse that.");
      } else {
        setParsed(r.data);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const confirmAndStart = async () => {
    if (!parsed || parsed.scope !== "specific" || creating) return;
    setCreating(true);
    try {
      const create = await apiPost<{ examId?: string; error?: string; plan?: string; limit?: number; current?: number; message?: string }>(
        "/api/mastery/exams",
        {
          rawInput: input,
          title: parsed.title,
          topicHash: parsed.topicHash,
          subtopics: parsed.subtopics,
          // When opened from /classes/:id this attaches the new exam to the
          // class notebook automatically. Server validates ownership.
          classId: classIdContext,
        },
      );
      // 403 LIMIT → show paywall instead of a generic error
      if (create.status === 403 && create.data?.error === "LIMIT") {
        setLimitHit({
          plan: create.data.plan ?? "free",
          limit: create.data.limit ?? 1,
          current: create.data.current ?? 0,
          message: create.data.message ?? "You've hit your plan's active-exam cap.",
        });
        setCreating(false);
        return;
      }
      if (!create.ok || !create.data?.examId) {
        setError(create.error || "Couldn't save that target.");
        setCreating(false);
        return;
      }
      const session = await apiPost<{ sessionId: string }>(
        `/api/mastery/exams/${create.data.examId}/sessions`, {},
      );
      if (!session.ok || !session.data?.sessionId) {
        setError(session.error || "Couldn't start a session.");
        setCreating(false);
        return;
      }
      router.push(`/learn/mastery/${create.data.examId}`);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy text-cream overflow-x-hidden">
      <SpaceBackground />
      <Navbar />

      <main className="relative z-10 max-w-[980px] mx-auto px-4 sm:px-6 pt-8 pb-24">
        {/* Breadcrumb */}
        <Link
          href="/learn"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream mb-4 transition-colors"
        >
          <CaretLeft size={12} weight="bold" /> Learn
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Brain size={16} className="text-gold" weight="fill" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold">
              Mastery Mode
            </span>
          </div>
          <h1 className="font-bebas text-4xl sm:text-5xl tracking-[0.06em] text-cream leading-none">
            what do you want to master?
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/50 mt-3">
            Ninny teaches + quizzes until you're ready. Slow burn — real grind.
          </p>
        </div>

        {/* New target form */}
        {!parsed && (
          <section className="mb-12">
            <div className="rounded-[12px] bg-white/[0.03] border border-white/[0.08] p-4 sm:p-5">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 8000))}
                disabled={parsing}
                rows={5}
                placeholder="Examples:
• AWS Security Specialty (SCS-C02)
• Calculus 1 midterm — derivatives, integrals, limits, chain rule
• AP Chemistry unit on thermochemistry
• Or paste your syllabus — I'll parse it."
                className="w-full resize-none bg-transparent border-none focus:outline-none
                  text-[15px] text-cream placeholder:text-cream/30 leading-relaxed font-sans"
              />
            </div>
            {error && (
              <div className="mt-3 flex items-start gap-2 text-[12px] text-[#EF4444]">
                <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40">
                {input.length} / 8000 chars
              </span>
              <button
                onClick={submit}
                disabled={parsing || input.trim().length < 3}
                className="group flex items-center gap-2 rounded-full bg-gold hover:bg-gold/90
                  text-navy font-mono text-[11px] uppercase tracking-[0.25em]
                  px-5 py-2.5 transition-all duration-200
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {parsing ? "Ninny's reading…" : "Start"}
                <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </section>
        )}

        {/* Parsed — broad case */}
        {parsed && parsed.scope === "broad" && (
          <section className="mb-12">
            <div className="flex gap-3">
              <div className="shrink-0 w-[28px] h-[28px] rounded-full grid place-items-center text-[10px] font-mono tracking-wider bg-[#A855F7]/[0.15] border border-[#A855F7]/30 text-[#A855F7]">
                N
              </div>
              <div className="max-w-[580px] rounded-[10px] rounded-tl-[2px] bg-white/[0.04] border border-white/[0.06] px-4 py-3 text-[14px] leading-relaxed text-cream/90">
                {parsed.clarification}
              </div>
            </div>
            <div className="mt-4 pl-[40px] flex flex-col gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 8000))}
                disabled={parsing}
                rows={3}
                placeholder="Narrow it down here…"
                className="w-full resize-none rounded-[8px] bg-white/[0.03] border border-white/[0.08]
                  focus:border-gold/40 focus:outline-none px-4 py-3 text-[14px] text-cream
                  placeholder:text-cream/30 leading-relaxed"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setParsed(null); setError(null); }}
                  className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream px-3 py-2"
                >
                  Start over
                </button>
                <button
                  onClick={submit}
                  disabled={parsing || input.trim().length < 3}
                  className="rounded-full bg-gold hover:bg-gold/90 text-navy font-mono text-[11px] uppercase tracking-[0.25em]
                    px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {parsing ? "Ninny's reading…" : "Submit"}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Parsed — specific case, show preview + confirm */}
        {parsed && parsed.scope === "specific" && (
          <section className="mb-12">
            <div className="rounded-[12px] bg-gradient-to-br from-gold/[0.06] to-white/[0.02] border border-gold/30 p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkle size={14} className="text-gold" weight="fill" />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-gold">
                  Target locked
                </span>
              </div>
              <h3 className="font-bebas text-[28px] tracking-wider text-cream leading-tight mb-1">
                {parsed.title}
              </h3>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 mb-4">
                {parsed.subtopics.length} subtopics · weighted
              </p>
              <ul className="flex flex-col gap-2 mb-5">
                {parsed.subtopics.map(s => (
                  <li key={s.slug} className="flex items-start gap-3 rounded-[8px] bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-gold tabular-nums shrink-0 mt-0.5 w-[38px]">
                      {Math.round(s.weight * 100)}%
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-cream/95 leading-tight mb-0.5">{s.name}</div>
                      {s.short_summary && (
                        <div className="text-[11.5px] text-cream/55 leading-snug">{s.short_summary}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setParsed(null); setError(null); }}
                  className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream px-3 py-2"
                >
                  Back
                </button>
                <button
                  onClick={confirmAndStart}
                  disabled={creating}
                  className="group flex items-center gap-2 rounded-full bg-gold hover:bg-gold/90
                    text-navy font-mono text-[11px] uppercase tracking-[0.25em]
                    px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {creating ? "Starting session…" : "Start session"}
                  <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Existing exams */}
        {exams.length > 0 && (
          <section>
            <h2 className="font-bebas text-sm text-cream tracking-[0.2em] mb-3">YOUR TARGETS</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {exams.map(e => (
                <ExamCard key={e.id} exam={e} />
              ))}
            </div>
          </section>
        )}

        {exams.length === 0 && !loadingExams && !parsed && (
          <section className="rounded-[10px] bg-white/[0.02] border border-white/[0.05] p-6 text-center">
            <NotePencil size={20} className="text-cream/40 mx-auto mb-2" />
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/50">
              No targets yet — describe your first above.
            </p>
          </section>
        )}
      </main>

      {limitHit && <LimitPaywall state={limitHit} onClose={() => setLimitHit(null)} />}
    </div>
  );
}

// ── Limit-hit paywall ────────────────────────────────────────────────────────
function LimitPaywall({
  state, onClose,
}: {
  state: { plan: string; limit: number; current: number; message: string };
  onClose: () => void;
}) {
  const isFree = state.plan === "free";
  const upgradeTo = isFree ? "pro" : "platinum";
  const nextLimit = PLAN_EXAM_LIMITS[upgradeTo as "pro" | "platinum"];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-[14px] border border-gold/30 bg-gradient-to-br from-navy to-[#0a0f1d] p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-cream/40 hover:text-cream grid place-items-center w-7 h-7 rounded-full hover:bg-white/[0.05]"
        >
          <X size={14} weight="bold" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <Lock size={14} className="text-gold" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Mastery limit reached
          </span>
        </div>
        <h3 className="font-bebas text-[28px] tracking-wider text-cream leading-tight mb-2">
          Focus is good — more focus is better.
        </h3>
        <p className="text-[13px] text-cream/75 leading-relaxed mb-5">
          {state.message}
        </p>

        <div className="rounded-[10px] bg-white/[0.03] border border-white/[0.06] p-3 mb-5">
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50">
              {state.plan}
            </span>
            <span className="font-bebas text-[22px] tracking-wider text-cream tabular-nums">
              {state.current} / {state.limit}
            </span>
          </div>
          {isFree && (
            <div className="flex items-baseline justify-between text-gold">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em]">
                pro — {nextLimit} targets
              </span>
              <span className="font-bebas text-[14px] tracking-wider">$4.99 / mo</span>
            </div>
          )}
          {state.plan === "pro" && (
            <div className="flex items-baseline justify-between text-gold">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em]">
                platinum — {nextLimit} targets
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-white/[0.1] text-cream/70 hover:text-cream hover:border-white/[0.25] font-mono text-[11px] uppercase tracking-[0.25em] py-2.5 transition-colors"
          >
            Archive an old one
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[11px] uppercase tracking-[0.25em] py-2.5 transition-colors"
          >
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Exam card ────────────────────────────────────────────────────────────────
function ExamCard({ exam }: { exam: ExamSummary }) {
  const hours = Math.floor(exam.totalActiveSeconds / 3600);
  const mins = Math.floor((exam.totalActiveSeconds % 3600) / 60);
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const mastered = !!exam.reachedMasteryAt;

  return (
    <Link
      href={`/learn/mastery/${exam.id}`}
      className={`
        group block rounded-[10px] border px-4 py-4 transition-all duration-200
        ${mastered
          ? "bg-gradient-to-br from-gold/[0.06] to-white/[0.02] border-gold/25 hover:border-gold/40"
          : "bg-white/[0.03] border-white/[0.06] hover:border-white/[0.15] hover:bg-white/[0.05]"}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-bebas text-[22px] tracking-wider text-cream leading-tight">
          {exam.title}
        </h3>
        {mastered && <Sparkle size={14} className="text-gold shrink-0 mt-1" weight="fill" />}
      </div>
      <MasteryProgressBar value={exam.overallDisplayPct} readyThreshold={exam.readyThreshold} />
      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/50">
        <span className="flex items-center gap-1">
          <Target size={10} weight="bold" /> {exam.subtopicCount}
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} weight="bold" /> {timeLabel}
        </span>
        {exam.activeSessionId && (
          <span className="ml-auto text-gold">● live</span>
        )}
      </div>
    </Link>
  );
}
