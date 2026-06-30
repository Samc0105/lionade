"use client";

/**
 * /admin/question-bank — community question moderation. ADMIN ONLY.
 *
 * The curation cron auto-promotes questions to "approved" (which Blitz now
 * serves) and auto-rejects bad ones. This dashboard is the human override:
 * browse pending / approved / rejected and one-click Approve or Reject.
 *
 * The layout hard-gates /admin to staff; this page additionally self-gates to
 * admins (the API returns 403 to support staff) and only fires SWR when admin.
 */

import { useState } from "react";
import useSWR from "swr";
import { swrFetcher, apiPost } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { toastSuccess, toastError } from "@/lib/toast";
import { Stack, Check, X, CircleNotch } from "@phosphor-icons/react";
import { CARD_BG } from "@/components/admin/shared";

type Tab = "pending" | "approved" | "rejected";

interface ModQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  subject: string | null;
  topic: string | null;
  difficulty: string | null;
  status: string;
  timesShown: number;
  timesCorrect: number;
  successRate: number | null;
  createdAt: string | null;
}

interface QbResponse {
  // API also returns bySubject, but the page renders only these four counts.
  stats: { total: number; pending: number; approved: number; rejected: number };
  status: Tab;
  questions: ModQuestion[];
}

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function pct(rate: number | null): string {
  if (rate == null) return "no data";
  return `${Math.round(rate * 100)}%`;
}

function QuestionCard({
  q,
  tab,
  busy,
  onModerate,
}: {
  q: ModQuestion;
  tab: Tab;
  busy: boolean;
  onModerate: (id: string, action: "approve" | "reject") => void;
}) {
  return (
    <div
      className="rounded-2xl border border-white/[0.08] p-4 sm:p-5"
      style={{ background: CARD_BG }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-cream text-sm font-medium leading-relaxed flex-1">{q.question}</p>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 justify-end">
          {q.subject && (
            <span className="text-[10px] uppercase tracking-wider text-cream/50 px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/10">
              {q.subject}
            </span>
          )}
          {q.difficulty && (
            <span className="text-[10px] uppercase tracking-wider text-electric/80 px-2 py-0.5 rounded-full bg-electric/10 border border-electric/25">
              {q.difficulty}
            </span>
          )}
        </div>
      </div>

      <ul className="space-y-1.5 mb-3">
        {q.options.map((opt, i) => {
          const correct = i === q.correctIndex;
          return (
            <li
              key={i}
              className={`text-[13px] px-3 py-1.5 rounded-lg border flex items-center gap-2 ${
                correct
                  ? "border-green-500/30 bg-green-500/10 text-green-200"
                  : "border-white/[0.06] bg-white/[0.02] text-cream/65"
              }`}
            >
              {correct && <Check size={13} weight="bold" className="text-green-400 shrink-0" aria-hidden="true" />}
              <span>{opt}</span>
            </li>
          );
        })}
      </ul>

      {q.explanation && (
        <p className="text-cream/45 text-[11px] leading-relaxed mb-3 italic">{q.explanation}</p>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-[11px] text-cream/45 font-mono">
          <span>shown {q.timesShown}</span>
          <span aria-hidden="true">·</span>
          <span>{pct(q.successRate)} correct</span>
        </div>
        <div className="flex items-center gap-2">
          {tab !== "rejected" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onModerate(q.id, "reject")}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            >
              {busy ? <CircleNotch size={14} className="animate-spin" aria-hidden="true" /> : <X size={14} weight="bold" aria-hidden="true" />}
              Reject
            </button>
          )}
          {tab !== "approved" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onModerate(q.id, "approve")}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold border border-green-500/40 text-green-300 hover:bg-green-500/10 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            >
              {busy ? <CircleNotch size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} weight="bold" aria-hidden="true" />}
              Approve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminQuestionBankPage() {
  const { isAdmin } = useAdminRole();
  const [tab, setTab] = useState<Tab>("pending");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<QbResponse>(
    isAdmin ? `/api/admin/question-bank?status=${tab}&limit=50` : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  if (!isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        The question bank is admin only.
      </div>
    );
  }

  const stats = data?.stats;
  const questions = data?.questions ?? [];

  const moderate = async (id: string, action: "approve" | "reject") => {
    setPendingId(id);
    const res = await apiPost("/api/admin/question-bank", { id, action });
    setPendingId(null);
    if (res.ok) {
      toastSuccess(action === "approve" ? "Question approved" : "Question rejected");
      mutate();
    } else {
      toastError(res.error ?? "Could not update that question");
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1 flex items-center gap-2">
            <Stack size={26} weight="fill" className="text-gold" aria-hidden="true" />
            Question Bank
          </h1>
          <p className="text-sm text-cream/50 max-w-2xl">
            The curation cron auto-promotes well-performing community questions to
            Approved (Blitz serves these) and auto-rejects bad ones. This is the
            human override: approve a pending question to push it live now, or
            reject anything that should never be served.
          </p>
        </div>
        <div className="shrink-0 flex items-start gap-5 text-right">
          <div>
            <div className="font-bebas text-3xl tracking-wider text-amber-300 leading-none">
              {stats ? stats.pending : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-cream/40 mt-1">pending</div>
          </div>
          <div>
            <div className="font-bebas text-3xl tracking-wider text-green-300 leading-none">
              {stats ? stats.approved : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-cream/40 mt-1">approved</div>
          </div>
          <div>
            <div className="font-bebas text-3xl tracking-wider text-red-300 leading-none">
              {stats ? stats.rejected : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-cream/40 mt-1">rejected</div>
          </div>
        </div>
      </div>

      {/* Status filter buttons (plain toggle buttons, not a tablist). */}
      <div className="flex items-center gap-2 mb-5">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = stats ? stats[t.key] : null;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.key)}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy ${
                active
                  ? "bg-gold/15 text-gold border border-gold/30"
                  : "text-cream/55 border border-white/10 hover:bg-white/[0.04]"
              }`}
            >
              {t.label}
              {count != null && <span className="ml-1.5 text-cream/40">{count}</span>}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200 text-sm px-4 py-3 mb-5">
          Could not load the question bank. If migration 023_question_bank has not
          been run, run it first.
        </div>
      )}

      {isLoading && !data ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-2xl bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <div
          className="rounded-2xl border border-white/[0.08] text-cream/55 text-sm px-4 py-12 text-center"
          style={{ background: CARD_BG }}
        >
          No {tab} questions right now.
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <QuestionCard
              key={q.id}
              q={q}
              tab={tab}
              busy={pendingId === q.id}
              onModerate={moderate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
