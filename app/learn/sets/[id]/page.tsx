"use client";

/**
 * Study Set detail — the deck view the save flow lands on and the grid links
 * to. Cards list with inline edit/delete, a Review-now deep link into the
 * unified Review Hub (?source=study_set&set=<id>), and the Library publish
 * controls (components/library/PublishControls).
 *
 * Post-publish edit rule (matches the API): any content edit on a public set
 * auto-unpublishes it; the routes return { unpublished: true } and this page
 * surfaces that as a toast so republishing is a conscious act.
 *
 * Fail-soft: while the HELD study-sets migration is unapplied the GET returns
 * 503 { notReady } and this page renders the honest degraded note instead of
 * an error wall.
 */

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import BackButton from "@/components/BackButton";
import PublishControls from "@/components/library/PublishControls";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  Stack,
  PencilSimple,
  Trash,
  Play,
  Check,
  X,
  ArrowClockwise,
  Cards,
} from "@phosphor-icons/react";

const ORANGE = "#FB923C";

interface StudySet {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  card_count: number;
  is_public: boolean;
  clone_count: number;
  created_at: string;
  updated_at: string;
}

interface StudyCard {
  id: string;
  type: "flashcard" | "mcq";
  front: string;
  back: string;
  options: string[] | null;
  correct_index: number | null;
  next_due_at: string | null;
  review_count: number;
  correct_count: number;
}

interface DetailResponse {
  set: StudySet;
  cards: StudyCard[];
  dueCount: number;
  notReady?: boolean;
}

async function patchJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data?.error, data };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

async function deleteJson<T>(url: string): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, { method: "DELETE", credentials: "include" });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data?.error, data };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

export default function StudySetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const setId = params?.id;

  const [phase, setPhase] = useState<"ok" | "notReady" | "error">("ok");
  const { data, isLoading, mutate } = useSWR(
    user && setId ? `study-set/${setId}` : null,
    async () => {
      const res = await apiGet<DetailResponse>(`/api/study-sets/${setId}`);
      if (!res.ok) {
        if ((res.data as DetailResponse | undefined)?.notReady) {
          setPhase("notReady");
          return null;
        }
        setPhase("error");
        return null;
      }
      setPhase("ok");
      return res.data ?? null;
    },
    { revalidateOnFocus: false },
  );

  const set = data?.set ?? null;
  const cards = useMemo(() => data?.cards ?? [], [data]);
  const dueCount = data?.dueCount ?? 0;

  // ── Inline title/description edit ───────────────────────────────────────
  const [editingMeta, setEditingMeta] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  const beginEditMeta = useCallback(() => {
    if (!set) return;
    setDraftTitle(set.title);
    setDraftDesc(set.description ?? "");
    setEditingMeta(true);
  }, [set]);

  const saveMeta = useCallback(async () => {
    if (!set || savingMeta) return;
    const title = draftTitle.trim();
    if (title.length < 3) {
      toastError("Give the deck a title of at least 3 characters.");
      return;
    }
    setSavingMeta(true);
    const res = await patchJson<{ unpublished?: boolean }>(`/api/study-sets/${set.id}`, {
      title,
      description: draftDesc.trim() || null,
    });
    setSavingMeta(false);
    if (!res.ok) {
      toastError(res.error ?? "Couldn't save the changes.");
      return;
    }
    setEditingMeta(false);
    if (res.data?.unpublished) {
      toastSuccess("Saved. Edits unpublish your set. Republish to share the new version.");
    } else {
      toastSuccess("Saved.");
    }
    void mutate();
  }, [set, savingMeta, draftTitle, draftDesc, mutate]);

  // ── Card edit/delete ────────────────────────────────────────────────────
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardFront, setCardFront] = useState("");
  const [cardBack, setCardBack] = useState("");
  const [busyCardId, setBusyCardId] = useState<string | null>(null);

  const beginEditCard = useCallback((c: StudyCard) => {
    setEditingCardId(c.id);
    setCardFront(c.front);
    setCardBack(c.back);
  }, []);

  const saveCard = useCallback(async () => {
    if (!set || !editingCardId || busyCardId) return;
    const front = cardFront.trim();
    const back = cardBack.trim();
    if (!front || !back) {
      toastError("Both sides of the card need text.");
      return;
    }
    setBusyCardId(editingCardId);
    const res = await patchJson<{ unpublished?: boolean }>(
      `/api/study-sets/${set.id}/cards/${editingCardId}`,
      { front, back },
    );
    setBusyCardId(null);
    if (!res.ok) {
      toastError(res.error ?? "Couldn't save the card.");
      return;
    }
    setEditingCardId(null);
    if (res.data?.unpublished) {
      toastSuccess("Saved. Edits unpublish your set. Republish to share the new version.");
    } else {
      toastSuccess("Card saved.");
    }
    void mutate();
  }, [set, editingCardId, busyCardId, cardFront, cardBack, mutate]);

  const deleteCard = useCallback(
    async (cardId: string) => {
      if (!set || busyCardId) return;
      if (!window.confirm("Delete this card? This can't be undone.")) return;
      setBusyCardId(cardId);
      const res = await deleteJson<{ unpublished?: boolean }>(
        `/api/study-sets/${set.id}/cards/${cardId}`,
      );
      setBusyCardId(null);
      if (!res.ok) {
        toastError(res.error ?? "Couldn't delete the card.");
        return;
      }
      if (res.data?.unpublished) {
        toastSuccess("Deleted. Edits unpublish your set. Republish to share the new version.");
      } else {
        toastSuccess("Card deleted.");
      }
      void mutate();
    },
    [set, busyCardId, mutate],
  );

  // ── Delete set ──────────────────────────────────────────────────────────
  const [deletingSet, setDeletingSet] = useState(false);
  const deleteSet = useCallback(async () => {
    if (!set || deletingSet) return;
    if (!window.confirm(`Delete "${set.title}" and all ${cards.length} cards? This can't be undone.`)) return;
    setDeletingSet(true);
    const res = await deleteJson(`/api/study-sets/${set.id}`);
    setDeletingSet(false);
    if (!res.ok) {
      toastError(res.error ?? "Couldn't delete the deck.");
      return;
    }
    toastSuccess("Deck deleted.");
    router.push("/learn/sets");
  }, [set, cards.length, deletingSet, router]);

  const loading = isLoading && data === undefined && phase === "ok";

  return (
    <ProtectedRoute>
      <FeatureGate feature="learn">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <BackButton href="/learn/sets" label="Study Sets" />

            {phase === "notReady" && (
              <div className="card mt-6 border-amber-500/30">
                <p className="text-cream/80 text-sm">
                  Study Sets are almost ready. This feature finishes setup soon; your decks are safe.
                </p>
              </div>
            )}

            {phase === "error" && (
              <div className="card mt-6 border-red-500/30">
                <p className="text-cream/80 text-sm mb-3">Couldn't load this deck. Check your connection and try again.</p>
                <button className="btn-outline text-sm inline-flex items-center gap-2" onClick={() => void mutate()}>
                  <ArrowClockwise size={16} weight="bold" /> Retry
                </button>
              </div>
            )}

            {loading && (
              <div className="mt-6 space-y-3" aria-label="Loading deck">
                <div className="h-24 rounded-xl bg-white/5 animate-pulse" />
                <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
                <div className="h-16 rounded-xl bg-white/5 animate-pulse" />
              </div>
            )}

            {set && phase === "ok" && (
              <>
                {/* ── Header card ────────────────────────────────────── */}
                <div className="card mt-6" style={{ borderColor: `${ORANGE}33` }}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: `${ORANGE}18`, border: `1px solid ${ORANGE}40` }}
                      >
                        <Stack size={20} weight="duotone" color={ORANGE} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {editingMeta ? (
                          <div className="space-y-2">
                            <input
                              value={draftTitle}
                              onChange={(e) => setDraftTitle(e.target.value.slice(0, 80))}
                              className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-cream font-syne text-lg"
                              aria-label="Deck title"
                            />
                            <textarea
                              value={draftDesc}
                              onChange={(e) => setDraftDesc(e.target.value.slice(0, 200))}
                              rows={2}
                              placeholder="Description (optional)"
                              className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-cream/85 text-sm"
                              aria-label="Deck description"
                            />
                            <div className="flex gap-2">
                              <button className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={() => void saveMeta()} disabled={savingMeta}>
                                <Check size={15} weight="bold" /> {savingMeta ? "Saving..." : "Save"}
                              </button>
                              <button className="btn-outline text-sm inline-flex items-center gap-1.5" onClick={() => setEditingMeta(false)} disabled={savingMeta}>
                                <X size={15} weight="bold" /> Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <h1 className="font-bebas text-2xl sm:text-3xl text-cream tracking-[0.05em] leading-tight break-words">
                              {set.title}
                            </h1>
                            {set.description && (
                              <p className="text-cream/65 text-sm mt-1 break-words">{set.description}</p>
                            )}
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/50 mt-2">
                              {set.card_count} cards
                              {set.subject ? ` · ${set.subject}` : ""}
                              {dueCount > 0 ? ` · ${dueCount} due now` : " · all caught up"}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    {!editingMeta && (
                      <button
                        onClick={beginEditMeta}
                        className="text-cream/50 hover:text-cream p-2 rounded-lg hover:bg-white/5 flex-shrink-0"
                        aria-label="Edit deck title and description"
                      >
                        <PencilSimple size={18} weight="duotone" />
                      </button>
                    )}
                  </div>

                  {/* Actions row */}
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Link
                      href={`/learn/review?source=study_set&set=${set.id}`}
                      className="btn-primary text-sm inline-flex items-center gap-2"
                    >
                      <Play size={16} weight="fill" />
                      {dueCount > 0 ? `Review ${dueCount} due` : "Review now"}
                    </Link>
                    <PublishControls setId={set.id} initialIsPublic={set.is_public} />
                  </div>
                </div>

                {/* ── Cards list ─────────────────────────────────────── */}
                <section className="mt-6" aria-label="Cards in this deck">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/55 mb-3 flex items-center gap-2">
                    <Cards size={14} weight="duotone" color={ORANGE} /> Cards
                  </h2>

                  {cards.length === 0 ? (
                    <div className="card text-center py-8">
                      <p className="text-cream/60 text-sm">
                        No cards left in this deck. Generate a new deck from your notes any time.
                      </p>
                      <Link href="/learn/sets/new" className="btn-outline text-sm inline-block mt-3">
                        Make a study set
                      </Link>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {cards.map((c) => (
                        <li key={c.id} className="card !p-4">
                          {editingCardId === c.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={cardFront}
                                onChange={(e) => setCardFront(e.target.value.slice(0, 500))}
                                rows={2}
                                className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-cream text-sm"
                                aria-label="Card front"
                              />
                              <textarea
                                value={cardBack}
                                onChange={(e) => setCardBack(e.target.value.slice(0, 500))}
                                rows={2}
                                className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-cream/85 text-sm"
                                aria-label="Card back"
                              />
                              <div className="flex gap-2">
                                <button className="btn-primary text-xs inline-flex items-center gap-1" onClick={() => void saveCard()} disabled={busyCardId === c.id}>
                                  <Check size={13} weight="bold" /> Save
                                </button>
                                <button className="btn-outline text-xs" onClick={() => setEditingCardId(null)} disabled={busyCardId === c.id}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-cream text-sm break-words">{c.front}</p>
                                <p className="text-cream/60 text-sm mt-1 break-words">{c.back}</p>
                                {c.type === "mcq" && Array.isArray(c.options) && (
                                  <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream/40 mt-1.5">
                                    multiple choice · {c.options.length} options
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => beginEditCard(c)}
                                  className="text-cream/45 hover:text-cream p-1.5 rounded-lg hover:bg-white/5"
                                  aria-label="Edit card"
                                >
                                  <PencilSimple size={16} weight="duotone" />
                                </button>
                                <button
                                  onClick={() => void deleteCard(c.id)}
                                  disabled={busyCardId === c.id}
                                  className="text-cream/45 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5"
                                  aria-label="Delete card"
                                >
                                  <Trash size={16} weight="duotone" />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* ── Danger ─────────────────────────────────────────── */}
                <div className="mt-8 pt-4 border-t border-white/10">
                  <button
                    onClick={() => void deleteSet()}
                    disabled={deletingSet}
                    className="text-red-400/80 hover:text-red-400 text-sm inline-flex items-center gap-2"
                  >
                    <Trash size={15} weight="duotone" />
                    {deletingSet ? "Deleting..." : "Delete this deck"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
