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

  // Batched: was N sequential round-trips per mission (computeMissionProgress + per-mission update/insert)
  const [{ data: existingRows }, progresses] = await Promise.all([
    supabaseAdmin
      .from("user_daily_missions")
      .select("*")
      .eq("user_id", userId)
      .eq("mission_date", todayDate),
    Promise.all(todayMissions.map(m => computeMissionProgress(userId, m))),
  ]);

  const existingMap = new Map(
    (existingRows ?? []).map((r: any) => [r.mission_id, r])
  );

  const results: MissionWithProgress[] = [];
  const rowsToWrite: Array<{
    user_id: string;
    mission_date: string;
    mission_id: string;
    progress: number;
    completed: boolean;
    completed_at: string | null;
    claimed?: boolean;
  }> = [];
  const nowIso = new Date().toISOString();

  for (let i = 0; i < todayMissions.length; i++) {
    const mission = todayMissions[i];
    const progress = progresses[i];
    const completed = progress >= mission.target;
    const existing = existingMap.get(mission.id);

    if (existing) {
      // Update progress if changed
      if (existing.progress !== progress || existing.completed !== completed) {
        rowsToWrite.push({
          user_id: userId,
          mission_date: todayDate,
          mission_id: mission.id,
          progress,
          completed,
          completed_at: completed && !existing.completed ? nowIso : existing.completed_at,
          claimed: existing.claimed,
        });
      }

      results.push({
        ...mission,
        progress,
        completed,
        claimed: existing.claimed,
      });
    } else {
      // Create new row
      rowsToWrite.push({
        user_id: userId,
        mission_date: todayDate,
        mission_id: mission.id,
        progress,
        completed,
        completed_at: completed ? nowIso : null,
      });

      results.push({
        ...mission,
        progress,
        completed,
        claimed: false,
      });
    }
  }

  if (rowsToWrite.length > 0) {
    await supabaseAdmin
      .from("user_daily_missions")
      .upsert(rowsToWrite, { onConflict: "user_id,mission_date,mission_id" });
  }

  return NextResponse.json({
    missions: results,
    resetsIn: getMissionResetTime(),
  });
}
