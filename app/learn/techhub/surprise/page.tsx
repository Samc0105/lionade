"use client";

import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Shuffle } from "@phosphor-icons/react";
import PlayGeneratedShift from "@/components/liondesk/PlayGeneratedShift";

// Procedurally combined shifts. ?seed=<code> (Idea 14: a shared, exact shift,
// highest precedence), ?daily=1 (date-seeded), ?chaos=1 (stacked mutators; with
// daily = the shared Daily Chaos), ?combo=<code> (a shared combo recipe).
export default function SurprisePage() {
  const sp = useSearchParams();
  const daily = sp?.get("daily") === "1";
  const chaos = sp?.get("chaos") === "1";
  const weekly = sp?.get("weekly") === "1";
  const combo = sp?.get("combo") ?? undefined;
  const seed = sp?.get("seed") ?? undefined;

  const title = seed ? "SHARED SHIFT" : combo ? "SHARED COMBO" : weekly ? "WEEKLY CHALLENGE" : chaos && daily ? "DAILY CHAOS" : chaos ? "CHAOS SHIFT" : daily ? "DAILY COMBO" : "SURPRISE SHIFT";
  const sub = seed
    ? "An exact shift a player shared. The same tickets, in the same order, every time you open it."
    : combo
    ? "Someone's hand-built combo. Run it back for a fresh draw of the same recipe."
    : weekly
    ? "This week's gauntlet. The same brutal combo for everyone, all week."
    : chaos && daily
    ? "Today's brutal gauntlet. Three or four mutators stacked, same for everyone."
    : daily
    ? "Today's mix of tickets and mutators. Same for everyone."
    : "A random mix of tickets and mutators. No two runs alike.";

  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Shuffle size={34} weight="fill" color="#A855F7" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">{title}</h1>
            <p className="text-cream/50 text-sm mt-0.5">{sub}</p>
          </div>
        </div>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <PlayGeneratedShift daily={daily} chaos={chaos} weekly={weekly} comboCode={combo} sharedCode={seed} />
        </div>
      </div>
    </ProtectedRoute>
  );
}
