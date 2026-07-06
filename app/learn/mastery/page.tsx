"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  ArrowRight, Brain, Target, Clock, Sparkle,
  CaretLeft, NotePencil, Warning, X, Lock,
  ChatCircleText, GraduationCap, ListChecks, ArrowsClockwise,
} from "@phosphor-icons/react";
import { PLAN_EXAM_LIMITS } from "@/lib/mastery-plan";
import SpaceBackground from "@/components/SpaceBackground";
import RevealText from "@/components/RevealText";
import { apiDelete, apiPost, swrFetcher } from "@/lib/api-client";
import MasteryProgressBar from "@/components/Mastery/MasteryProgressBar";
import PhotoImport from "@/components/PhotoImport";

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
  // swrFetcher throws on non-2xx, so a failed fetch lands in `examsError`
  // instead of silently resolving to "no exams."
  const { data, error: examsError, isLoading: loadingExams, mutate: mutateExams } = useSWR<{ exams: ExamSummary[] }>(
    "/api/mastery/exams", swrFetcher,
    { keepPreviousData: true },
  );
  const exams = data?.exams ?? [];

  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const inputFieldId = useId();
  const inputErrorId = useId();
  const [limitHit, setLimitHit] = useState<null | { plan: string; limit: number; current: number; message: string }>(null);
  const [archiving, setArchiving] = useState(false);

  // "Archive an old one" targets the most harmless candidate: a mastered
  // target first (it's finished), otherwise the least recently studied one.
  const oldestExam = exams.length === 0 ? null : [...exams].sort((a, b) => {
    const aDone = a.reachedMasteryAt ? 0 : 1;
    const bDone = b.reachedMasteryAt ? 0 : 1;
    if (aDone !== bDone) return aDone - bDone;
    return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  })[0];

  const archiveOldest = async () => {
    if (!oldestExam || archiving) return;
    setArchiving(true);
    const prev = data;
    // Optimistic removal — the card disappears and a cap slot frees up
    // immediately; the paywall closes so the user can retry Start session.
    await mutateExams(
      { exams: exams.filter(e => e.id !== oldestExam.id) },
      { revalidate: false },
    );
    setLimitHit(null);
    setError(null);
    try {
      const r = await apiDelete(`/api/mastery/exams/${oldestExam.id}`);
      if (!r.ok) throw new Error(r.error ?? "archive failed");
      // Confirm against the server so the list reflects reality.
      void mutateExams();
    } catch (e) {
      console.error("[mastery:archive-exam] failed", e);
      // Roll back the optimistic removal so no target silently vanishes.
      await mutateExams(prev, { revalidate: false });
      setError("Couldn't archive that target. Try again.");
    } finally {
      setArchiving(false);
    }
  };

  // Photo import (client-side OCR) drops its recognized text into the same
  // input the textarea feeds, so the existing parse flow handles it unchanged.
  // Appends to whatever's already typed rather than clobbering it.
  const handleOcrExtract = (text: string) => {
    setError(null);
    setInput((prev) => {
      const base = prev.trim();
      const merged = base ? `${base}\n${text}` : text;
      return merged.slice(0, 8000);
    });
  };

  const submit = async () => {
    const cleaned = input.trim();
    if (cleaned.length < 3 || parsing) return;
    setParsing(true);
    setError(null);
    try {
      const r = await apiPost<ParsedResponse>("/api/mastery/parse", { input: cleaned });
      if (!r.ok || !r.data) {
        console.error("[mastery:parse] failed", r.error);
        setError("Couldn't parse that. Try a different topic.");
      } else {
        setParsed(r.data);
      }
    } catch (e) {
      console.error("[mastery:parse] threw", e);
      setError("Network's being weird. Try again.");
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
        console.error("[mastery:create-exam] failed", create.error);
        setError("Couldn't save that target. Try again.");
        setCreating(false);
        return;
      }
      const session = await apiPost<{ sessionId: string }>(
        `/api/mastery/exams/${create.data.examId}/sessions`, {},
      );
      if (!session.ok || !session.data?.sessionId) {
        console.error("[mastery:start-session] failed", session.error);
        setError("Couldn't start a session. Try again.");
        setCreating(false);
        return;
      }
      router.push(
        classIdContext
          ? `/learn/mastery/${create.data.examId}?classId=${classIdContext}`
          : `/learn/mastery/${create.data.examId}`,
      );
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy text-cream overflow-x-hidden">
      <SpaceBackground />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-24">
        {/* Breadcrumb — returns to the class notebook if we entered from one,
            else falls back to /learn. PRESERVED: classIdContext routing. */}
        <Link
          href={classIdContext ? `/classes/${classIdContext}` : "/learn"}
          className="inline-flex items-center gap-1.5 rounded-md font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 hover:text-cream mb-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
        >
          <CaretLeft size={12} weight="bold" aria-hidden="true" /> {classIdContext ? "Class" : "Learn"}
        </Link>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <Brain size={16} className="text-gold" weight="fill" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold">
              Master What Counts
            </span>
          </div>
          <h1 className="font-bebas text-5xl sm:text-6xl lg:text-7xl tracking-[0.04em] text-cream leading-[0.92]">
            what do you<br className="hidden sm:block" />{" "}
            <span className="bg-gradient-to-r from-gold via-[#F0B429] to-gold bg-clip-text text-transparent">
              want to master?
            </span>
          </h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cream/55 mt-4 max-w-[520px] leading-relaxed">
            Ninny teaches and quizzes until you&apos;re ready. Slow burn. Real grind.
          </p>
        </div>

        {/* ═══ 2-COLUMN: funnel LEFT, targets / explainer RIGHT ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

        {/* ── LEFT: the create / parse funnel ── */}
        <div>
        {/* New target form */}
        {!parsed && (
          <section>
            <label htmlFor={inputFieldId} className="sr-only">
              What do you want to master? Name an exam, a unit, or paste a syllabus.
            </label>
            <div className={`mastery-focus-glow rounded-[14px] bg-white/[0.025] border border-white/[0.09] p-5 sm:p-6 transition-shadow ${parsing ? "mastery-parsing" : ""}`}>
              <textarea
                id={inputFieldId}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 8000))}
                disabled={parsing}
                rows={6}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? inputErrorId : undefined}
                placeholder="Examples:
• AWS Security Specialty (SCS-C02)
• Calculus 1 midterm: derivatives, integrals, limits, chain rule
• AP Chemistry unit on thermochemistry
• Or paste your syllabus and Ninny will parse it."
                className="relative z-10 w-full resize-none bg-transparent border-none focus:outline-none
                  text-[15px] text-cream placeholder:text-cream/45 leading-relaxed font-sans"
              />
            </div>
            <PhotoImport onExtract={handleOcrExtract} disabled={parsing} />
            {error && (
              <div id={inputErrorId} role="alert" className="mt-3 flex items-start gap-2 text-[12px] text-[#FCA5A5]">
                <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between gap-4">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55" aria-hidden="true">
                {input.length} / 8000 chars
              </span>
              <button
                type="button"
                onClick={submit}
                disabled={parsing || input.trim().length < 3}
                aria-busy={parsing}
                className="group flex items-center gap-2 min-h-[44px] rounded-full bg-gold hover:bg-gold/90
                  text-navy font-mono text-[11px] uppercase tracking-[0.25em]
                  px-5 py-2.5 transition-all duration-200
                  disabled:opacity-40 disabled:cursor-not-allowed
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                {parsing ? (
                  <>
                    <span>Ninny's reading</span>
                    <span aria-hidden="true" className="inline-flex items-center gap-0.5 ml-0.5">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1 h-1 rounded-full bg-navy pa-ink-dot"
                          style={{ animationDelay: `${i * 200}ms` }}
                        />
                      ))}
                    </span>
                  </>
                ) : (
                  <>
                    Start
                    <ArrowRight size={14} weight="bold" aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </div>
          </section>
        )}

        {/* Parsed — broad case */}
        {parsed && parsed.scope === "broad" && (
          <section className="animate-slide-in-left">
            <div className="flex gap-3">
              <div aria-hidden="true" className="shrink-0 w-[28px] h-[28px] rounded-full grid place-items-center text-[10px] font-mono tracking-wider bg-[#A855F7]/[0.15] border border-[#A855F7]/30 text-[#A855F7]">
                N
              </div>
              <div role="status" className="max-w-[580px] rounded-[10px] rounded-tl-[2px] bg-white/[0.04] border border-white/[0.06] px-4 py-3 text-[14px] leading-relaxed text-cream/90">
                {parsed.clarification}
              </div>
            </div>
            <div className="mt-4 pl-[40px] flex flex-col gap-2">
              <label htmlFor={`${inputFieldId}-narrow`} className="sr-only">Narrow down your topic</label>
              <textarea
                id={`${inputFieldId}-narrow`}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 8000))}
                disabled={parsing}
                rows={3}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="Narrow it down here…"
                className="w-full resize-none rounded-[8px] bg-white/[0.03] border border-white/[0.08]
                  focus:border-gold/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 px-4 py-3 text-[14px] text-cream
                  placeholder:text-cream/45 leading-relaxed"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setParsed(null); setError(null); }}
                  className="min-h-[44px] rounded-md font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 hover:text-cream px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                >
                  Start over
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={parsing || input.trim().length < 3}
                  aria-busy={parsing}
                  className="min-h-[44px] rounded-full bg-gold hover:bg-gold/90 text-navy font-mono text-[11px] uppercase tracking-[0.25em]
                    px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                >
                  {parsing ? "Ninny's reading…" : "Submit"}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Parsed — specific case, show preview + confirm */}
        {parsed && parsed.scope === "specific" && (
          <section className="animate-slide-in-left">
            <div className="rounded-[12px] bg-gradient-to-br from-[#A855F7]/[0.08] via-gold/[0.05] to-white/[0.02] border border-[#A855F7]/30 p-5"
              style={{ boxShadow: "0 0 30px rgba(168,85,247,0.08)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Sparkle size={14} className="text-[#A855F7]" weight="fill" aria-hidden="true" />
                <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-[#A855F7]">
                  Ninny locked your target
                </span>
              </div>
              <h3 className="font-bebas text-[28px] tracking-wider text-cream leading-tight mb-1">
                <RevealText text={parsed.title} delay={0.18} charDelay={0.035} />
              </h3>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 mb-4">
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
              {/* confirmAndStart sets `error` on failure; surface it here so a
                  failed create/start isn't silent (the funnel-view error block
                  is hidden once we're in the parsed/specific state). */}
              {error && (
                <div role="alert" className="mb-3 flex items-start gap-2 text-[12px] text-[#FCA5A5]">
                  <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setParsed(null); setError(null); }}
                  className="min-h-[44px] rounded-md font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 hover:text-cream px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={confirmAndStart}
                  disabled={creating}
                  aria-busy={creating}
                  className="group flex items-center gap-2 min-h-[44px] rounded-full bg-gold hover:bg-gold/90
                    text-navy font-mono text-[11px] uppercase tracking-[0.25em]
                    px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                >
                  {creating ? "Starting session…" : "Start session"}
                  <ArrowRight size={14} weight="bold" aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>
          </section>
        )}

        </div>{/* ── end LEFT funnel column ── */}

        {/* ── RIGHT: targets list, or the "how Mastery works" explainer ── */}
        <div className="animate-slide-up" style={{ animationDelay: "0.08s" }}>
          {loadingExams && exams.length === 0 ? (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="h-28 rounded-[10px] bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          ) : examsError && !data ? (
            /* Fetch failed with nothing cached. Show an error + retry instead
               of the explainer, which would read as "you have no targets." */
            <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
              <p className="font-syne text-sm text-red-300 mb-3">
                Couldn't load your targets. They're still there, this page just blinked.
              </p>
              <button
                type="button"
                onClick={() => mutateExams()}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
                Try again
              </button>
            </div>
          ) : exams.length > 0 ? (
            <section>
              <h2 className="font-bebas text-sm text-cream tracking-[0.2em] mb-3">YOUR TARGETS</h2>
              <div className="grid grid-cols-1 gap-3">
                {exams.map(e => (
                  <ExamCard key={e.id} exam={e} />
                ))}
              </div>
            </section>
          ) : (
            /* No targets yet — fill the right half with a 3-step explainer so
               the layout is never half-empty during the create step. */
            <section
              className="rounded-[12px] p-6"
              style={{
                background: "linear-gradient(160deg, rgba(168,85,247,0.06) 0%, rgba(255,255,255,0.02) 60%)",
                border: "1px solid rgba(168,85,247,0.18)",
                boxShadow: "0 0 30px rgba(168,85,247,0.05)",
              }}
            >
              <div className="flex items-center gap-2 mb-5">
                <Brain size={16} className="text-[#A855F7]" weight="fill" aria-hidden="true" />
                <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">HOW MASTERY WORKS</h2>
              </div>
              <ol className="space-y-4">
                {[
                  { Icon: NotePencil,    title: "Describe it", body: "Name an exam, a unit, or paste a syllabus. Ninny parses it into weighted subtopics." },
                  { Icon: ChatCircleText, title: "Ninny teaches + quizzes", body: "A chat-first loop: short lessons, then questions. It adapts to what you miss." },
                  { Icon: GraduationCap, title: "Grind to 100%", body: "The bar fills slowly and honestly. Reaching ready means you've actually earned it." },
                ].map((step, i) => {
                  const StepIcon = step.Icon;
                  return (
                    <li key={i} className="flex items-start gap-3">
                      <span className="shrink-0 w-9 h-9 grid place-items-center rounded-xl"
                        style={{ background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.3)", color: "#A855F7" }}>
                        <StepIcon size={18} weight="fill" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="font-bebas text-base text-cream tracking-wider leading-none mb-1">
                          <span className="text-[#A855F7] mr-1.5">{i + 1}.</span>{step.title}
                        </p>
                        <p className="text-cream/60 text-[12.5px] leading-relaxed font-sans">{step.body}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-5 pt-4 border-t border-white/[0.06] flex items-center gap-2">
                <ListChecks size={14} className="text-cream/55" weight="bold" aria-hidden="true" />
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/60">
                  Describe your first target to begin
                </p>
              </div>
            </section>
          )}
        </div>{/* ── end RIGHT column ── */}

        </div>{/* ── end 2-column grid ── */}
      </div>

      {limitHit && (
        <LimitPaywall
          state={limitHit}
          archiveTitle={oldestExam?.title ?? null}
          onArchive={archiveOldest}
          onClose={() => setLimitHit(null)}
        />
      )}
    </div>
  );
}

// ── Limit-hit paywall ────────────────────────────────────────────────────────
function LimitPaywall({
  state, archiveTitle, onArchive, onClose,
}: {
  state: { plan: string; limit: number; current: number; message: string };
  /** Title of the target that "Archive an old one" will hide (null = none). */
  archiveTitle: string | null;
  onArchive: () => void;
  onClose: () => void;
}) {
  const isFree = state.plan === "free";
  const upgradeTo = isFree ? "pro" : "platinum";
  const nextLimit = PLAN_EXAM_LIMITS[upgradeTo as "pro" | "platinum"];

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Focus management: remember the trigger, focus the close button on open,
  // restore focus on unmount. Escape closes; Tab is trapped within the panel.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={panelRef} className="relative w-full max-w-md rounded-[14px] border border-gold/30 bg-gradient-to-br from-navy to-[#0a0f1d] p-6 shadow-2xl">
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Close mastery limit dialog"
          className="absolute top-3 right-3 text-cream/55 hover:text-cream grid place-items-center w-9 h-9 rounded-full hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <Lock size={14} className="text-gold" weight="fill" aria-hidden="true" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Mastery limit reached
          </span>
        </div>
        <h3 id={titleId} className="font-bebas text-[28px] tracking-wider text-cream leading-tight mb-2">
          Focus is good. More focus is better.
        </h3>
        <p className="text-[13px] text-cream/80 leading-relaxed mb-5">
          {state.message}
        </p>

        <div className="rounded-[10px] bg-white/[0.03] border border-white/[0.06] p-3 mb-5">
          <div className="flex items-baseline justify-between mb-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
              {state.plan}
            </span>
            <span className="font-bebas text-[22px] tracking-wider text-cream tabular-nums">
              {state.current} / {state.limit}
            </span>
          </div>
          {isFree && (
            <div className="flex items-baseline justify-between text-gold">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em]">
                pro · {nextLimit} targets
              </span>
              <span className="font-bebas text-[14px] tracking-wider">$4.99 / mo</span>
            </div>
          )}
          {state.plan === "pro" && (
            <div className="flex items-baseline justify-between text-gold">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em]">
                platinum · {nextLimit} targets
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onArchive}
            disabled={!archiveTitle}
            className="flex-1 min-h-[44px] rounded-full border border-white/[0.1] text-cream/75 hover:text-cream hover:border-white/[0.25] font-mono text-[11px] uppercase tracking-[0.25em] py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            Archive an old one
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[44px] rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[11px] uppercase tracking-[0.25em] py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            Upgrade
          </button>
        </div>
        {archiveTitle && (
          <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.2em] text-cream/45 text-center">
            Archives your oldest target: {archiveTitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Exam card ────────────────────────────────────────────────────────────────
function relativeStudied(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return null;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  return `${wk}w ago`;
}

function ExamCard({ exam }: { exam: ExamSummary }) {
  const hours = Math.floor(exam.totalActiveSeconds / 3600);
  const mins = Math.floor((exam.totalActiveSeconds % 3600) / 60);
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const mastered = !!exam.reachedMasteryAt;
  const lastStudied = relativeStudied(exam.updatedAt);

  return (
    <Link
      href={`/learn/mastery/${exam.id}`}
      aria-label={`${exam.title}, ${Math.round(exam.overallDisplayPct)} percent mastered${exam.activeSessionId ? ", session live now" : ""}`}
      className={`
        mastery-exam-card group block rounded-[12px] border px-4 py-4
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
        ${mastered
          ? "bg-gradient-to-br from-gold/[0.08] via-gold/[0.03] to-white/[0.02] border-gold/30 hover:border-gold/50"
          : "bg-white/[0.035] border-white/[0.07] hover:border-white/[0.18] hover:bg-white/[0.055]"}
      `}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-bebas text-[22px] tracking-wider text-cream leading-tight">
          {exam.title}
        </h3>
        {mastered && <Sparkle size={14} className="text-gold shrink-0 mt-1" weight="fill" aria-hidden="true" />}
      </div>
      <MasteryProgressBar value={exam.overallDisplayPct} readyThreshold={exam.readyThreshold} />
      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">
        <span className="flex items-center gap-1">
          <Target size={10} weight="bold" aria-hidden="true" /> <span aria-label={`${exam.subtopicCount} subtopics`}>{exam.subtopicCount}</span>
        </span>
        <span className="flex items-center gap-1">
          <Clock size={10} weight="bold" aria-hidden="true" /> <span aria-label={`${timeLabel} studied`}>{timeLabel}</span>
        </span>
        {lastStudied && !exam.activeSessionId && (
          <span className="hidden sm:inline text-cream/55">{lastStudied}</span>
        )}
        {exam.activeSessionId && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-gold">
            <span className="relative grid place-items-center" aria-hidden="true">
              <span className="absolute w-2 h-2 rounded-full bg-gold/40 mastery-live-pulse" />
              <span className="relative w-1.5 h-1.5 rounded-full bg-gold" />
            </span>
            live
          </span>
        )}
      </div>
    </Link>
  );
}
