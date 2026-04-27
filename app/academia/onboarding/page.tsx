"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GraduationCap, Backpack, Books, Briefcase, MaskHappy, Star, Buildings,
  Lightning, Coffee, Fire, ClockClockwise, ArrowRight, ArrowLeft, Check,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import SpaceBackground from "@/components/SpaceBackground";
import { apiPost, apiGet } from "@/lib/api-client";
import { toastError } from "@/lib/toast";

/**
 * Academia onboarding — REQUIRED gate before /academia is reachable.
 *
 *   - No skip button. No "later" link. Cancel is replaced with a Back step.
 *   - No Navbar render — this is a focused funnel page like /onboarding.
 *   - Five short steps, each 1–2 clicks. Total < 30 seconds for the
 *     fastest path.
 *
 * Persistence: each answer is staged client-side; only the final POST
 * stamps `academia_onboarded_at`. If the user closes the tab mid-way,
 * they're re-routed back here next time they hit /academia.
 */

const SCHOOL_TYPES = [
  { value: "middle",       label: "Middle school",  Icon: Backpack,      blurb: "Grades 6–8" },
  { value: "high",         label: "High school",    Icon: Books,         blurb: "Grades 9–12" },
  { value: "college",      label: "College / uni",  Icon: GraduationCap, blurb: "Undergrad, community college" },
  { value: "grad",         label: "Grad school",    Icon: Star,          blurb: "Master's, PhD, MBA" },
  { value: "professional", label: "Professional",   Icon: Briefcase,     blurb: "Certs, licenses, CPE" },
  { value: "self_study",   label: "Self-studying",  Icon: MaskHappy,     blurb: "No formal program" },
  { value: "other",        label: "Other",          Icon: Buildings,     blurb: "Bootcamp, vocational, etc." },
] as const;

const CLASS_COUNTS = [
  { value: 1, label: "1–2 classes",  blurb: "Light load" },
  { value: 3, label: "3–4 classes",  blurb: "Standard load" },
  { value: 5, label: "5–6 classes",  blurb: "Full plate" },
  { value: 7, label: "7+ classes",   blurb: "Heavy load" },
  { value: 0, label: "None right now", blurb: "Just here to study" },
] as const;

const INTENSITIES = [
  { value: "chill",     label: "Chill",     Icon: Coffee,           blurb: "Curious, no exam pressure" },
  { value: "steady",    label: "Steady",    Icon: ClockClockwise,   blurb: "Regular study, no fires" },
  { value: "grinding",  label: "Grinding",  Icon: Fire,             blurb: "Lots on the line, weekly tests" },
  { value: "cramming",  label: "Cramming",  Icon: Lightning,        blurb: "Big exam coming up SOON" },
] as const;

type SchoolType = typeof SCHOOL_TYPES[number]["value"];
type Intensity  = typeof INTENSITIES[number]["value"];

const TOTAL_STEPS = 5;

export default function AcademiaOnboardingPage() {
  return (
    <ProtectedRoute>
      <FormShell />
    </ProtectedRoute>
  );
}

function FormShell() {
  const router = useRouter();
  const [hydrating, setHydrating] = useState(true);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [schoolType, setSchoolType] = useState<SchoolType | null>(null);
  const [gradeYear, setGradeYear] = useState("");
  const [classCount, setClassCount] = useState<number | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [field, setField] = useState("");
  const [studyIntensity, setStudyIntensity] = useState<Intensity | null>(null);

  // If the user already onboarded, bounce them straight to /academia.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        type R = { onboarded: boolean };
        const r = await apiGet<R>("/api/academia/onboarding");
        if (alive && r.ok && r.data?.onboarded) {
          router.replace("/academia");
          return;
        }
      } catch {
        // fall through — show the form
      } finally {
        if (alive) setHydrating(false);
      }
    })();
    return () => { alive = false; };
  }, [router]);

  const canAdvance = (() => {
    switch (step) {
      case 1: return schoolType !== null;
      case 2: return classCount !== null;
      case 3: return true;          // grade/year + school name optional
      case 4: return true;          // field optional
      case 5: return studyIntensity !== null;
      default: return false;
    }
  })();

  const next = () => {
    if (!canAdvance) return;
    if (step < TOTAL_STEPS) {
      setStep(s => s + 1);
    } else {
      void submit();
    }
  };

  const back = () => { if (step > 1) setStep(s => s - 1); };

  const submit = async () => {
    if (submitting || !schoolType || !studyIntensity || classCount === null) return;
    setSubmitting(true);
    try {
      type R = { ok: boolean };
      const r = await apiPost<R>("/api/academia/onboarding", {
        schoolType,
        gradeYear: gradeYear.trim() || null,
        classCount,
        schoolName: schoolName.trim() || null,
        field: field.trim() || null,
        studyIntensity,
      });
      if (!r.ok) {
        toastError(r.error || "Couldn't save — try again.");
        setSubmitting(false);
        return;
      }
      router.replace("/academia");
    } catch (e) {
      toastError((e as Error).message || "Couldn't save.");
      setSubmitting(false);
    }
  };

  if (hydrating) {
    return (
      <div className="min-h-screen bg-navy text-cream flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy text-cream flex flex-col">
      <SpaceBackground />

      {/* Progress rail — also serves as visual "no escape" reassurance */}
      <header className="relative z-10 px-6 pt-6">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-2 mb-2">
            <GraduationCap size={14} className="text-gold" weight="fill" />
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold">
              Academia setup
            </p>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 tabular-nums">
              Step {step} / {TOTAL_STEPS}
            </span>
          </div>
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-gold to-electric transition-[width] duration-500"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>
      </header>

      {/* Form body */}
      <main className="relative z-10 flex-1 flex items-start sm:items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          {step === 1 && (
            <Step
              title="Where are you studying?"
              subtitle="So Lionade can match the workload + tone to your level."
            >
              <ChoiceGrid>
                {SCHOOL_TYPES.map(opt => (
                  <ChoiceCard
                    key={opt.value}
                    selected={schoolType === opt.value}
                    onClick={() => setSchoolType(opt.value)}
                    icon={<opt.Icon size={18} weight="fill" />}
                    label={opt.label}
                    blurb={opt.blurb}
                  />
                ))}
              </ChoiceGrid>
            </Step>
          )}

          {step === 2 && (
            <Step
              title="How many classes are you taking?"
              subtitle="Sets your default plan length and Daily Drill rotation."
            >
              <ChoiceGrid>
                {CLASS_COUNTS.map(opt => (
                  <ChoiceCard
                    key={opt.value}
                    selected={classCount === opt.value}
                    onClick={() => setClassCount(opt.value)}
                    label={opt.label}
                    blurb={opt.blurb}
                  />
                ))}
              </ChoiceGrid>
            </Step>
          )}

          {step === 3 && (
            <Step
              title="Where, exactly?"
              subtitle="Optional. Helps Ninny reference your school + grade in plans."
            >
              <div className="space-y-3">
                <FieldLabel label={schoolType === "professional" || schoolType === "self_study"
                  ? "Org / context (optional)"
                  : "School name (optional)"}>
                  <input
                    autoFocus
                    value={schoolName}
                    onChange={e => setSchoolName(e.target.value)}
                    placeholder={
                      schoolType === "college" ? "Penn State University" :
                      schoolType === "high"    ? "Lincoln High" :
                      schoolType === "grad"    ? "MIT" :
                                                 "Where you study"
                    }
                    maxLength={80}
                    className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2.5 text-[14px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/60"
                  />
                </FieldLabel>
                <FieldLabel label={
                  schoolType === "middle" || schoolType === "high" ? "Grade (optional)" :
                  schoolType === "college" ? "Year (optional)" :
                  schoolType === "grad"    ? "Program year (optional)" :
                                              "Year / cohort (optional)"
                }>
                  <input
                    value={gradeYear}
                    onChange={e => setGradeYear(e.target.value)}
                    placeholder={
                      schoolType === "middle"  ? "7th grade" :
                      schoolType === "high"    ? "11th grade" :
                      schoolType === "college" ? "Sophomore" :
                      schoolType === "grad"    ? "Year 2 PhD" :
                                                  ""
                    }
                    maxLength={40}
                    className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2.5 text-[14px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/60"
                  />
                </FieldLabel>
              </div>
            </Step>
          )}

          {step === 4 && (
            <Step
              title={
                schoolType === "professional" ? "What cert / field?" :
                schoolType === "grad"         ? "What's your focus?" :
                schoolType === "college"      ? "What's your major?" :
                                                 "What are you focused on?"
              }
              subtitle="Optional. One short phrase — Ninny uses this for context."
            >
              <FieldLabel label="Field">
                <input
                  autoFocus
                  value={field}
                  onChange={e => setField(e.target.value)}
                  placeholder={
                    schoolType === "professional" ? "AWS Security Specialty" :
                    schoolType === "college"      ? "Computer Science" :
                    schoolType === "grad"         ? "Machine Learning" :
                                                     "Biology, art, anything"
                  }
                  maxLength={80}
                  className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2.5 text-[14px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/60"
                />
              </FieldLabel>
            </Step>
          )}

          {step === 5 && (
            <Step
              title="What's your study intensity right now?"
              subtitle="We'll tune your daily plan + nudges to match."
            >
              <ChoiceGrid>
                {INTENSITIES.map(opt => (
                  <ChoiceCard
                    key={opt.value}
                    selected={studyIntensity === opt.value}
                    onClick={() => setStudyIntensity(opt.value)}
                    icon={<opt.Icon size={18} weight="fill" />}
                    label={opt.label}
                    blurb={opt.blurb}
                  />
                ))}
              </ChoiceGrid>
            </Step>
          )}

          {/* Action row */}
          <div className="flex items-center justify-between mt-8">
            {step > 1 ? (
              <button
                type="button"
                onClick={back}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-cream/55 hover:text-cream px-3 py-2 transition-colors"
              >
                <ArrowLeft size={12} weight="bold" /> Back
              </button>
            ) : <span />}

            <button
              type="button"
              onClick={next}
              disabled={!canAdvance || submitting}
              className="inline-flex items-center gap-2 rounded-full bg-gold text-navy hover:bg-gold/90
                disabled:opacity-40 disabled:cursor-not-allowed
                font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5
                transition-transform duration-200 active:scale-[0.97]"
            >
              {submitting
                ? "Saving…"
                : step === TOTAL_STEPS
                  ? <>Finish <Check size={12} weight="bold" /></>
                  : <>Continue <ArrowRight size={12} weight="bold" /></>}
            </button>
          </div>

          <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/30 mt-6">
            Required to access Academia
          </p>
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step + form primitives
// ─────────────────────────────────────────────────────────────────────────────
function Step({
  title, subtitle, children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-slide-up">
      <h1 className="font-bebas text-[34px] sm:text-[40px] tracking-[0.04em] text-cream leading-[1.05] mb-2">
        {title}
      </h1>
      <p className="text-[13px] text-cream/55 leading-relaxed mb-6">
        {subtitle}
      </p>
      {children}
    </div>
  );
}

function ChoiceGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-2">{children}</div>;
}

function ChoiceCard({
  selected, onClick, icon, label, blurb,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  blurb?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-full text-left rounded-[10px] border px-4 py-3
        transition-all duration-150 active:scale-[0.99]
        ${selected
          ? "border-gold bg-gold/[0.08]"
          : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.18]"
        }
      `}
    >
      <div className="flex items-center gap-3">
        {icon && (
          <span className={`
            shrink-0 grid place-items-center w-9 h-9 rounded-full
            ${selected ? "bg-gold/[0.15] text-gold" : "bg-white/[0.04] text-cream/60"}
          `}>
            {icon}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-syne font-semibold text-[14px] text-cream leading-tight">
            {label}
          </p>
          {blurb && (
            <p className="text-[11.5px] text-cream/45 leading-snug mt-0.5">
              {blurb}
            </p>
          )}
        </div>
        {selected && (
          <Check size={14} weight="bold" className="text-gold shrink-0" />
        )}
      </div>
    </button>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/50 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
