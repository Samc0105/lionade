"use client";

/**
 * PublishControls — self-contained publish/unpublish + share-link block for a
 * study set the viewer OWNS. Built for app/learn/sets/[id] (in flight from the
 * study-sets agent); mount with one line:
 *
 *   <PublishControls setId={set.id} initialIsPublic={set.is_public} />
 *
 * Talks to POST /api/study-sets/[id]/publish. Handles every server verdict
 * with honest copy:
 *   - 503 unavailable  -> library migrations not applied, controls disable
 *   - 400 flagged      -> moderation refusal, server copy surfaced verbatim
 *   - success          -> toggles state; public sets expose a copyable share
 *                         link to /library?set=<id>
 */

import { useCallback, useState } from "react";
import { apiPost } from "@/lib/api-client";
import { toastError, toastSuccess, toastInfo } from "@/lib/toast";
import {
  GlobeHemisphereWest,
  LinkSimple,
  LockSimple,
  CircleNotch,
} from "@phosphor-icons/react";

const ACCENT = "#2DD4BF"; // library teal — ONE accent for the whole feature

interface PublishResponse {
  ok?: boolean;
  isPublic?: boolean;
  unavailable?: boolean;
  error?: string;
}

interface Props {
  setId: string;
  /** Current is_public if the parent already has it; null/undefined = assume private. */
  initialIsPublic?: boolean | null;
  className?: string;
}

export default function PublishControls({ setId, initialIsPublic, className }: Props) {
  const [isPublic, setIsPublic] = useState<boolean>(initialIsPublic === true);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const toggle = useCallback(async () => {
    if (busy || unavailable) return;
    setBusy(true);
    const action = isPublic ? "unpublish" : "publish";
    const res = await apiPost<PublishResponse>(`/api/study-sets/${setId}/publish`, { action });
    setBusy(false);

    if (res.ok && res.data?.ok) {
      const nowPublic = res.data.isPublic === true;
      setIsPublic(nowPublic);
      toastSuccess(
        nowPublic
          ? "Published to the Community Library."
          : "Removed from the Community Library.",
      );
      return;
    }
    if (res.data?.unavailable) {
      setUnavailable(true);
      toastInfo(res.data.error ?? "Publishing isn't live yet. Check back soon.");
      return;
    }
    toastError(res.data?.error ?? res.error ?? "Couldn't update the set.");
  }, [busy, unavailable, isPublic, setId]);

  const copyShareLink = useCallback(async () => {
    const link = `${window.location.origin}/library?set=${setId}`;
    try {
      await navigator.clipboard.writeText(link);
      toastSuccess("Share link copied.");
    } catch {
      toastError("Couldn't copy the link. You can share /library?set=" + setId);
    }
  }, [setId]);

  return (
    <div
      className={`card p-4 ${className ?? ""}`}
      style={{ borderColor: isPublic ? `${ACCENT}40` : undefined }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}40` }}
        >
          {isPublic ? (
            <GlobeHemisphereWest size={18} weight="duotone" color={ACCENT} aria-hidden="true" />
          ) : (
            <LockSimple size={18} weight="duotone" color={ACCENT} aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-bebas text-base text-cream tracking-wider leading-none">
            Community Library
          </p>
          <p className="font-syne text-xs text-cream/60 mt-1 leading-relaxed">
            {unavailable
              ? "Publishing isn't live yet. Check back soon."
              : isPublic
                ? "This set is public. Anyone can browse and clone it."
                : "This set is private. Publish it so others can clone it."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isPublic && (
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-2 font-bebas text-sm tracking-wider text-cream/85 transition-all hover:brightness-110 active:scale-[0.99]"
              aria-label="Copy share link"
            >
              <LinkSimple size={15} weight="duotone" aria-hidden="true" />
              Share
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            disabled={busy || unavailable}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-bebas text-sm tracking-wider transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
            style={{
              background: isPublic ? "rgba(255,255,255,0.08)" : `${ACCENT}22`,
              border: `1px solid ${isPublic ? "rgba(255,255,255,0.15)" : `${ACCENT}55`}`,
              color: isPublic ? "rgba(255,248,231,0.85)" : ACCENT,
            }}
          >
            {busy && <CircleNotch size={14} className="animate-spin" aria-hidden="true" />}
            {isPublic ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
