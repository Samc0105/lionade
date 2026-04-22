import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import { getDailyMissions, computeMissionProgress, getMissionResetTime } from "@/lib/missions";
import type { MissionWithProgress } from "@/lib/missions";

export const dynamic = "force-dynamic";

// GET /api/missions/progress
// Returns today's 3 missions with live progress for the authenticated user.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const todayMissions = getDailyMissions();
  const todayDate = new Date().toISOString().split("T")[0];

  // Fetch existing rows for today
  const { data: existingRows } = await supabaseAdmin
    .from("user_daily_missions")
    .select("*")
    .eq("user_id", userId)
    .eq("mission_date", todayDate);

  const existingMap = new Map(
    (existingRows ?? []).map((r: any) => [r.mission_id, r])
  );

  const results: MissionWithProgress[] = [];

  for (const mission of todayMissions) {
    const existing = existingMap.get(mission.id);
    const progress = await computeMissionProgress(userId, mission);
    const completed = progress >= mission.target;

    if (existing) {
      // Update progress if changed
      if (existing.progress !== progress || existing.completed !== completed) {
        await supabaseAdmin
          .from("user_daily_missions")
          .update({
            progress,
            completed,
            completed_at: completed && !existing.completed ? new Date().toISOString() : existing.completed_at,
          })
          .eq("id", existing.id);
      }

      results.push({
        ...mission,
        progress,
        completed,
        claimed: existing.claimed,
      });
    } else {
      // Create new row
      await supabaseAdmin
        .from("user_daily_missions")
        .insert({
          user_id: userId,
          mission_date: todayDate,
          mission_id: mission.id,
          progress,
          completed,
          completed_at: completed ? new Date().toISOString() : null,
        });

      results.push({
        ...mission,
        progress,
        completed,
        claimed: false,
      });
    }
  }

  return NextResponse.json({
    missions: results,
    resetsIn: getMissionResetTime(),
  });
}
