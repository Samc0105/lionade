// Per-class streak bookkeeping. Best-effort, never throws — every call site
// already succeeds independently (note inserted, flashcard reviewed, etc.),
// and a streak miss should never block the underlying activity.
//
// Usage from any class-scoped activity route:
//
//   import { bumpClassStreak } from "@/lib/class-streaks";
//   await bumpClassStreak(userId, classId);
//
// Math (UTC days; 36h grace window):
//   - No row              → insert {streak: 1, longest: 1, last_activity_at: now}
//   - Same UTC day        → just touch last_activity_at (no streak change)
//   - Different UTC day, < 36h since last activity → streak += 1
//   - > 36h               → reset streak to 1

import { supabaseAdmin } from "./supabase-server";

const GRACE_WINDOW_MS = 36 * 60 * 60 * 1000; // 36h

/** UTC YYYY-MM-DD. */
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bump (or seed) a per-class streak. Best-effort — logs and swallows errors.
 * Returns true on success, false otherwise (callers don't usually care).
 */
export async function bumpClassStreak(
  userId: string,
  classId: string,
): Promise<boolean> {
  if (!userId || !classId) return false;

  try {
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("class_streaks")
      .select("current_streak, longest_streak, last_activity_at")
      .eq("user_id", userId)
      .eq("class_id", classId)
      .maybeSingle();

    if (readErr) {
      console.error("[class-streaks read]", readErr.message);
      return false;
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (!existing) {
      const { error: insertErr } = await supabaseAdmin
        .from("class_streaks")
        .insert({
          user_id: userId,
          class_id: classId,
          current_streak: 1,
          longest_streak: 1,
          last_activity_at: nowIso,
        });
      if (insertErr) {
        console.error("[class-streaks insert]", insertErr.message);
        return false;
      }
      return true;
    }

    const last = existing.last_activity_at
      ? new Date(existing.last_activity_at)
      : null;

    let nextStreak = existing.current_streak;
    if (!last) {
      nextStreak = 1;
    } else {
      const sameUtcDay = utcDayKey(last) === utcDayKey(now);
      const withinGrace = now.getTime() - last.getTime() < GRACE_WINDOW_MS;
      if (sameUtcDay) {
        // Only refresh the activity timestamp — keep streak unchanged.
        nextStreak = existing.current_streak;
      } else if (withinGrace) {
        nextStreak = existing.current_streak + 1;
      } else {
        nextStreak = 1;
      }
    }

    const nextLongest = Math.max(existing.longest_streak, nextStreak);

    const { error: upsertErr } = await supabaseAdmin
      .from("class_streaks")
      .upsert(
        {
          user_id: userId,
          class_id: classId,
          current_streak: nextStreak,
          longest_streak: nextLongest,
          last_activity_at: nowIso,
        },
        { onConflict: "user_id,class_id" },
      );

    if (upsertErr) {
      console.error("[class-streaks upsert]", upsertErr.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[class-streaks unexpected]", (e as Error).message);
    return false;
  }
}
