"use client";

import { useState } from "react";
import { User, Subject } from "@/types";
import { SUBJECT_ICONS } from "@/lib/mockData";

const SUBJECTS: Subject[] = ["Math", "Science", "Languages", "SAT/ACT", "Coding", "Finance", "Certifications"];

const FAKE_OPPONENTS: User[] = [
  { id: "bot-1", username: "StudyBot_Alex", displayName: "Alex", avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=alex", coins: 2400, streak: 7, maxStreak: 12, xp: 5200, level: 6, badges: [], subjectStats: [], joinedAt: "2024-01-01" },
  { id: "bot-2", username: "QuizMaster_99", displayName: "Jordan", avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=jordan", coins: 3100, streak: 11, maxStreak: 15, xp: 7800, level: 8, badges: [], subjectStats: [], joinedAt: "2024-01-01" },
  { id: "bot-3", username: "BrainiacSam", displayName: "Sam", avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=sam", coins: 1800, streak: 3, maxStreak: 9, xp: 3400, level: 4, badges: [], subjectStats: [], joinedAt: "2024-01-01" },
  { id: "bot-4", username: "CoinHunter_X", displayName: "Taylor", avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=taylor", coins: 4200, streak: 14, maxStreak: 20, xp: 9100, level: 10, badges: [], subjectStats: [], joinedAt: "2024-01-01" },
  { id: "bot-5", username: "NightOwl_Dev", displayName: "Riley", avatar: "https://api.dicebear.com/7.x/adventurer/svg?seed=riley", coins: 2700, streak: 5, maxStreak: 11, xp: 4600, level: 5, badges: [], subjectStats: [], joinedAt: "2024-01-01" },
];

interface DuelInviteProps {
  onStartDuel: (opponent: User, subject: Subject) => void;
}

export default function DuelInvite({ onStartDuel }: DuelInviteProps) {
  const [selectedOpponent, setSelectedOpponent] = useState<User | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [step, setStep] = useState<"opponent" | "subject" | "confirm">("opponent");

  const opponents = FAKE_OPPONENTS;

  const handleStart = () => {
    if (selectedOpponent && selectedSubject) {
      onStartDuel(selectedOpponent, selectedSubject);
    }
  };

  return (
    <div className="card max-w-lg w-full mx-auto">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="text-5xl mb-3">⚔️</div>
        <h2 className="font-bebas text-3xl text-cream tracking-wider">Challenge to Duel</h2>
        <p className="text-cream/50 text-sm mt-1">Winner takes double the coins</p>
      </div>

      {/* Steps */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {["opponent", "subject", "confirm"].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                transition-all duration-300
                ${step === s
                  ? "bg-electric text-white shadow-lg shadow-electric/30"
                  : ["opponent", "subject", "confirm"].indexOf(step) > i
                  ? "bg-green-400/20 text-green-400 border border-green-400/50"
                  : "bg-white/10 text-cream/30"
                }`}
            >
              {["opponent", "subject", "confirm"].indexOf(step) > i ? "✓" : i + 1}
            </div>
            {i < 2 && <div className="w-6 h-px bg-electric/20" />}
          </div>
        ))}
      </div>

      {/* Step 1: Choose Opponent */}
      {step === "opponent" && (
        <div className="space-y-3 animate-slide-up">
          <p className="text-cream/70 text-sm font-semibold mb-3">Select an opponent</p>
          {opponents.map((user) => (
            <button
              key={user.id}
              onClick={() => setSelectedOpponent(user)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all duration-200
                ${selectedOpponent?.id === user.id
                  ? "border-electric bg-electric/15 shadow-md shadow-electric/20"
                  : "border-electric/15 hover:border-electric/40 hover:bg-white/5"
                }`}
            >
              <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-electric/30">
                <img src={user.avatar} alt={user.username} className="w-full h-full object-cover bg-navy-50" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-cream text-sm">{user.username}</p>
                <p className="text-xs text-cream/40">Lvl {user.level} · 🔥 {user.streak} streak</p>
              </div>
              <div className="text-right">
                <p className="font-bebas text-lg text-gold">🪙 {user.coins.toLocaleString()}</p>
                <p className="text-xs text-cream/30">#{user.rank}</p>
              </div>
            </button>
          ))}
          <button
            disabled={!selectedOpponent}
            onClick={() => setStep("subject")}
            className="btn-primary w-full mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}

      {/* Step 2: Choose Subject */}
      {step === "subject" && (
        <div className="animate-slide-up">
          <p className="text-cream/70 text-sm font-semibold mb-3">Pick the subject</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {SUBJECTS.map((subject) => (
              <button
                key={subject}
                onClick={() => setSelectedSubject(subject)}
                className={`p-3 rounded-xl border text-left transition-all duration-200
                  ${selectedSubject === subject
                    ? "border-electric bg-electric/15"
                    : "border-electric/15 hover:border-electric/40 hover:bg-white/5"
                  }`}
              >
                <span className="text-2xl">{SUBJECT_ICONS[subject]}</span>
                <p className="text-sm font-bold text-cream mt-1">{subject}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep("opponent")} className="btn-outline flex-1">← Back</button>
            <button
              disabled={!selectedSubject}
              onClick={() => setStep("confirm")}
              className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === "confirm" && selectedOpponent && selectedSubject && (
        <div className="animate-slide-up">
          <p className="text-cream/70 text-sm font-semibold mb-4 text-center">Confirm your duel</p>

          <div className="flex items-center justify-between gap-4 mb-6">
            {/* You */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-electric">
                <img src="https://api.dicebear.com/7.x/adventurer/svg?seed=you" alt="You" className="w-full h-full object-cover bg-navy-50" />
              </div>
              <p className="text-sm font-bold text-electric">You</p>
            </div>

            {/* VS */}
            <div className="flex flex-col items-center">
              <span className="font-bebas text-3xl text-cream/30 leading-none">VS</span>
              <span className="text-xl mt-1">{SUBJECT_ICONS[selectedSubject]}</span>
              <span className="text-xs text-cream/50 mt-1">{selectedSubject}</span>
            </div>

            {/* Opponent */}
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-red-400">
                <img src={selectedOpponent.avatar} alt={selectedOpponent.username} className="w-full h-full object-cover bg-navy-50" />
              </div>
              <p className="text-sm font-bold text-red-400">{selectedOpponent.username}</p>
            </div>
          </div>

          <div className="bg-gold/5 border border-gold/20 rounded-xl p-3 mb-4 text-center">
            <p className="text-gold text-sm font-semibold">🏆 Winner earns 2x coins</p>
            <p className="text-cream/40 text-xs mt-0.5">10 questions · {selectedSubject}</p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep("subject")} className="btn-outline flex-1">← Back</button>
            <button onClick={handleStart} className="btn-gold flex-1">
              ⚔️ Start Duel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
