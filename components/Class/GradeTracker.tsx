"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  GraduationCap, Plus, X, PencilSimple, Trash, Star, Check,
} from "@phosphor-icons/react";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { toastError } from "@/lib/toast";

/**
 * Per-class grade tracker. Lists every assignment / exam the user has
 * entered for this class, computes a live weighted grade, and shows the
 * "needed on the final" calculator.
 *
 * Data flow:
 *   GET  /api/classes/[id]/grades  → { grades, summary }
 *   POST /api/classes/[id]/grades  → optimistic prepend, then revalidate
 *   PATCH/DELETE /api/classes/[id]/grades/[gradeId]
 *
 * NUMERIC fields are stringified by Postgres → coerced to Number on the server,
 * but we still defensively guard with Number(...) here for the rare case the
 * cache holds a partial row.
 */

type Category = "Exam" | "Quiz" | "Homework" | "Project" | "Other";
const CATEGORIES: Category[] = ["Exam", "Quiz", "Homework", "Project", "Other"];

interface Grade {
  id: string;
  name: string;
  category: Category | string | null;
  earnedPoints: number | null;
  maxPoints: number;
  weightPct: number;
  isFinal: boolean;
  dueDate: string | null;
  gradedAt: string | null;
  pct: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Summary {
  currentWeightedPct: number | null;
  gradedCount: number;
  ungradedCount: number;
  finalRow: { id: string; name: string; weightPct: number } | null;
  neededOnFinalForA: number | null;
  neededOnFinalForB: number | null;
}

interface ApiShape {
  grades: Grade[];
  summary: Summary;
}

interface Props {
  classId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function GradeTracker({ classId }: Props) {
  const swrKey = `/api/classes/${classId}/grades`;
  const { data, isLoading, mutate } = useSWR<ApiShape>(swrKey, swrFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: true,
  });

  const [adding, setAdding] = useState(false);

  const grades = data?.grades ?? [];
  const summary = data?.summary ?? null;

  // Optimistic insert. We prepend a placeholder row, fire the POST, and
  // either replace it with the server's row or roll back on failure.
  const handleCreate = async (draft: NewGradeDraft) => {
    const tempId = `tmp_${Date.now()}`;
    const optimistic: Grade = {
      id: tempId,
      name: draft.name,
      category: draft.category ?? null,
      earnedPoints: draft.earned ?? null,
      maxPoints: draft.max,
      weightPct: draft.weight,
      isFinal: !!draft.isFinal,
      dueDate: draft.dueDate || null,
      gradedAt: draft.gradedAt || null,
      pct: draft.earned !== null && draft.max > 0
        ? Math.round((draft.earned / draft.max) * 1000) / 10
        : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await mutate(
      prev => prev ? { ...prev, grades: [...prev.grades, optimistic] } : prev,
      { revalidate: false },
    );

    const r = await apiPost<{ grade: Grade }>(swrKey, {
      name: draft.name,
      category: draft.category,
      earned_points: draft.earned,
      max_points: draft.max,
      weight_pct: draft.weight,
      is_final: draft.isFinal,
      due_date: draft.dueDate || null,
      graded_at: draft.gradedAt || null,
    });

    if (!r.ok || !r.data?.grade) {
      // Roll back the optimistic row.
      await mutate(
        prev => prev
          ? { ...prev, grades: prev.grades.filter(g => g.id !== tempId) }
          : prev,
        { revalidate: false },
      );
      toastError(r.error || "Couldn't save grade.");
      return false;
    }

    // Replace the temp row with the real one + revalidate to refresh summary.
    await mutate();
    return true;
  };

  const handleUpdate = async (gradeId: string, patch: Partial<Grade>) => {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.category !== undefined) body.category = patch.category;
    if (patch.earnedPoints !== undefined) body.earned_points = patch.earnedPoints;
    if (patch.maxPoints !== undefined) body.max_points = patch.maxPoints;
    if (patch.weightPct !== undefined) body.weight_pct = patch.weightPct;
    if (patch.isFinal !== undefined) body.is_final = patch.isFinal;
    if (patch.dueDate !== undefined) body.due_date = patch.dueDate;
    if (patch.gradedAt !== undefined) body.graded_at = patch.gradedAt;

    const r = await apiPatch(`${swrKey}/${gradeId}`, body);
    if (!r.ok) { toastError(r.error || "Couldn't update grade."); return false; }
    await mutate();
    return true;
  };

  const handleDelete = async (gradeId: string) => {
    if (!confirm("Delete this grade?")) return;
    // Optimistic remove.
    await mutate(
      prev => prev
        ? { ...prev, grades: prev.grades.filter(g => g.id !== gradeId) }
        : prev,
      { revalidate: false },
    );
    const r = await apiDelete(`${swrKey}/${gradeId}`);
    if (!r.ok) {
      toastError(r.error || "Couldn't delete grade.");
      await mutate(); // re-sync on failure
      return;
    }
    await mutate();
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-bebas text-sm text-cream/85 tracking-[0.2em]">
          <span className="inline-flex items-center gap-2">
            <GraduationCap size={13} weight="bold" /> GRADES
          </span>
        </h2>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-gold hover:text-gold/80 transition-colors"
          >
            <Plus size={11} weight="bold" /> Add
          </button>
        )}
      </div>

      {/* Add form (inline) */}
      {adding && (
        <AddGradeForm
          onCancel={() => setAdding(false)}
          onSubmit={async (draft) => {
            const ok = await handleCreate(draft);
            if (ok) setAdding(false);
          }}
        />
      )}

      {/* Body */}
      {isLoading && !data ? (
        <GradesSkeleton />
      ) : grades.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} hideCta={adding} />
      ) : (
        <GradesTable
          grades={grades}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}

      {/* Footer — current grade + needed-on-final */}
      {grades.length > 0 && summary && (
        <Footer summary={summary} />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ onAdd, hideCta }: { onAdd: () => void; hideCta: boolean }) {
  return (
    <div className="rounded-[12px] border border-dashed border-white/[0.08] bg-white/[0.015] p-6 text-center">
      <GraduationCap size={20} className="text-cream/30 mx-auto mb-2" />
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/45 mb-1">
        No grades yet
      </p>
      <p className="text-[12px] text-cream/45 mb-3">
        Log assignments and exams to see your live weighted grade.
      </p>
      {!hideCta && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/70 hover:text-cream"
        >
          <Plus size={11} weight="bold" /> Add your first grade
        </button>
      )}
    </div>
  );
}

function GradesSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-12 w-full bg-white/[0.04] rounded-[8px] animate-pulse" />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add form
// ─────────────────────────────────────────────────────────────────────────────
interface NewGradeDraft {
  name: string;
  category: Category | null;
  earned: number | null;
  max: number;
  weight: number;
  isFinal: boolean;
  dueDate: string;
  gradedAt: string;
}

function AddGradeForm({
  onCancel, onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (draft: NewGradeDraft) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("Exam");
  const [earned, setEarned] = useState("");
  const [max, setMax] = useState("100");
  const [weight, setWeight] = useState("");
  const [isFinal, setIsFinal] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [gradedAt, setGradedAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const cleanName = name.trim();
    if (cleanName.length < 1) { toastError("Name is required."); return; }
    const maxN = Number(max);
    if (!Number.isFinite(maxN) || maxN <= 0) {
      toastError("Max points must be greater than 0."); return;
    }
    const weightN = Number(weight || 0);
    if (!Number.isFinite(weightN) || weightN < 0 || weightN > 100) {
      toastError("Weight must be between 0 and 100."); return;
    }
    let earnedN: number | null = null;
    if (earned.trim() !== "") {
      const e = Number(earned);
      if (!Number.isFinite(e) || e < 0 || e > maxN) {
        toastError("Earned must be between 0 and max."); return;
      }
      earnedN = e;
    }

    setSubmitting(true);
    await onSubmit({
      name: cleanName,
      category,
      earned: earnedN,
      max: maxN,
      weight: weightN,
      isFinal,
      dueDate,
      gradedAt,
    });
    setSubmitting(false);
  };

  return (
    <div className="mb-4 rounded-[10px] border border-gold/30 bg-gold/[0.04] p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value.slice(0, 80))}
          placeholder="Name (e.g. Midterm 1)"
          className="bg-black/30 border border-white/[0.08] rounded-[8px] px-3 py-2 text-[13px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/40"
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value as Category)}
          className="bg-black/30 border border-white/[0.08] rounded-[8px] px-3 py-2 text-[13px] text-cream focus:outline-none focus:border-gold/40"
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c} className="bg-navy text-cream">{c}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <LabeledInput label="Earned" value={earned} onChange={setEarned} placeholder="—" />
        <LabeledInput label="Max" value={max} onChange={setMax} placeholder="100" />
        <LabeledInput label="Weight %" value={weight} onChange={setWeight} placeholder="0" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <LabeledInput label="Due" value={dueDate} onChange={setDueDate} type="date" />
        <LabeledInput label="Graded" value={gradedAt} onChange={setGradedAt} type="date" />
      </div>
      <label className="flex items-center gap-2 text-[12px] text-cream/75 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={isFinal}
          onChange={e => setIsFinal(e.target.checked)}
          className="accent-gold"
        />
        <Star size={12} weight={isFinal ? "fill" : "regular"} className="text-gold" />
        Mark as final exam (used by the &quot;needed on final&quot; calculator)
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[10px] uppercase tracking-[0.25em] px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function LabeledInput({
  label, value, onChange, placeholder, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/45">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-black/30 border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[13px] text-cream placeholder:text-cream/25 focus:outline-none focus:border-gold/40 tabular-nums"
      />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────────────────────────────────────
function GradesTable({
  grades, onUpdate, onDelete,
}: {
  grades: Grade[];
  onUpdate: (id: string, patch: Partial<Grade>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {grades.map(g => (
        <GradeRow key={g.id} grade={g} onUpdate={onUpdate} onDelete={onDelete} />
      ))}
    </div>
  );
}

function GradeRow({
  grade, onUpdate, onDelete,
}: {
  grade: Grade;
  onUpdate: (id: string, patch: Partial<Grade>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const isPending = grade.id.startsWith("tmp_");

  if (editing) {
    return (
      <EditGradeRow
        grade={grade}
        onCancel={() => setEditing(false)}
        onSave={async (patch) => {
          const ok = await onUpdate(grade.id, patch);
          if (ok) setEditing(false);
        }}
      />
    );
  }

  const earnedDisplay = grade.earnedPoints === null
    ? <span className="text-cream/35">—</span>
    : <>{Number(grade.earnedPoints)}</>;

  return (
    <div
      className={`group flex items-center gap-2 rounded-[8px] border px-3 py-2 transition-colors ${
        grade.isFinal
          ? "border-gold/30 bg-gold/[0.04]"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
      } ${isPending ? "opacity-60" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {grade.isFinal && (
            <Star size={10} weight="fill" className="text-gold shrink-0" aria-label="Final" />
          )}
          <span className="text-[13px] font-syne font-medium text-cream truncate">
            {grade.name}
          </span>
          {grade.category && (
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45 border border-white/[0.08] rounded-full px-1.5 py-0.5 shrink-0">
              {grade.category}
            </span>
          )}
        </div>
        {(grade.dueDate || grade.gradedAt) && (
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/35 mt-0.5">
            {grade.gradedAt ? `Graded ${grade.gradedAt}` : `Due ${grade.dueDate}`}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-[12px] tabular-nums text-cream/85">
          {earnedDisplay} <span className="text-cream/40">/ {Number(grade.maxPoints)}</span>
        </span>
        {grade.pct !== null && (
          <span
            className={`font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${
              grade.pct >= 90 ? "bg-green-500/15 text-green-400"
                : grade.pct >= 80 ? "bg-blue-500/15 text-blue-400"
                : grade.pct >= 70 ? "bg-yellow-500/15 text-yellow-400"
                : "bg-red-500/15 text-red-400"
            }`}
          >
            {grade.pct.toFixed(1)}%
          </span>
        )}
        {Number(grade.weightPct) > 0 && (
          <span className="font-mono text-[9px] tabular-nums text-cream/50 border border-white/[0.08] rounded-full px-1.5 py-0.5">
            {Number(grade.weightPct)}%
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={isPending}
          aria-label="Edit grade"
          className="grid place-items-center w-7 h-7 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.06] transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0"
        >
          <PencilSimple size={12} weight="bold" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(grade.id)}
          disabled={isPending}
          aria-label="Delete grade"
          className="grid place-items-center w-7 h-7 rounded-full text-cream/40 hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0"
        >
          <Trash size={12} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function EditGradeRow({
  grade, onCancel, onSave,
}: {
  grade: Grade;
  onCancel: () => void;
  onSave: (patch: Partial<Grade>) => Promise<void>;
}) {
  const [name, setName] = useState(grade.name);
  const [category, setCategory] = useState<Category>(
    (CATEGORIES.includes((grade.category as Category)) ? grade.category : "Exam") as Category,
  );
  const [earned, setEarned] = useState(grade.earnedPoints === null ? "" : String(grade.earnedPoints));
  const [max, setMax] = useState(String(Number(grade.maxPoints)));
  const [weight, setWeight] = useState(String(Number(grade.weightPct)));
  const [isFinal, setIsFinal] = useState(grade.isFinal);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    const cleanName = name.trim();
    if (cleanName.length < 1) { toastError("Name is required."); return; }
    const maxN = Number(max);
    if (!Number.isFinite(maxN) || maxN <= 0) { toastError("Max must be > 0."); return; }
    const weightN = Number(weight || 0);
    if (!Number.isFinite(weightN) || weightN < 0 || weightN > 100) {
      toastError("Weight must be 0–100."); return;
    }
    let earnedN: number | null = null;
    if (earned.trim() !== "") {
      const e = Number(earned);
      if (!Number.isFinite(e) || e < 0 || e > maxN) {
        toastError("Earned must be between 0 and max."); return;
      }
      earnedN = e;
    }
    setSaving(true);
    await onSave({
      name: cleanName,
      category,
      earnedPoints: earnedN,
      maxPoints: maxN,
      weightPct: weightN,
      isFinal,
    });
    setSaving(false);
  };

  return (
    <div className="rounded-[8px] border border-gold/30 bg-gold/[0.04] p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={e => setName(e.target.value.slice(0, 80))}
          className="bg-black/30 border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[13px] text-cream focus:outline-none focus:border-gold/40"
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value as Category)}
          className="bg-black/30 border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[13px] text-cream focus:outline-none focus:border-gold/40"
        >
          {CATEGORIES.map(c => (
            <option key={c} value={c} className="bg-navy text-cream">{c}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        <input
          value={earned} onChange={e => setEarned(e.target.value)} placeholder="Earned"
          className="bg-black/30 border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[13px] text-cream focus:outline-none focus:border-gold/40 tabular-nums"
        />
        <input
          value={max} onChange={e => setMax(e.target.value)} placeholder="Max"
          className="bg-black/30 border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[13px] text-cream focus:outline-none focus:border-gold/40 tabular-nums"
        />
        <input
          value={weight} onChange={e => setWeight(e.target.value)} placeholder="Weight %"
          className="bg-black/30 border border-white/[0.08] rounded-[6px] px-2 py-1.5 text-[13px] text-cream focus:outline-none focus:border-gold/40 tabular-nums"
        />
      </div>
      <label className="flex items-center gap-2 text-[12px] text-cream/75 cursor-pointer mb-2">
        <input
          type="checkbox"
          checked={isFinal}
          onChange={e => setIsFinal(e.target.checked)}
          className="accent-gold"
        />
        Mark as final
      </label>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="grid place-items-center w-7 h-7 rounded-full text-cream/50 hover:text-cream hover:bg-white/[0.06]"
        >
          <X size={12} weight="bold" />
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Save"
          className="grid place-items-center w-7 h-7 rounded-full bg-gold text-navy hover:bg-gold/90 disabled:opacity-40"
        >
          <Check size={12} weight="bold" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer — current grade + needed-on-final
// ─────────────────────────────────────────────────────────────────────────────
function Footer({ summary }: { summary: Summary }) {
  const cur = summary.currentWeightedPct;
  const grade = letterGrade(cur);

  // What to surface as the "needed on final" callout.
  // Prefer A unless A is already locked or out of reach; then drop to B.
  const needed = pickNeededLine(summary);

  return (
    <div className="mt-5 pt-4 border-t border-white/[0.06]">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45 mb-1">
            Current grade
          </p>
          <p className="font-bebas text-[44px] leading-none tracking-wider text-cream tabular-nums">
            {cur === null ? "—" : `${cur.toFixed(1)}%`}
            {grade && (
              <span className="ml-2 text-[20px] text-gold align-baseline">{grade}</span>
            )}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40 mt-1">
            {summary.gradedCount} graded · {summary.ungradedCount} pending
          </p>
        </div>
        {needed && (
          <div
            className={`text-right max-w-[55%] sm:max-w-none ${needed.tone === "warn" ? "text-amber-400/90" : "text-cream/85"}`}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45 mb-1">
              On the final
            </p>
            <p className="text-[14px] sm:text-[15px] font-syne leading-snug">
              {needed.text}
            </p>
          </div>
        )}
      </div>

      {/* When a final exists but is impossible for both A and B */}
      {!needed && summary.finalRow && summary.currentWeightedPct !== null && (
        <p className="mt-3 text-[12px] text-cream/55 italic">
          A and B are out of reach with the current grade and final weight.
        </p>
      )}

      {/* When no final marked and there are graded rows */}
      {!summary.finalRow && summary.gradedCount > 0 && (
        <p className="mt-3 text-[12px] text-cream/45">
          Mark a row as final to unlock the &quot;needed on final&quot; calculator.
        </p>
      )}

      {/* When all rows ungraded */}
      {summary.gradedCount === 0 && (
        <p className="mt-3 text-[12px] text-cream/55">
          No graded rows yet — your weighted grade will appear once you log a score.
        </p>
      )}
    </div>
  );
}

// ─── Footer helpers ─────────────────────────────────────────────────────────
function letterGrade(pct: number | null): string | null {
  if (pct === null) return null;
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  return "F";
}

function pickNeededLine(s: Summary): { text: string; tone: "ok" | "warn" } | null {
  if (!s.finalRow) return null;
  const a = s.neededOnFinalForA;
  const b = s.neededOnFinalForB;

  // A is reachable → show A first.
  if (a !== null && a <= 100) {
    if (a <= 0) {
      return { text: "You've already locked an A.", tone: "ok" };
    }
    return {
      text: `You need ${formatNeeded(a)} on the final to land an A.`,
      tone: a >= 90 ? "warn" : "ok",
    };
  }

  // A unreachable → fall back to B.
  if (b !== null && b <= 100) {
    if (b <= 0) {
      return { text: "A is out of reach, but B is locked in.", tone: "warn" };
    }
    return {
      text: `A is out of reach. You need ${formatNeeded(b)} on the final to land a B.`,
      tone: "warn",
    };
  }

  // Both unreachable → caller renders fallback line.
  return null;
}

function formatNeeded(n: number): string {
  // Negative → already locked. Cap presentation tightly.
  if (n <= 0) return "0%";
  if (n > 100) return ">100%";
  return `${n.toFixed(1)}%`;
}
