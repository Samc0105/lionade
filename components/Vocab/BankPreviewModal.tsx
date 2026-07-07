"use client";

/**
 * BankPreviewModal — preview a PUBLIC Word Bank before cloning.
 *
 * Opens from the Discover tab. Fetches GET /api/vocab/banks/[id]/preview which
 * returns `{ bank, words: VocabWord[5] }` — the bank summary plus the first
 * five terms so the user can sanity-check the bank's quality before paying 25
 * Fangs to clone. Two CTAs at the bottom: Cancel + Clone to my collection.
 *
 * On clone success we close the modal, fire a success toast (with the Fang
 * amount the server ACTUALLY credited — coinsAwarded can be 0 on a credit
 * hiccup or boosted by a multiplier), and `router.push` to
 * /learn/vocab?bank=<new bank id>. /learn/vocab resolves ?bank= by slug OR id,
 * then canonicalizes the URL to the slug, so the user lands inside their
 * freshly-cloned bank.
 *
 * Word + clone counts in the header are rendered straight from the bank
 * summary fields the server computes (`word_count`, `clone_count`) — the
 * frontend never recounts the words array (which is intentionally capped at 5
 * for preview).
 *
 * Visual: same dark-interstellar glass panel as CreateBankModal. The bank's
 * own color stripes the left edge of each word card so the preview feels
 * like a slice of the live bank, not a separate UI.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ArrowRight, BookOpen, GlobeHemisphereWest, UsersThree, Books } from "@phosphor-icons/react";
import useSWR from "swr";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import { cdnUrl } from "@/lib/cdn";
import type { VocabWord } from "./ReviewQueue";
import type { PublicBankSummary } from "./types";

interface PreviewResponse {
  bank: PublicBankSummary;
  words: VocabWord[];
}

interface Props {
  /** The bank summary that opened the preview. Used for instant header render before SWR settles. */
  summary: PublicBankSummary | null;
  open: boolean;
  onClose: () => void;
  /** Parent (e.g. /learn/vocab page) refetches its banks list after a successful clone. */
  onCloned?: () => void;
}

const CLONE_FANG_COST = 25;

export default function BankPreviewModal({ summary, open, onClose, onCloned }: Props) {
  const router = useRouter();
  const [cloning, setCloning] = useState(false);

  // Reset cloning state every time the modal opens fresh.
  useEffect(() => {
    if (open) setCloning(false);
  }, [open]);

  // SWR fetch only fires when the modal is open + we have a bank id. We use
  // the bank.id (not slug) — preview endpoint is id-keyed for V3A.
  const swrKey = open && summary ? `/api/vocab/banks/${summary.id}/preview` : null;
  const { data, error, isLoading } = useSWR<PreviewResponse>(swrKey, swrFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false, // preview is essentially static once loaded
  });

  // Prefer server-fresh bank fields when available, fall back to the summary
  // we already had from the Discover grid so the header never flashes empty.
  const bank = data?.bank ?? summary ?? null;
  const words = data?.words ?? [];

  const handleClone = useCallback(async () => {
    if (!bank || cloning) return;
    setCloning(true);
    try {
      // Route contract (app/api/vocab/banks/[id]/clone/route.ts):
      // { bankId: string, coinsAwarded: number }. coinsAwarded is what the
      // server actually credited — 0 when the Fang credit failed (non-fatal
      // to the clone), possibly more than the base 25 with a multiplier.
      const { ok, data: cloneData, error: cloneErr } = await apiPost<{ bankId: string; coinsAwarded: number }>(
        `/api/vocab/banks/${bank.id}/clone`,
        {},
      );
      if (!ok || !cloneData?.bankId) {
        console.error("[vocab:clone-bank] failed", cloneErr);
        toastError("Couldn't clone that bank. Try again.");
        return;
      }
      const awarded = cloneData.coinsAwarded ?? 0;
      toastSuccess(
        awarded > 0
          ? `Cloned to your collection. +${awarded} Fangs.`
          : "Cloned to your collection.",
      );
      onCloned?.();
      onClose();
      // Navigate by the new bank's id — /learn/vocab resolves ?bank= by slug
      // or id and then canonicalizes the URL to the slug.
      router.push(`/learn/vocab?bank=${encodeURIComponent(cloneData.bankId)}`);
    } catch (e: unknown) {
      console.error("[vocab:clone-bank] threw", e);
      toastError("Couldn't clone that bank. Try again.");
    } finally {
      setCloning(false);
    }
  }, [bank, cloning, onCloned, onClose, router]);

  // Author avatar: dicebear identicon fallback when no avatar_url is set.
  const authorAvatar = useMemo(() => {
    if (!bank?.author) return null;
    if (bank.author.avatar_url) return bank.author.avatar_url;
    const seed = encodeURIComponent(bank.author.username ?? bank.author.id);
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${seed}`;
  }, [bank?.author]);

  if (!open || !bank) return null;

  const KindIcon = bank.kind === "language" ? GlobeHemisphereWest : BookOpen;
  const wordCount = bank.word_count ?? 0;
  const cloneCount = bank.clone_count ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-bank-title"
      className="fluid-modal-backdrop fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(4, 8, 15, 0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="fluid-modal-panel relative w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-6 sm:p-7"
        style={{ background: "rgba(12, 16, 32, 0.94)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute top-3 right-3 p-1.5 rounded-md text-cream/55 hover:text-cream hover:bg-white/10 transition-colors"
        >
          <X size={16} weight="bold" />
        </button>

        {/* Header — bank identity */}
        <header className="mb-4 pr-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/45 mb-2">
            preview
          </p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
              style={{ background: `${bank.color}1F`, border: `1px solid ${bank.color}55` }}
            >
              {bank.icon}
            </span>
            <div className="min-w-0">
              <h2
                id="preview-bank-title"
                className="font-bebas text-2xl tracking-wider text-cream leading-none truncate"
              >
                {bank.name}
              </h2>
              <p className="font-syne text-xs text-cream/65 mt-1.5 flex items-center gap-1.5">
                <KindIcon size={11} weight="bold" aria-hidden="true" />
                {bank.kind === "language"
                  ? `${(bank.source_lang ?? "?").toUpperCase()} to ${(bank.target_lang ?? "?").toUpperCase()}`
                  : "General"}
              </p>
            </div>
          </div>
        </header>

        {/* About strip */}
        <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 mb-5 flex items-center gap-4 text-xs font-syne text-cream/75">
          <span className="flex items-center gap-1.5">
            <Books size={13} weight="bold" className="text-cream/55" aria-hidden="true" />
            <span className="font-dm-mono tabular-nums text-cream">{wordCount}</span>
            <span className="text-cream/55">words</span>
          </span>
          <span className="w-px h-3.5 bg-white/15" aria-hidden="true" />
          <span className="flex items-center gap-1.5">
            <UsersThree size={13} weight="bold" className="text-cream/55" aria-hidden="true" />
            <span className="font-dm-mono tabular-nums text-cream">{cloneCount}</span>
            <span className="text-cream/55">{cloneCount === 1 ? "clone" : "clones"}</span>
          </span>
        </div>

        {/* Author attribution */}
        {bank.author && (
          <div className="flex items-center gap-2 mb-5">
            {authorAvatar && (
              <img
                src={authorAvatar}
                alt=""
                className="w-6 h-6 rounded-full object-cover bg-white/10"
                loading="lazy"
              />
            )}
            <p className="font-syne text-xs text-cream/65">
              by{" "}
              <span className="text-cream font-bold">
                {bank.author.username ?? "anonymous"}
              </span>
            </p>
          </div>
        )}

        {/* Word preview cards — first 5 only, server-capped */}
        <section aria-label="First five words" className="space-y-2 mb-6">
          {isLoading && words.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45">
                loading preview...
              </p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-400/30 bg-red-400/5 p-4 text-center">
              <p className="font-syne text-sm text-red-300">
                Couldn't load this bank's preview. Try again.
              </p>
            </div>
          ) : words.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center">
              <p className="font-syne text-sm text-cream/65">
                This bank is empty so far. The author hasn't added any terms.
              </p>
            </div>
          ) : (
            words.map(w => (
              <PreviewWordCard key={w.id} word={w} accent={bank.color} />
            ))
          )}
        </section>

        {/* CTAs — Cancel + Clone */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={cloning}
            className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl font-syne font-bold text-sm bg-white/5 border border-white/10 text-cream/75 hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleClone}
            disabled={cloning || !bank}
            className="btn-gold flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-syne font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {cloning ? (
              "Cloning..."
            ) : (
              <>
                <span>Clone to my collection</span>
                <span className="inline-flex items-center gap-1">
                  +{CLONE_FANG_COST}
                  <img
                    src={cdnUrl("/F.png")}
                    alt="Fangs"
                    className="w-3.5 h-3.5 object-contain"
                  />
                </span>
                <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Word preview card ────────────────────────────────────────────────── */

function PreviewWordCard({ word, accent }: { word: VocabWord; accent: string }) {
  // Bank-kind agnostic: language banks store `word` + `translation`, general
  // banks store `term` + `term_definition`. Render whichever is present.
  const front = word.word ?? word.term ?? "";
  const back = word.translation ?? word.term_definition ?? "";
  const explanation = word.user_definition?.trim();

  return (
    <div
      className="relative rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 pl-5 overflow-hidden"
    >
      {/* Color stripe along the left edge */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: accent }}
      />
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bebas text-lg tracking-wider text-cream truncate">
          {front}
        </p>
        {back && (
          <p className="font-syne text-sm text-cream/80 text-right truncate max-w-[55%]">
            {back}
          </p>
        )}
      </div>
      {explanation && (
        <p className="font-syne text-xs text-cream/55 mt-1.5 line-clamp-2">
          {explanation}
        </p>
      )}
    </div>
  );
}
