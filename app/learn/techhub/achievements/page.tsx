"use client";

import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { Trophy, ChartLineUp, ChatsCircle, ArrowRight } from "@phosphor-icons/react";
import AchievementsPanel from "@/components/liondesk/AchievementsPanel";

export default function AchievementsPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
        <BackButton href="/learn/techhub" label="TechHub" />

        <div className="flex items-center gap-3 mb-4 animate-slide-up">
          <Trophy size={34} weight="fill" color="#FFD700" aria-hidden="true" />
          <div>
            <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-none">PROFILE</h1>
            <p className="text-cream/50 text-sm mt-0.5">Your stats, unlockable desk themes, recent runs, and achievements.</p>
          </div>
        </div>

        <Link
          href="/learn/techhub/stats"
          className="group flex items-center gap-3 rounded-2xl border border-electric/25 bg-electric/[0.05] p-3 mb-5 hover:bg-electric/[0.09] transition-colors animate-slide-up"
          style={{ animationDelay: "0.04s" }}
        >
          <ChartLineUp size={20} weight="fill" color="#4A90D9" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-electric/90">performance dashboard</p>
            <p className="text-cream/55 text-[11px] mt-0.5">Per track performance, best scores, weakest concepts, and your recent activity.</p>
          </div>
          <ArrowRight size={14} weight="bold" color="#4A90D9" aria-hidden="true" className="group-hover:translate-x-1 transition-transform" />
        </Link>

        <Link
          href="/learn/techhub/oneonone"
          className="group flex items-center gap-3 rounded-2xl border border-gold/25 bg-gold/[0.05] p-3 mb-5 hover:bg-gold/[0.09] transition-colors animate-slide-up"
          style={{ animationDelay: "0.05s" }}
        >
          <ChatsCircle size={20} weight="fill" color="#FFD700" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/90">manager 1:1</p>
            <p className="text-cream/55 text-[11px] mt-0.5">Periodic reviews with your manager, with goals drawn from the concepts you miss most.</p>
          </div>
          <ArrowRight size={14} weight="bold" color="#FFD700" aria-hidden="true" className="group-hover:translate-x-1 transition-transform" />
        </Link>

        <div className="animate-slide-up" style={{ animationDelay: "0.06s" }}>
          <AchievementsPanel />
        </div>
      </div>
    </ProtectedRoute>
  );
}
