"use client";

import { useState } from "react";
import { DownloadSimple, ArrowCounterClockwise } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";

interface BulletPair {
  original: string;
  improved: string | null;
}

interface Props {
  sessionId: string;
  pairs: BulletPair[];
  onStartOver: () => void;
}

/**
 * Side-by-side ORIGINAL vs IMPROVED with a "Download markdown" CTA.
 *
 * The download hits /api/coach/resume/sessions/[id]/export which returns
 * text/markdown with Content-Disposition: attachment. We use fetch + a
 * Blob URL anchor instead of a direct <a href> because the route is
 * auth-gated and we need to attach the Bearer token.
 */
export default function FinalReview({ sessionId, pairs, onStartOver }: Props) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const improvedCount = pairs.filter((p) => !!p.improved).length;

  async function downloadMarkdown() {
    setError(null);
    setDownloading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? null;
      if (!token) {
        setError("Not signed in.");
        setDownloading(false);
        return;
      }
      const res = await fetch(`/api/coach/resume/sessions/${sessionId}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError("Couldn't generate the export.");
        setDownloading(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resume-coach-bullets-${sessionId.slice(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[FinalReview] download", e);
      setError("Download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-6 animate-slide-up" style={{ animationDelay: "0.04s" }}>
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/80">
            final review
          </p>
          <h2 className="font-bebas text-2xl text-cream tracking-[0.08em] leading-none mt-1">
            Your bullets, sharpened
          </h2>
          <p className="font-syne text-xs text-cream/55 mt-2">
            {improvedCount} of {pairs.length} bullets rewritten with Ninny
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onStartOver}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-syne font-semibold text-xs uppercase tracking-[0.15em] border border-white/15 text-cream/85 hover:bg-white/[0.04] transition-colors"
          >
            <ArrowCounterClockwise size={14} weight="bold" aria-hidden="true" />
            Start over
          </button>
          <button
            type="button"
            onClick={downloadMarkdown}
            disabled={downloading || improvedCount === 0}
            className="btn-gold inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-syne font-bold text-xs uppercase tracking-[0.15em] disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Download improved bullets as markdown"
          >
            <DownloadSimple size={14} weight="bold" aria-hidden="true" />
            {downloading ? "Preparing" : "Download markdown"}
          </button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-xl px-4 py-3 border border-red-400/40 bg-red-500/10">
          <p className="font-syne text-sm text-red-300">{error}</p>
        </div>
      )}

      {improvedCount === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="font-syne text-sm text-cream/65">
            No bullets rewritten yet. Go back and answer at least one of Ninny&rsquo;s questions
            to see your improved bullets here.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {pairs.map((p, i) => (
          <li
            key={i}
            className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 animate-slide-up"
            style={{ animationDelay: `${0.06 + i * 0.03}s` }}
          >
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/45 mb-1.5">
                original
              </p>
              <p className="font-syne text-sm text-cream/70 leading-snug italic">
                &ldquo;{p.original}&rdquo;
              </p>
            </div>
            <div>
              <p
                className="font-mono text-[9px] uppercase tracking-[0.25em] mb-1.5"
                style={{ color: p.improved ? "rgba(255,215,0,0.85)" : "rgba(238,244,255,0.35)" }}
              >
                improved
              </p>
              {p.improved ? (
                <p className="font-syne text-sm text-cream leading-snug">{p.improved}</p>
              ) : (
                <p className="font-syne text-sm text-cream/35 italic">
                  not rewritten
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
