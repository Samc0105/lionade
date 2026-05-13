/**
 * Daily Missions — web-side entry point.
 *
 * The pure parts (MissionTemplate type, MISSION_POOL, deterministic daily
 * rotation, reset time) live in @lionade/core/constants/missions. Server-only
 * progress computation (uses supabaseAdmin) stays here.
 *
 * Re-exports the pure surface so existing `import { MISSION_POOL } from '@/lib/missions'`
 * keeps working.
 */
import { supabaseAdmin } from "./supabase-server";
import type { MissionTemplate } from "@lionade/core/constants/missions";

export {
  MISSION_POOL,
  getDailyMissions,
  getMissionResetTime,
} from "@lionade/core/constants/missions";
export type {
  MissionTemplate,
  MissionWithProgress,
} from "@lionade/core/constants/missions";

// ── Progress Computation (server-only) ─────────────────────────────

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
