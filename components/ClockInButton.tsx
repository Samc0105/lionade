"use client";

import { useState } from "react";
import { apiPost } from "@/lib/api-client";
import { toastSuccess, toastInfo, toastError } from "@/lib/toast";
import { mutateUserStats } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import { Coin, CheckCircle } from "@phosphor-icons/react";

/**
 * "Clock In" — daily check-in claim button for the Navbar CTA slot.
 *
 * Design decision: this replaces the old "Clock In" link that just
 * routed to /quiz. Rewarding the user for SHOWING UP (not for studying)
 * is a stronger habit-loop signal in a gamified rewards app — the user
 * gets Fangs the moment they click, independent of completing a quiz.
 *
 * Backed by the existing `/api/login-bonus` endpoint (escalating tiers:
 * 10F day 1, 15F day 2, 25F day 3+; resets on a missed day). That
 * endpoint is idempotent — a second click the same day returns
 * `{ awarded: false, reason: "already_claimed" }` without granting
 * anything. So we can safely fire it on every click without tracking
 * client-side state for dedup.
 */

type ClockInResponse = {
  awarded: boolean;
  amount?: number;
  consecutiveDays?: number;
  reason?: string;
};

export default function ClockInButton() {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [claimedToday, setClaimedToday] = useState(false);

  const handleClick = async () => {
    if (submitting || claimedToday) return;
    setSubmitting(true);
    try {
      const r = await apiPost<ClockInResponse>("/api/login-bonus", {});
      if (!r.ok || !r.data) {
        toastError("Couldn't clock in. Try again in a sec.");
        return;
      }
      if (r.data.awarded && r.data.amount) {
        toastSuccess(
          `+${r.data.amount} Fangs · clocked in for day ${r.data.consecutiveDays ?? 1}`,
          { duration: 4000 },
        );
        // Revalidate the user's coin balance in the navbar + wherever else
        // the stats hook is consumed so they see the new total immediately.
        if (user?.id) mutateUserStats(user.id);
      } else if (r.data.reason === "already_claimed") {
        toastInfo("You've already clocked in today. Come back tomorrow.");
      } else {
        toastError("Couldn't clock in. Try again in a sec.");
        return;
      }
      setClaimedToday(true);
    } catch {
      toastError("Couldn't clock in. Try again in a sec.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={submitting || claimedToday}
      aria-label={claimedToday ? "Already clocked in today" : "Clock in for your daily Fangs bonus"}
      className={`
        inline-flex items-center gap-1.5
        font-syne font-bold text-sm px-4 py-1.5 rounded-lg
        transition-all duration-200 active:scale-95
        disabled:cursor-not-allowed disabled:active:scale-100
        ${claimedToday
          ? "text-cream/50 bg-white/[0.04] border border-white/[0.08]"
          : "text-navy bg-electric hover:bg-electric-light shadow-md shadow-electric/30 hover:shadow-electric/50 disabled:opacity-70"
        }
      `}
    >
      {claimedToday
        ? <><CheckCircle size={14} weight="fill" />Clocked in</>
        : <><Coin size={14} weight="fill" />{submitting ? "Clocking in…" : "Clock In"}</>
      }
    </button>
  );
}
