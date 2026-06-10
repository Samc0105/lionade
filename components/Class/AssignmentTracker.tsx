"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  ListChecks, Plus, Trash, Circle, CircleHalf, CheckCircle, ArrowsClockwise,
} from "@phosphor-icons/react";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import { toastError } from "@/lib/toast";

/**
 * Per-class assignment tracker. Lists what's due for the class, with a
 * three-way status control (todo -> doing -> done), a relative due-date
 * countdown, and inline add / delete.
 *
 * Data flow (frozen contract):
 *   GET    /api/classes/[id]/assignments            -> { assignments }
 *   POST   /api/classes/[id]/assignments            -> { assignment }
 *   PATCH  /api/classes/assignments/[assignmentId]  -> { assignment }
 *   DELETE /api/classes/assignments/[assignmentId]  -> { ok: true }
 *
 * Status PATCHes are optimistic (the status control flips instantly, then
 * revalidates). Done rows render dimmed + struck and sink below open ones.
 */

type Status = "todo" | "doing" | "done";

interface Assignment {
  id: string;
  class_id: string;
  title: string;
  due_date: string | null;
  status: Status;
  created_at: string;
}

interface ApiShape {
  assignments: Assignment[];
}

interface Props {
  classId: string;
}

const NEXT_STATUS: Record<Status, Status> = {
  todo: "doing",
  doing: "done",
  done: "todo",
};

// ─────────────────────────────────────────────────────────────────────────────
export default function AssignmentTracker({ classId }: Props) {
  const swrKey = `/api/classes/${classId}/assignments`;
  const { data, error, isLoading, mutate } = useSWR<ApiShape>(swrKey, swrFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: true,
  });

  const [adding, setAdding] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const assignments = data?.assignments ?? [];

  // Open rows first (todo/doing) keeping the server's due-date order, then
  // done rows sink to the bottom (also due-date order).
  const open = assignments.filter(a => a.status !== "done");
  const done = assignments.filter(a => a.status === "done");

  // Optimistic create — prepend a placeholder, fire POST, then revalidate.
  const handleCreate = async (draft: { title: string; due_date: string | null }) => {
    const tempId = `tmp_${Date.now()}`;
    const optimistic: Assignment = {
      id: tempId,
      class_id: classId,
      title: draft.title,
      due_date: draft.due_date,
      status: "todo",
      created_at: new Date().toISOString(),
    };
    await mutate(
      prev => prev ? { ...prev, assignments: [optimistic, ...prev.assignments] } : prev,
      { revalidate: false },
    );
    const r = await apiPost<{ assignment: Assignment }>(swrKey, {
      title: draft.title,
      due_date: draft.due_date,
    });
    if (!r.ok || !r.data?.assignment) {
      await mutate(
        prev => prev
          ? { ...prev, assignments: prev.assignments.filter(a => a.id !== tempId) }
          : prev,
        { revalidate: false },
      );
      toastError(r.error || "Couldn't add assignment.");
      return false;
    }
    await mutate();
    return true;
  };

  // Optimistic status cycle — flip the row's status in-cache, then PATCH.
  const handleCycleStatus = async (a: Assignment) => {
    if (a.id.startsWith("tmp_")) return;
    const next = NEXT_STATUS[a.status];
    await mutate(
      prev => prev
        ? { ...prev, assignments: prev.assignments.map(x => x.id === a.id ? { ...x, status: next } : x) }
        : prev,
      { revalidate: false },
    );
    const r = await apiPatch(`/api/classes/assignments/${a.id}`, { status: next });
    if (!r.ok) {
      toastError(r.error || "Couldn't update assignment.");
      await mutate(); // re-sync on failure
      return;
    }
    await mutate();
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    await mutate(
      prev => prev
        ? { ...prev, assignments: prev.assignments.filter(a => a.id !== id) }
        : prev,
      { revalidate: false },
    );
    const r = await apiDelete(`/api/classes/assignments/${id}`);
    setPendingDeleteId(null);
    if (!r.ok) {
      toastError(r.error || "Couldn't delete assignment.");
      await mutate();
      return;
    }
    await mutate();
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-bebas text-[20px] text-cream tracking-[0.18em] flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold" aria-hidden="true" />
          <ListChecks size={14} weight="bold" className="text-gold" /> ASSIGNMENTS
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

      {adding && (
        <AddAssignmentForm
          onCancel={() => setAdding(false)}
          onSubmit={async (draft) => {
            const ok = await handleCreate(draft);
            if (ok) setAdding(false);
          }}
        />
      )}

      {isLoading && !data ? (
        <AssignmentsSkeleton />
      ) : error && assignments.length === 0 ? (
        <ErrorRow onRetry={() => mutate()} />
      ) : assignments.length === 0 ? (
        <EmptyState onAdd={() => setAdding(true)} hideCta={adding} />
      ) : (
        <div className="flex flex-col gap-1.5">
          {open.map(a => (
            <AssignmentRow
              key={a.id}
              assignment={a}
              onCycle={() => handleCycleStatus(a)}
              onDelete={() => setPendingDeleteId(a.id)}
            />
          ))}
          {done.length > 0 && (
            <>
              {open.length > 0 && (
                <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/35 mt-3 mb-0.5 px-1">
                  Done
                </p>
              )}
              {done.map(a => (
                <AssignmentRow
                  key={a.id}
                  assignment={a}
                  onCycle={() => handleCycleStatus(a)}
                  onDelete={() => setPendingDeleteId(a.id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {pendingDeleteId !== null && (
        <InlineDeleteConfirm
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={confirmDelete}
        />
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline delete confirm — the page reserves ConfirmModal for class/note
// archive; a lightweight inline bar keeps this embedded card self-contained.
// ─────────────────────────────────────────────────────────────────────────────
function InlineDeleteConfirm({
  onCancel, onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-[10px] border border-[#EF4444]/30 bg-[#EF4444]/[0.06] px-4 py-2.5">
      <p className="font-syne text-[12px] text-cream/80">
        Delete this assignment? This can&apos;t be undone.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream px-2 py-1 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={async () => { setBusy(true); await onConfirm(); }}
          disabled={busy}
          className="rounded-full bg-[#EF4444] text-white hover:bg-[#EF4444]/90 font-mono text-[10px] uppercase tracking-[0.25em] px-3 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ onAdd, hideCta }: { onAdd: () => void; hideCta: boolean }) {
  return (
    <div className="rounded-[12px] border border-dashed border-white/[0.08] bg-white/[0.015] p-6 text-center">
      <ListChecks size={20} className="text-cream/30 mx-auto mb-2" />
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/45 mb-1">
        No assignments yet
      </p>
      <p className="text-[12px] text-cream/45 mb-3">
        Add one to track what&apos;s due.
      </p>
      {!hideCta && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/70 hover:text-cream"
        >
          <Plus size={11} weight="bold" /> Add your first assignment
        </button>
      )}
    </div>
  );
}

// Compact fetch-error row — mirrors GradeTracker / DiscoverTab treatment.
function ErrorRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] border border-red-400/30 bg-red-400/5 px-4 py-3">
      <p className="font-syne text-[12px] text-red-300">
        Couldn&apos;t load assignments. Network hiccup, probably.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-[11px] font-bold transition-colors shrink-0"
      >
        <ArrowsClockwise size={11} weight="bold" aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

function AssignmentsSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-11 w-full bg-white/[0.04] rounded-[8px] animate-pulse" />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add form
// ─────────────────────────────────────────────────────────────────────────────
function AddAssignmentForm({
  onCancel, onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (draft: { title: string; due_date: string | null }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const clean = title.trim();
    if (clean.length < 1) { toastError("Title is required."); return; }
    setSubmitting(true);
    await onSubmit({ title: clean, due_date: dueDate || null });
    setSubmitting(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void submit(); }
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="mb-4 rounded-[10px] border border-gold/30 bg-gold/[0.04] p-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 mb-2">
        <input
          autoFocus
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value.slice(0, 200))}
          onKeyDown={onKey}
          placeholder="Title (e.g. Problem Set 4)"
          className="bg-black/30 border border-white/[0.08] rounded-[8px] px-3 py-2 text-[13px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/40"
        />
        <label className="flex flex-col gap-1">
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            onKeyDown={onKey}
            aria-label="Due date"
            className="bg-black/30 border border-white/[0.08] rounded-[8px] px-3 py-2 text-[13px] text-cream focus:outline-none focus:border-gold/40 tabular-nums"
          />
        </label>
      </div>
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
          {submitting ? "Saving…" : "Add"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────────────────
function AssignmentRow({
  assignment, onCycle, onDelete,
}: {
  assignment: Assignment;
  onCycle: () => void;
  onDelete: () => void;
}) {
  const isPending = assignment.id.startsWith("tmp_");
  const isDone = assignment.status === "done";
  const due = relativeDue(assignment.due_date, isDone);

  const StatusIcon = isDone ? CheckCircle : assignment.status === "doing" ? CircleHalf : Circle;
  const statusColor = isDone
    ? "text-gold"
    : assignment.status === "doing"
      ? "text-electric"
      : "text-cream/35 hover:text-cream/70";
  const statusLabel = isDone
    ? "Done — mark as to-do"
    : assignment.status === "doing"
      ? "In progress — mark as done"
      : "To-do — mark as in progress";

  return (
    <div
      className={`group flex items-center gap-2.5 rounded-[8px] border px-3 py-2 transition-colors ${
        isDone
          ? "border-white/[0.05] bg-white/[0.015]"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
      } ${isPending ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={onCycle}
        disabled={isPending}
        aria-label={statusLabel}
        title={statusLabel}
        className={`grid place-items-center w-7 h-7 rounded-full shrink-0 transition-colors hover:bg-white/[0.06] disabled:opacity-50 ${statusColor}`}
      >
        <StatusIcon size={17} weight={isDone || assignment.status === "doing" ? "fill" : "bold"} />
      </button>

      <div className="min-w-0 flex-1">
        <span
          className={`text-[13px] font-syne font-medium block truncate ${
            isDone ? "text-cream/45 line-through" : "text-cream"
          }`}
        >
          {assignment.title}
        </span>
      </div>

      {due && (
        <span
          className={`font-mono text-[10px] tabular-nums uppercase tracking-[0.18em] shrink-0 px-1.5 py-0.5 rounded-full ${
            due.overdue
              ? "text-red-400 bg-red-500/10"
              : isDone
                ? "text-cream/35"
                : "text-cream/55"
          }`}
        >
          {due.label}
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={isPending}
        aria-label="Delete assignment"
        className="grid place-items-center w-7 h-7 rounded-full text-cream/40 hover:text-[#EF4444] hover:bg-[#EF4444]/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-0 shrink-0"
      >
        <Trash size={12} weight="bold" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Relative due-date helper. Returns a short label + overdue flag.
// Done assignments never read as overdue (red).
// ─────────────────────────────────────────────────────────────────────────────
function relativeDue(dateStr: string | null, isDone: boolean): { label: string; overdue: boolean } | null {
  if (!dateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const days = Math.round((target.getTime() - now.getTime()) / 86_400_000);

  if (days === 0) return { label: "Today", overdue: false };
  if (days === 1) return { label: "Tomorrow", overdue: false };
  if (days === -1) return { label: "Yesterday", overdue: !isDone };
  if (days > 1) return { label: `in ${days} days`, overdue: false };
  return { label: `${Math.abs(days)} days ago`, overdue: !isDone };
}
