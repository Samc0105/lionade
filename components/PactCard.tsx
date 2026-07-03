"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useReducedMotion } from "framer-motion";
import { Fire, HandFist, BellRinging, Check, Moon } from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { avatarFor } from "@/lib/avatar";
import Avatar from "@/components/Avatar";
import { cdnUrl } from "@/lib/cdn";
import { toastError, toastSuccess, toastInfo } from "@/lib/toast";
import {
  PACT_ACCENT,
  nextPactMilestone,
  type ActivePact,
  type PactsResponse,
} from "@/lib/pacts-shared";

/**
 * Streak Pacts dashboard widget — duo accountability streaks.
 *
 * Shows every active pact: both avatars, the joint flame count, who has
 * studied today, milestone progress toward the next Fang payout, and a nudge
 * button when the partner has not studied yet. Also surfaces a small teaser
 * when a pact invite is waiting in Social.
 *
 * Fails soft: while the HELD streak_pacts migration is unapplied the API
 * returns available:false and this renders nothing. With no pacts and no
 * invites it also renders nothing (discovery lives on /social).
 */

// Accent, milestone table, and response types live in lib/pacts-shared.ts
// (client-safe) so the 7/50 and 30/250 pairs rendered here can never drift
// from what the server actually pays.

export default function PactCard() {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const { data, mutate } = useSWR<PactsResponse>(
    user?.id ? "/api/pacts" : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );
  const [nudging, setNudging] = useState<string | null>(null);

  if (!user?.id || !data) return null;
  if (!data.available) return null;
  const pacts = data.pacts ?? [];
  const inviteCount = data.incoming?.length ?? 0;
  if (pacts.length === 0 && inviteCount === 0) return null;

  const sendNudge = async (pact: ActivePact) => {
    if (nudging) return;
    setNudging(pact.id);
    try {
      type R = { ok?: boolean; reason?: string; error?: string };
      const r = await apiPost<R>(`/api/pacts/${pact.id}/nudge`, {});
      if (r.ok && r.data?.ok) {
        toastSuccess(`Nudge sent. ${pact.partner.username} knows you're counting on them.`);
      } else if (r.data?.reason === "partner_active") {
        toastInfo("They already studied today. The pact is safe.");
      } else if (r.data?.reason === "already_nudged") {
        toastInfo("This pact already used today's nudge.");
      } else {
        toastError(r.data?.error || "Couldn't send the nudge. Try again.");
      }
      void mutate();
    } catch (e) {
      console.error("[pacts] nudge threw", e);
      toastError("Couldn't send the nudge. Try again.");
    } finally {
      setNudging(null);
    }
  };

  return (
    <div className="mb-8 animate-slide-up">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-bebas text-xl text-cream tracking-wider">STREAK PACTS</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/30">
          Two flames, one count
        </span>
      </div>

      <div className="space-y-3">
        {pacts.map((pact) => {
          const milestone = nextPactMilestone(pact);
          const pct = milestone
            ? Math.min(100, Math.round((pact.currentStreak / milestone.target) * 100))
            : 100;
          const bothToday = pact.youStudiedToday && pact.partnerStudiedToday;
          return (
            <div
              key={pact.id}
              className="rounded-2xl p-4 sm:p-5 relative overflow-hidden"
              style={{
                background: "linear-gradient(135deg, rgba(255,159,69,0.08) 0%, rgba(13,21,40,0.9) 55%)",
                border: `1px solid ${bothToday ? "rgba(255,159,69,0.35)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-[2px]"
                style={{ background: `linear-gradient(90deg, ${PACT_ACCENT}, transparent)` }}
              />

              <div className="flex items-center gap-3 flex-wrap">
                {/* Both avatars, overlapped */}
                <div className="flex items-center flex-shrink-0">
                  <div className="relative z-10">
                    <Avatar url={user.avatar} alt={user.username} size="xs" />
                  </div>
                  <div className="-ml-2">
                    <Avatar
                      url={avatarFor(pact.partner.username, pact.partner.avatar_url)}
                      alt={pact.partner.username}
                      size="xs"
                    />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-cream text-sm truncate">
                    You + {pact.partner.username}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{
                        color: pact.youStudiedToday ? "#4ADE80" : "rgba(255,244,230,0.5)",
                        background: pact.youStudiedToday ? "rgba(74,222,128,0.10)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${pact.youStudiedToday ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      {pact.youStudiedToday
                        ? <Check size={10} weight="bold" aria-hidden="true" />
                        : <Moon size={10} weight="duotone" aria-hidden="true" />}
                      You {pact.youStudiedToday ? "studied" : "not yet"}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{
                        color: pact.partnerStudiedToday ? "#4ADE80" : "rgba(255,244,230,0.5)",
                        background: pact.partnerStudiedToday ? "rgba(74,222,128,0.10)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${pact.partnerStudiedToday ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      {pact.partnerStudiedToday
                        ? <Check size={10} weight="bold" aria-hidden="true" />
                        : <Moon size={10} weight="duotone" aria-hidden="true" />}
                      {pact.partner.username} {pact.partnerStudiedToday ? "studied" : "not yet"}
                    </span>
                  </div>
                </div>

                {/* Joint flame */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Fire size={26} weight="duotone" color={PACT_ACCENT} aria-hidden="true" />
                  <span className="font-bebas text-[32px] leading-none" style={{ color: PACT_ACCENT }}>
                    {pact.currentStreak}
                  </span>
                </div>

                {/* Nudge */}
                {pact.canNudge && !pact.partnerStudiedToday && (
                  <button
                    type="button"
                    onClick={() => sendNudge(pact)}
                    disabled={nudging === pact.id}
                    aria-label={`Nudge ${pact.partner.username} to study today`}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] font-syne font-semibold text-[12px] transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#04080F]"
                    style={{ background: PACT_ACCENT, color: "#04080F" }}
                  >
                    <BellRinging size={14} weight="bold" aria-hidden="true" />
                    {nudging === pact.id ? "Nudging" : "Nudge"}
                  </button>
                )}
              </div>

              {/* Milestone progress */}
              {milestone ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">
                      {pact.currentStreak} / {milestone.target} days to the next milestone
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-gold">
                      +{milestone.reward} each
                      <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3.5 h-3.5 object-contain" />
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(pct, 3)}%`,
                        background: `linear-gradient(90deg, ${PACT_ACCENT}80, ${PACT_ACCENT})`,
                        transition: "width 0.9s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                      }}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40">
                  All milestones claimed. Best run together: {pact.bestStreak} days.
                </p>
              )}

              {pact.milestonePending && (
                <p className="mt-2 text-[11px] text-cream/55">
                  Milestone reached. Your Fangs are on the way and will land soon.
                </p>
              )}
            </div>
          );
        })}

        {inviteCount > 0 && (
          <Link
            href="/social"
            className="block rounded-2xl px-4 py-3 transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,159,69,0.35)" }}
          >
            <span className="inline-flex items-center gap-2 font-syne text-[13px] font-semibold text-cream">
              <HandFist size={16} weight="duotone" color={PACT_ACCENT} aria-hidden="true" />
              {inviteCount === 1 ? "A pact invite is waiting in Social" : `${inviteCount} pact invites are waiting in Social`}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
