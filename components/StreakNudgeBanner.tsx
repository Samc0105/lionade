"use client";

import { useEffect, useState } from "react";
import { Fire } from "@phosphor-icons/react";
import ClaimBanner from "@/components/ClaimBanner";

/**
 * Streak Nudge — a gentle "your streak is at risk today" prompt.
 *
 * Distinct from StreakReviveBanner, which fires only AFTER a streak breaks and
 * a paid revive window is open. This nudges BEFORE the loss: the player still
 * has a live streak but has not studied yet today. It only shows in the
 * afternoon/evening so we don't badger someone at 9am who has all day, and it
 * is dismissible for the rest of the day.
 *
 * Pure presentational: the dashboard already loads streak + daily-progress, so
 * this takes them as props and adds no fetch of its own. Dismissal persists for
 * the current calendar day via sessionStorage.
 */

// Local calendar day, e.g. "Tue Jun 30 2026". Used as the dismissal key so a
// dismiss lasts only for today and the nudge can return tomorrow.
function todayKey(): string {
  return new Date().toDateString();
}

const DISMISS_KEY = "lionade_streak_nudge_dismissed";

export default function StreakNudgeBanner({
  streak,
  dailyDone,
  ready,
}: {
  streak: number;
  dailyDone: boolean;
  ready: boolean;
}) {
  // The hour-of-day gate and the sessionStorage dismissal are both client-only.
  // Start closed so SSR and the first client paint render the same empty tree
  // (no hydration mismatch, no flash), then open post-mount if the gate passes.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!ready || streak <= 0 || dailyDone) {
      setShow(false);
      return;
    }
    const hour = new Date().getHours();
    if (hour < 14 || hour >= 23) {
      setShow(false);
      return;
    }
    // Effects are client-only, so window/sessionStorage are always available here.
    const dismissedToday = sessionStorage.getItem(DISMISS_KEY) === todayKey();
    setShow(!dismissedToday);
  }, [ready, streak, dailyDone]);

  if (!show) return null;

  const onDismiss = () => {
    setShow(false);
    sessionStorage.setItem(DISMISS_KEY, todayKey());
  };

  return (
    <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.04s" }}>
      <ClaimBanner
        variant="gold"
        size="panel"
        ariaLabel="Daily streak reminder"
        icon={<Fire size={26} weight="fill" />}
        eyebrow="Streak at risk"
        title={<>Keep your <span className="text-gold">{streak}-day</span> streak alive</>}
        description="One quiz today and it carries over. Miss today and your streak resets."
        primaryAction={{ label: "Start a quiz", href: "/quiz" }}
        onDismiss={onDismiss}
        dismissLabel="Dismiss for today"
      />
    </div>
  );
}
