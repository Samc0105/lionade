"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiGet } from "@/lib/api-client";
import { cdnUrl } from "@/lib/cdn";
import { toastSuccess, toastError } from "@/lib/toast";
import { Gift, Copy, Check } from "@phosphor-icons/react";

interface ReferralResponse {
  enabled: boolean;
  code?: string;
  reward?: number;
  pending?: number;
  rewarded?: number;
}

/**
 * Referral panel — shows the user their shareable code + link and lets them
 * copy it. Data comes from GET /api/referral/me. Renders nothing when the
 * feature is disabled (migration not applied) so the page degrades cleanly.
 */
export default function ReferralCard() {
  const { data } = useSWR<ReferralResponse>("/api/referral/me", async (url: string) => {
    const res = await apiGet<ReferralResponse>(url);
    return res.data ?? { enabled: false };
  });

  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  // Hide entirely until we know the feature is on. No skeleton — this is a
  // secondary panel and a flash of an empty card would be worse than a late
  // reveal once /me resolves.
  if (!data || !data.enabled || !data.code) return null;

  const code = data.code;
  const reward = data.reward ?? 100;
  const rewarded = data.rewarded ?? 0;
  const pending = data.pending ?? 0;

  const link =
    typeof window !== "undefined"
      ? `${window.location.origin}/login?signup=true&ref=${code}`
      : `/login?signup=true&ref=${code}`;

  const copy = async (kind: "code" | "link", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      toastSuccess(kind === "code" ? "Code copied" : "Invite link copied");
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      toastError("Couldn't copy. Long-press to select instead.");
    }
  };

  return (
    <section
      className="mb-6 rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.08] to-electric/[0.05] p-5"
      aria-labelledby="referral-heading"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gold/15 text-gold">
          <Gift size={20} weight="fill" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="referral-heading" className="text-cream text-sm font-bold">
            Invite friends, earn Fangs
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-cream/65">
            You and your friend each get
            <span className="inline-flex items-center gap-1 font-bold text-gold">
              <img src={cdnUrl("/F.png")} alt="" className="h-3.5 w-3.5" aria-hidden="true" />
              {reward} Fangs
            </span>
            when they finish their first quiz.
          </p>
        </div>
      </div>

      {/* Code + copy */}
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 truncate rounded-xl border border-electric/25 bg-black/25 px-4 py-3 font-mono text-base font-bold tracking-[0.2em] text-cream">
          {code}
        </div>
        <button
          type="button"
          onClick={() => copy("code", code)}
          aria-label="Copy referral code"
          className="flex h-[46px] min-w-[46px] items-center justify-center rounded-xl border border-electric/25 bg-electric/10 text-electric transition-colors hover:bg-electric/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60"
        >
          {copied === "code" ? <Check size={18} weight="bold" /> : <Copy size={18} weight="bold" />}
        </button>
      </div>

      {/* Share link */}
      <button
        type="button"
        onClick={() => copy("link", link)}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gold py-3 text-sm font-bold text-navy transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        {copied === "link" ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
        {copied === "link" ? "Link copied" : "Copy invite link"}
      </button>

      {(rewarded > 0 || pending > 0) && (
        <p className="mt-3 text-center text-xs text-cream/55">
          {rewarded > 0 && (
            <>
              <span className="font-bold text-cream/80">{rewarded}</span> joined
            </>
          )}
          {rewarded > 0 && pending > 0 && <span className="mx-1.5">·</span>}
          {pending > 0 && (
            <>
              <span className="font-bold text-cream/80">{pending}</span> pending
            </>
          )}
        </p>
      )}
    </section>
  );
}
