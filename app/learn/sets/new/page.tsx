"use client";

// New Study Set — paste anything -> Ninny generates -> MANDATORY preview/trim
// -> save. Nothing persists until the user approves the deck.
//
//   1. POST /api/study-sets/generate { input, hint? } -> preview (10/day cap)
//   2. Edit/delete cards + title in the preview
//   3. POST /api/study-sets { title, cards } -> redirect to the deck page
//
// FAIL-SOFT: if the HELD 20260702130000 migration is unapplied, generation
// still works but the save returns 503 { notReady } — surfaced honestly.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import BackButton from "@/components/BackButton";
import { apiPost } from "@/lib/api-client";
import { toastSuccess } from "@/lib/toast";
import {
  Sparkle,
  Stack,
  Trash,
  PencilSimple,
  CheckCircle,
  X,
  ListBullets,
  Cards,
  CircleNotch,
} from "@phosphor-icons/react";

const ORANGE = "#FB923C";

const MAX_INPUT = 20 * 1024; // mirror of the server 20 KB cap
const MAX_HINT = 200;
const MAX_TITLE = 80;
const MAX_CARD_TEXT = 500;
const MAX_CARDS = 30;

interface PreviewCard {
  localId: number;
  type: "flashcard" | "mcq";
  front: string;
  back: string;
  options: string[] | null;
  correct_index: number | null;
}

interface GenerateResponse {
  title: string;
  cards: Omit<PreviewCard, "localId">[];
  remainingToday: number | null;
  limitReached?: boolean;
}

interface SaveResponse {
  set: { id: string; title: string; cardCount: number };
  notReady?: boolean;
}

type Phase = "input" | "generating" | "preview" | "saving";

export default function NewStudySetPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("input");
  const [input, setInput] = useState("");
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remainingToday, setRemainingToday] = useState<number | null>(null);

  // Preview state
  const [title, setTitle] = useState("");
  const [cards, setCards] = useState<PreviewCard[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftFront, setDraftFront] = useState("");
  const [draftBack, setDraftBack] = useState("");
  const [draftOptions, setDraftOptions] = useState<string[]>([]);
  const [draftCorrect, setDraftCorrect] = useState(0);

  const overLimit = input.length > MAX_INPUT;
  const canGenerate = input.trim().length >= 20 && !overLimit && phase !== "generating";

  const counts = useMemo(() => {
    const mcq = cards.filter((c) => c.type === "mcq").length;
    return { mcq, flash: cards.length - mcq };
  }, [cards]);

  const generate = async () => {
    if (!canGenerate) return;
    setPhase("generating");
    setError(null);
    const res = await apiPost<GenerateResponse>("/api/study-sets/generate", {
      input,
      hint: hint.trim() || undefined,
    });
    if (res.ok && res.data) {
      setTitle(res.data.title);
      setCards(res.data.cards.map((c, i) => ({ ...c, localId: i })));
      setRemainingToday(res.data.remainingToday);
      setEditingId(null);
      setPhase("preview");
    } else {
      setError(res.error || "Ninny could not build a deck right now. Try again in a moment.");
      setPhase("input");
    }
  };

  const save = async () => {
    if (phase === "saving") return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Give the deck a title before saving.");
      return;
    }
    if (cards.length < 1) {
      setError("Keep at least 1 card to save the deck.");
      return;
    }
    setPhase("saving");
    setError(null);
    const res = await apiPost<SaveResponse>("/api/study-sets", {
      title: trimmedTitle,
      cards: cards.map(({ localId: _localId, ...c }) => c),
    });
    if (res.ok && res.data?.set) {
      toastSuccess("Deck saved. Cards are due for review right away.");
      router.push(`/learn/sets/${res.data.set.id}`);
    } else {
      setError(res.error || "Couldn't save the deck. Try again.");
      setPhase("preview");
    }
  };

  const startEdit = (card: PreviewCard) => {
    setEditingId(card.localId);
    setDraftFront(card.front);
    setDraftBack(card.back);
    setDraftOptions(card.options ? [...card.options] : []);
    setDraftCorrect(card.correct_index ?? 0);
  };

  const commitEdit = () => {
    if (editingId === null) return;
    const front = draftFront.trim();
    const back = draftBack.trim();
    if (!front || !back) {
      setError("Cards need both a front and a back.");
      return;
    }
    setError(null);
    setCards((prev) =>
      prev.map((c) => {
        if (c.localId !== editingId) return c;
        if (c.type === "mcq") {
          const opts = draftOptions.map((o) => o.trim());
          if (opts.length !== 4 || opts.some((o) => !o)) {
            return c; // guarded by the disabled state on the save button
          }
          return { ...c, front, back, options: opts, correct_index: draftCorrect };
        }
        return { ...c, front, back };
      }),
    );
    setEditingId(null);
  };

  const draftValid =
    draftFront.trim().length > 0 &&
    draftFront.trim().length <= MAX_CARD_TEXT &&
    draftBack.trim().length > 0 &&
    draftBack.trim().length <= MAX_CARD_TEXT &&
    (editingId === null ||
      cards.find((c) => c.localId === editingId)?.type !== "mcq" ||
      (draftOptions.length === 4 && draftOptions.every((o) => o.trim().length > 0)));

  const removeCard = (localId: number) => {
    setCards((prev) => prev.filter((c) => c.localId !== localId));
    if (editingId === localId) setEditingId(null);
  };

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.4s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
        @keyframes spin-slow { to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 1s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
          .animate-spin-slow { animation: none; }
        }
      `}</style>

      <FeatureGate feature="learn">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <BackButton href="/learn/sets" label="Study Sets" />

            <header className="mb-6 flex items-center gap-3 animate-slide-up">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${ORANGE}18`, border: `1px solid ${ORANGE}40` }}
              >
                <Sparkle size={20} weight="duotone" color={ORANGE} aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-bebas text-3xl text-cream tracking-[0.06em] leading-none">
                  New Study Set
                </h1>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55 mt-1">
                  {phase === "preview" || phase === "saving" ? "step 2 · trim and save" : "step 1 · paste your material"}
                </p>
              </div>
            </header>

            {error && (
              <div
                className="mb-5 rounded-xl border px-4 py-3 animate-slide-up"
                style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.35)" }}
                role="alert"
              >
                <p className="font-syne text-sm text-red-300/90">{error}</p>
              </div>
            )}

            {/* ── STEP 1: paste + generate ── */}
            {(phase === "input" || phase === "generating") && (
              <div className="animate-slide-up">
                <label htmlFor="set-input" className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/60 block mb-2">
                  notes · syllabus · article · topic
                </label>
                <textarea
                  id="set-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={phase === "generating"}
                  rows={12}
                  placeholder="Paste anything here. Lecture notes, a textbook chapter, a topic like the Krebs cycle, a messy study guide. Ninny sorts it out."
                  className="w-full rounded-xl border bg-white/[0.02] border-white/[0.08] focus:border-white/25 focus:outline-none p-4 font-syne text-sm text-cream placeholder:text-cream/30 leading-relaxed resize-y disabled:opacity-60"
                />
                <div className="flex items-center justify-between mt-1.5 mb-4">
                  <p className="font-mono text-[10px] text-cream/45">
                    at least a few sentences
                  </p>
                  <p
                    className="font-mono text-[10px] tabular-nums"
                    style={{ color: overLimit ? "#F87171" : "rgba(238,244,255,0.45)" }}
                  >
                    {input.length.toLocaleString()} / {MAX_INPUT.toLocaleString()}
                  </p>
                </div>

                <label htmlFor="set-hint" className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/60 block mb-2">
                  focus (optional)
                </label>
                <input
                  id="set-hint"
                  type="text"
                  value={hint}
                  onChange={(e) => setHint(e.target.value.slice(0, MAX_HINT))}
                  disabled={phase === "generating"}
                  placeholder="e.g. mostly multiple choice, focus on the dates"
                  className="w-full rounded-xl border bg-white/[0.02] border-white/[0.08] focus:border-white/25 focus:outline-none px-4 py-3 font-syne text-sm text-cream placeholder:text-cream/30 disabled:opacity-60"
                />

                <button
                  type="button"
                  disabled={!canGenerate}
                  onClick={() => void generate()}
                  className="mt-5 w-full font-bebas text-lg tracking-wider px-6 py-4 rounded-xl flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: `${ORANGE}28`, border: `1px solid ${ORANGE}66`, color: "#EEF4FF" }}
                >
                  {phase === "generating" ? (
                    <>
                      <CircleNotch size={18} weight="bold" aria-hidden="true" className="animate-spin-slow" />
                      Ninny is building your deck...
                    </>
                  ) : (
                    <>
                      <Sparkle size={18} weight="duotone" aria-hidden="true" />
                      Generate my deck
                    </>
                  )}
                </button>
                <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45 mt-2.5">
                  ninny builds up to 10 decks a day
                  {remainingToday !== null && <> · {remainingToday} left today</>}
                </p>
              </div>
            )}

            {/* ── STEP 2: preview / trim / save ── */}
            {(phase === "preview" || phase === "saving") && (
              <div className="animate-slide-up">
                {/* Title */}
                <label htmlFor="set-title" className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/60 block mb-2">
                  deck title
                </label>
                <input
                  id="set-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                  disabled={phase === "saving"}
                  className="w-full rounded-xl border bg-white/[0.02] border-white/[0.08] focus:border-white/25 focus:outline-none px-4 py-3 font-syne font-semibold text-base text-cream disabled:opacity-60"
                />

                {/* Card tally */}
                <div className="flex items-center gap-2 mt-4 mb-3">
                  <span
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-full"
                    style={{ background: `${ORANGE}14`, border: `1px solid ${ORANGE}35`, color: ORANGE }}
                  >
                    <Cards size={12} weight="fill" aria-hidden="true" />
                    {counts.flash} flashcard{counts.flash === 1 ? "" : "s"}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] px-2.5 py-1 rounded-full"
                    style={{ background: `${ORANGE}14`, border: `1px solid ${ORANGE}35`, color: ORANGE }}
                  >
                    <ListBullets size={12} weight="fill" aria-hidden="true" />
                    {counts.mcq} quiz question{counts.mcq === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto font-mono text-[10px] tabular-nums text-cream/50">
                    {cards.length} / {MAX_CARDS}
                  </span>
                </div>

                {/* Cards */}
                <ul className="space-y-2.5 mb-6">
                  {cards.map((c, idx) => (
                    <li
                      key={c.localId}
                      className="rounded-xl border p-4"
                      style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}
                    >
                      {editingId === c.localId ? (
                        <div className="space-y-2.5">
                          <textarea
                            value={draftFront}
                            onChange={(e) => setDraftFront(e.target.value.slice(0, MAX_CARD_TEXT))}
                            rows={2}
                            aria-label={`Card ${idx + 1} front`}
                            className="w-full rounded-lg border bg-white/[0.03] border-white/[0.1] focus:border-white/25 focus:outline-none p-2.5 font-syne text-sm text-cream resize-y"
                          />
                          <textarea
                            value={draftBack}
                            onChange={(e) => setDraftBack(e.target.value.slice(0, MAX_CARD_TEXT))}
                            rows={2}
                            aria-label={`Card ${idx + 1} back`}
                            className="w-full rounded-lg border bg-white/[0.03] border-white/[0.1] focus:border-white/25 focus:outline-none p-2.5 font-syne text-sm text-cream/85 resize-y"
                          />
                          {c.type === "mcq" && (
                            <div className="space-y-1.5">
                              {draftOptions.map((opt, oi) => (
                                <div key={oi} className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setDraftCorrect(oi)}
                                    aria-label={`Mark option ${String.fromCharCode(65 + oi)} as correct`}
                                    aria-pressed={draftCorrect === oi}
                                    className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center font-mono text-[11px] transition-colors"
                                    style={{
                                      background: draftCorrect === oi ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.06)",
                                      border: draftCorrect === oi ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(255,255,255,0.1)",
                                      color: draftCorrect === oi ? "#4ADE80" : "rgba(238,244,255,0.6)",
                                    }}
                                  >
                                    {String.fromCharCode(65 + oi)}
                                  </button>
                                  <input
                                    type="text"
                                    value={opt}
                                    onChange={(e) =>
                                      setDraftOptions((prev) => prev.map((p, pi) => (pi === oi ? e.target.value.slice(0, 300) : p)))
                                    }
                                    aria-label={`Option ${String.fromCharCode(65 + oi)}`}
                                    className="flex-1 rounded-lg border bg-white/[0.03] border-white/[0.1] focus:border-white/25 focus:outline-none px-2.5 py-1.5 font-syne text-sm text-cream"
                                  />
                                </div>
                              ))}
                              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-cream/40">
                                tap a letter to mark the correct option
                              </p>
                            </div>
                          )}
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              disabled={!draftValid}
                              onClick={commitEdit}
                              className="inline-flex items-center gap-1.5 font-bebas text-sm tracking-wider px-4 py-2 rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
                              style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.45)", color: "#EEF4FF" }}
                            >
                              <CheckCircle size={14} weight="fill" aria-hidden="true" />
                              Done
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="inline-flex items-center gap-1.5 font-bebas text-sm tracking-wider px-4 py-2 rounded-lg border border-white/[0.12] text-cream/70 hover:text-cream transition-colors"
                            >
                              <X size={14} weight="bold" aria-hidden="true" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3">
                          <span
                            className="flex-shrink-0 mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded"
                            style={{ background: `${ORANGE}14`, color: ORANGE, border: `1px solid ${ORANGE}35` }}
                          >
                            {c.type === "mcq" ? "quiz" : "card"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-syne font-semibold text-sm text-cream leading-snug">{c.front}</p>
                            <p className="font-syne text-xs text-cream/60 leading-relaxed mt-1">{c.back}</p>
                            {c.type === "mcq" && c.options && (
                              <ul className="mt-2 space-y-0.5">
                                {c.options.map((opt, oi) => (
                                  <li
                                    key={oi}
                                    className="font-syne text-xs flex items-center gap-1.5"
                                    style={{ color: oi === c.correct_index ? "#4ADE80" : "rgba(238,244,255,0.45)" }}
                                  >
                                    <span className="font-mono text-[10px]">{String.fromCharCode(65 + oi)}.</span>
                                    <span className="truncate">{opt}</span>
                                    {oi === c.correct_index && (
                                      <CheckCircle size={11} weight="fill" aria-hidden="true" />
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="flex-shrink-0 flex items-center gap-1">
                            <button
                              type="button"
                              disabled={phase === "saving"}
                              onClick={() => startEdit(c)}
                              aria-label={`Edit card ${idx + 1}`}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-cream/50 hover:text-cream hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                            >
                              <PencilSimple size={15} weight="duotone" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              disabled={phase === "saving"}
                              onClick={() => removeCard(c.localId)}
                              aria-label={`Delete card ${idx + 1}`}
                              className="w-8 h-8 rounded-lg flex items-center justify-center text-cream/50 hover:text-red-400 hover:bg-red-500/[0.08] transition-colors disabled:opacity-50"
                            >
                              <Trash size={15} weight="duotone" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {cards.length === 0 && (
                  <p className="text-center font-syne text-sm text-cream/55 mb-6">
                    You trimmed every card. Generate again or start over.
                  </p>
                )}

                {/* Save / back actions */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="button"
                    disabled={phase === "saving" || cards.length === 0 || title.trim().length === 0}
                    onClick={() => void save()}
                    className="flex-1 font-bebas text-lg tracking-wider px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.99] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: `${ORANGE}28`, border: `1px solid ${ORANGE}66`, color: "#EEF4FF" }}
                  >
                    {phase === "saving" ? (
                      <>
                        <CircleNotch size={16} weight="bold" aria-hidden="true" className="animate-spin-slow" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Stack size={16} weight="duotone" aria-hidden="true" />
                        Save deck ({cards.length} card{cards.length === 1 ? "" : "s"})
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={phase === "saving"}
                    onClick={() => {
                      setPhase("input");
                      setError(null);
                    }}
                    className="font-bebas text-lg tracking-wider px-6 py-3.5 rounded-xl border border-white/[0.12] text-cream/70 hover:text-cream transition-colors disabled:opacity-50"
                  >
                    Back to paste
                  </button>
                </div>
                <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-cream/45 mt-2.5">
                  nothing is saved until you approve the deck
                </p>
              </div>
            )}
          </div>
        </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
