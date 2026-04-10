import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";
import {
  NINNY_DAILY_LIMIT,
  NINNY_FREE_PER_DAY,
  NINNY_FANG_COSTS,
} from "@/lib/ninny";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Auth: derive userId from session — ignore any query string userId
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  // Today (UTC) cutoff for daily count
  const todayUTC = new Date().toISOString().split("T")[0];
  const todayStart = `${todayUTC}T00:00:00.000Z`;

  try {
    const [materialsRes, countRes, profileRes] = await Promise.all([
      supabaseAdmin
        .from("ninny_materials")
        .select("id, title, subject, difficulty, generated_content, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(8),
      supabaseAdmin
        .from("ninny_materials")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", todayStart),
      supabaseAdmin
        .from("profiles")
        .select("selected_subjects, coins")
        .eq("id", userId)
        .single(),
    ]);

    const materials = materialsRes.data ?? [];
    const todayCount = countRes.count ?? 0;
    const selectedSubjects = (profileRes.data?.selected_subjects ?? []) as string[];
    const userCoins = profileRes.data?.coins ?? 0;
    const freeRemaining = Math.max(0, NINNY_FREE_PER_DAY - todayCount);
    const dailyRemaining = Math.max(0, NINNY_DAILY_LIMIT - todayCount);

    return NextResponse.json({
      materials,
      todayCount,
      dailyLimit: NINNY_DAILY_LIMIT,
      dailyRemaining,
      freeRemaining,
      freePerDay: NINNY_FREE_PER_DAY,
      fangCosts: NINNY_FANG_COSTS,
      userCoins,
      selectedSubjects,
    });
  } catch (e) {
    console.error("[ninny/materials] error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
