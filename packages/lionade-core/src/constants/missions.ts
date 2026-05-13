/**
 * Daily Missions System — pure pool + deterministic daily rotation.
 *
 * 18 mission templates, deterministically rotated daily.
 * Same 3 missions for all users on any given UTC day.
 *
 * The DB-touching part (computeMissionProgress) stays in web /lib/missions.ts
 * because it uses Supabase admin client. This file holds only platform-agnostic
 * pure functions and the template pool.
 *
 * Split from web /lib/missions.ts on 2026-05-13.
 */

export interface MissionTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: "quiz" | "streak" | "subject" | "social" | "game" | "ninny";
  target: number;
  coinReward: number;
  xpReward: number;
  color: string;
  progressQuery: string;
}

export interface MissionWithProgress extends MissionTemplate {
  progress: number;
  completed: boolean;
  claimed: boolean;
}

// ── Mission Pool (18 templates) ─────────────────────────────

export const MISSION_POOL: MissionTemplate[] = [
  // Quiz-based (6)
  { id: "answer_10", title: "Answer 10 Questions", description: "Answer any 10 quiz questions today", icon: "\u{1F4DD}", type: "quiz", target: 10, coinReward: 15, xpReward: 30, color: "#FFD700", progressQuery: "questions_today" },
  { id: "answer_20", title: "Knowledge Overflow", description: "Answer 20 questions in a single day", icon: "\u{1F4DA}", type: "quiz", target: 20, coinReward: 30, xpReward: 60, color: "#FFD700", progressQuery: "questions_today" },
  { id: "complete_2_quizzes", title: "Double Feature", description: "Complete 2 full quizzes today", icon: "\u{270D}\u{FE0F}", type: "quiz", target: 2, coinReward: 20, xpReward: 40, color: "#FFD700", progressQuery: "quizzes_today" },
  { id: "complete_5_quizzes", title: "Quiz Marathon", description: "Complete 5 quizzes in one day", icon: "\u{1F3C3}", type: "quiz", target: 5, coinReward: 50, xpReward: 100, color: "#FFD700", progressQuery: "quizzes_today" },
  { id: "score_8_plus", title: "Sharpshooter", description: "Score 8/10 or higher on a quiz", icon: "\u{1F3AF}", type: "quiz", target: 1, coinReward: 25, xpReward: 50, color: "#FFD700", progressQuery: "best_score_today" },
  { id: "perfect_score", title: "Perfectionist", description: "Get a perfect 10/10 on a quiz", icon: "\u{1F451}", type: "quiz", target: 1, coinReward: 40, xpReward: 80, color: "#FFD700", progressQuery: "perfect_today" },

  // Streak-based (3)
  { id: "maintain_streak", title: "Keep the Fire", description: "Play today to keep your streak alive", icon: "\u{1F525}", type: "streak", target: 1, coinReward: 20, xpReward: 40, color: "#E67E22", progressQuery: "streak_active" },
  { id: "streak_3_plus", title: "On a Roll", description: "Reach a 3+ day streak", icon: "\u{1F4AA}", type: "streak", target: 3, coinReward: 30, xpReward: 60, color: "#E67E22", progressQuery: "current_streak" },
  { id: "streak_7_plus", title: "Dedication", description: "Reach a 7+ day streak", icon: "\u{2B50}", type: "streak", target: 7, coinReward: 60, xpReward: 120, color: "#E67E22", progressQuery: "current_streak" },

  // Subject-specific (3)
  { id: "study_2_subjects", title: "Well-Rounded", description: "Complete quizzes in 2 different subjects", icon: "\u{1F310}", type: "subject", target: 2, coinReward: 25, xpReward: 50, color: "#9B59B6", progressQuery: "distinct_subjects" },
  { id: "study_3_subjects", title: "Renaissance Scholar", description: "Study 3 different subjects today", icon: "\u{1F393}", type: "subject", target: 3, coinReward: 40, xpReward: 80, color: "#9B59B6", progressQuery: "distinct_subjects" },
  { id: "earn_50_coins", title: "Coin Hunter", description: "Earn 50 coins today from quizzes", icon: "\u{1FA99}", type: "subject", target: 50, coinReward: 20, xpReward: 40, color: "#9B59B6", progressQuery: "coins_today" },

  // Competitive/Social (3)
  { id: "play_arena", title: "Enter the Arena", description: "Complete 1 arena match", icon: "\u{2694}\u{FE0F}", type: "social", target: 1, coinReward: 30, xpReward: 60, color: "#E74C3C", progressQuery: "arena_completed" },
  { id: "win_arena", title: "Victor", description: "Win an arena match", icon: "\u{1F3C6}", type: "social", target: 1, coinReward: 40, xpReward: 80, color: "#E74C3C", progressQuery: "arena_won" },
  { id: "send_friend_req", title: "Stay Connected", description: "Send or accept a friend request", icon: "\u{1F91D}", type: "social", target: 1, coinReward: 10, xpReward: 20, color: "#E74C3C", progressQuery: "friend_activity" },

  // Blitz/Game (2)
  { id: "play_blitz", title: "Blitz Mode", description: "Play a Blitz round", icon: "\u{26A1}", type: "game", target: 1, coinReward: 25, xpReward: 50, color: "#4A90D9", progressQuery: "blitz_played" },
  { id: "play_any_game", title: "Arcade Run", description: "Play any mini-game", icon: "\u{1F3AE}", type: "game", target: 1, coinReward: 15, xpReward: 30, color: "#4A90D9", progressQuery: "game_played" },

  // Ninny AI (1)
  { id: "use_ninny", title: "Ask the Tutor", description: "Complete a Ninny study session", icon: "\u{1F981}", type: "ninny", target: 1, coinReward: 20, xpReward: 40, color: "#2ECC71", progressQuery: "ninny_session" },
];

// ── Deterministic Daily Rotation ─────────────────────────────

/** Simple hash for date-seeded selection (djb2) */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic shuffle using a seed */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** Get today's 3 missions (deterministic — same for all users) */
export function getDailyMissions(date?: Date): MissionTemplate[] {
  const d = date ?? new Date();
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  const seed = hashString(dateStr);
  const shuffled = seededShuffle(MISSION_POOL, seed);

  // Pick 3 with diversity: ensure at least 2 different types
  const picked: MissionTemplate[] = [shuffled[0]!];
  for (let i = 1; i < shuffled.length && picked.length < 3; i++) {
    const candidate = shuffled[i]!;
    if (picked.length === 2) {
      picked.push(candidate);
    } else {
      if (candidate.type !== picked[0]!.type) {
        picked.push(candidate);
      }
    }
  }
  // Fallback: if we somehow didn't get 3, just take from shuffled
  while (picked.length < 3) {
    const next = shuffled.find(m => !picked.includes(m));
    if (next) picked.push(next);
    else break;
  }

  return picked;
}

/** Get time until next mission reset (midnight UTC) */
export function getMissionResetTime(now: Date = new Date()): string {
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  const ms = nextMidnight.getTime() - now.getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}
