// Daily Missions System
//
// 18 mission templates, deterministically rotated daily.
// Same 3 missions for all users on any given UTC day.
// Progress computed lazily from existing tables (no new hooks).

import { supabaseAdmin } from "./supabase-server";

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

const MISSION_POOL: MissionTemplate[] = [
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
    [result[i], result[j]] = [result[j], result[i]];
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
  const picked: MissionTemplate[] = [shuffled[0]];
  for (let i = 1; i < shuffled.length && picked.length < 3; i++) {
    if (picked.length === 2) {
      // 3rd pick: allow any type
      picked.push(shuffled[i]);
    } else {
      // 2nd pick: prefer different type than 1st
      if (shuffled[i].type !== picked[0].type) {
        picked.push(shuffled[i]);
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

// ── Progress Computation ─────────────────────────────────────

/** Compute current progress for a mission from existing DB tables */
export async function computeMissionProgress(userId: string, mission: MissionTemplate): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  try {
    switch (mission.progressQuery) {
      case "questions_today": {
        const { data } = await supabaseAdmin
          .from("daily_activity")
          .select("questions_answered")
          .eq("user_id", userId)
          .eq("date", todayISO.split("T")[0])
          .maybeSingle();
        return data?.questions_answered ?? 0;
      }

      case "quizzes_today": {
        const { count } = await supabaseAdmin
          .from("quiz_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("completed_at", todayISO);
        return count ?? 0;
      }

      case "best_score_today": {
        const { data } = await supabaseAdmin
          .from("quiz_sessions")
          .select("correct_answers")
          .eq("user_id", userId)
          .gte("completed_at", todayISO)
          .order("correct_answers", { ascending: false })
          .limit(1)
          .maybeSingle();
        return (data?.correct_answers ?? 0) >= 8 ? 1 : 0;
      }

      case "perfect_today": {
        const { data } = await supabaseAdmin
          .from("quiz_sessions")
          .select("correct_answers, total_questions")
          .eq("user_id", userId)
          .gte("completed_at", todayISO);
        const hasPerfect = (data ?? []).some(q => q.correct_answers === q.total_questions && q.total_questions >= 10);
        return hasPerfect ? 1 : 0;
      }

      case "streak_active": {
        const { data } = await supabaseAdmin
          .from("daily_activity")
          .select("id")
          .eq("user_id", userId)
          .eq("date", todayISO.split("T")[0])
          .maybeSingle();
        return data ? 1 : 0;
      }

      case "current_streak": {
        const { data } = await supabaseAdmin
          .from("profiles")
          .select("streak")
          .eq("id", userId)
          .single();
        return data?.streak ?? 0;
      }

      case "distinct_subjects": {
        const { data } = await supabaseAdmin
          .from("quiz_sessions")
          .select("subject")
          .eq("user_id", userId)
          .gte("completed_at", todayISO);
        const unique = new Set((data ?? []).map(d => d.subject));
        return unique.size;
      }

      case "coins_today": {
        const { data } = await supabaseAdmin
          .from("daily_activity")
          .select("coins_earned")
          .eq("user_id", userId)
          .eq("date", todayISO.split("T")[0])
          .maybeSingle();
        return data?.coins_earned ?? 0;
      }

      case "arena_completed": {
        const { count } = await supabaseAdmin
          .from("arena_matches")
          .select("id", { count: "exact", head: true })
          .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
          .eq("status", "completed")
          .gte("created_at", todayISO);
        return count ?? 0;
      }

      case "arena_won": {
        const { count } = await supabaseAdmin
          .from("arena_matches")
          .select("id", { count: "exact", head: true })
          .eq("winner_id", userId)
          .eq("status", "completed")
          .gte("created_at", todayISO);
        return count ?? 0;
      }

      case "friend_activity": {
        const { count } = await supabaseAdmin
          .from("friendships")
          .select("id", { count: "exact", head: true })
          .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
          .gte("created_at", todayISO);
        return Math.min(count ?? 0, 1);
      }

      case "blitz_played": {
        const { count } = await supabaseAdmin
          .from("coin_transactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("type", "game_reward")
          .ilike("description", "%blitz%")
          .gte("created_at", todayISO);
        return count ?? 0;
      }

      case "game_played": {
        const { count } = await supabaseAdmin
          .from("coin_transactions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("type", "game_reward")
          .gte("created_at", todayISO);
        return count ?? 0;
      }

      case "ninny_session": {
        const { count } = await supabaseAdmin
          .from("ninny_sessions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gte("completed_at", todayISO);
        return count ?? 0;
      }

      default:
        return 0;
    }
  } catch (e) {
    console.warn(`[missions] progress error for ${mission.id}:`, e);
    return 0;
  }
}

/** Get time until next mission reset (midnight UTC) */
export function getMissionResetTime(): string {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  const ms = nextMidnight.getTime() - now.getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}
