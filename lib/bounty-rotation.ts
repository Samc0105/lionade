// Bounty Rotation Engine
//
// Manages daily (midnight UTC) and weekly (Friday midnight UTC) bounty rotation.
// Picks random bounties from the pool, activates them, resets user progress.
// Called on dashboard load — checks if rotation is needed before acting.

import { supabaseAdmin } from "./supabase-server";

const DAILY_ACTIVE_COUNT = 3;
const WEEKLY_ACTIVE_COUNT = 3;

interface RotationState {
  id: string;
  active_bounty_ids: string[];
  rotated_at: string;
  next_rotation: string;
}

/** Check if daily or weekly rotation is needed and perform it */
export async function checkAndRotateBounties(): Promise<{
  dailyRotated: boolean;
  weeklyRotated: boolean;
}> {
  let dailyRotated = false;
  let weeklyRotated = false;

  try {
    const now = new Date();

    // Check daily rotation
    const { data: dailyState } = await supabaseAdmin
      .from("bounty_rotation")
      .select("*")
      .eq("id", "daily")
      .single();

    if (dailyState && new Date(dailyState.next_rotation) <= now) {
      await rotateBounties("daily", DAILY_ACTIVE_COUNT);
      dailyRotated = true;
    } else if (!dailyState || dailyState.active_bounty_ids.length === 0) {
      // First time — do initial rotation
      await rotateBounties("daily", DAILY_ACTIVE_COUNT);
      dailyRotated = true;
    }

    // Check weekly rotation (Friday)
    const { data: weeklyState } = await supabaseAdmin
      .from("bounty_rotation")
      .select("*")
      .eq("id", "weekly")
      .single();

    if (weeklyState && new Date(weeklyState.next_rotation) <= now) {
      await rotateBounties("weekly", WEEKLY_ACTIVE_COUNT);
      weeklyRotated = true;
    } else if (!weeklyState || weeklyState.active_bounty_ids.length === 0) {
      await rotateBounties("weekly", WEEKLY_ACTIVE_COUNT);
      weeklyRotated = true;
    }
  } catch (e) {
    console.warn("[bounty-rotation] checkAndRotate error:", e);
  }

  return { dailyRotated, weeklyRotated };
}

/** Perform a rotation for a given type */
async function rotateBounties(type: "daily" | "weekly", count: number): Promise<void> {
  const poolId = `${type}_pool`;

  // 1. Get all bounties in this pool
  const { data: pool } = await supabaseAdmin
    .from("bounties")
    .select("id")
    .eq("pool_id", poolId);

  if (!pool || pool.length === 0) return;

  // 2. Deactivate all bounties in this pool
  await supabaseAdmin
    .from("bounties")
    .update({ active: false })
    .eq("pool_id", poolId);

  // 3. Pick random bounties to activate
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, shuffled.length));
  const selectedIds = selected.map(b => b.id);

  // 4. Activate selected bounties
  for (const id of selectedIds) {
    await supabaseAdmin
      .from("bounties")
      .update({ active: true })
      .eq("id", id);
  }

  // 5. Reset user progress for ALL bounties in this pool
  // Delete user_bounties rows for bounties in this pool that aren't claimed
  const allPoolIds = pool.map(b => b.id);
  await supabaseAdmin
    .from("user_bounties")
    .delete()
    .in("bounty_id", allPoolIds)
    .eq("claimed", false);

  // 6. Update rotation state
  const nextRotation = calculateNextRotation(type);
  await supabaseAdmin
    .from("bounty_rotation")
    .upsert({
      id: type,
      active_bounty_ids: selectedIds,
      rotated_at: new Date().toISOString(),
      next_rotation: nextRotation.toISOString(),
    }, { onConflict: "id" });

  console.log(`[bounty-rotation] Rotated ${type}: ${selectedIds.length} bounties activated, next rotation: ${nextRotation.toISOString()}`);
}

/** Calculate the next rotation time */
function calculateNextRotation(type: "daily" | "weekly"): Date {
  const now = new Date();

  if (type === "daily") {
    // Next midnight UTC
    const next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
      0, 0, 0, 0
    ));
    return next;
  }

  // Weekly: next Friday midnight UTC
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 5=Fri
  let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  if (daysUntilFriday === 0) daysUntilFriday = 7; // if today is Friday, next Friday
  const next = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilFriday,
    0, 0, 0, 0
  ));
  return next;
}

/** Get time until next rotation for display */
export function getRotationInfo(): {
  dailyResetsIn: string;
  weeklyResetsIn: string;
} {
  const now = new Date();

  // Daily: next midnight UTC
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  const dailyMs = nextMidnight.getTime() - now.getTime();
  const dailyH = Math.floor(dailyMs / 3600000);
  const dailyM = Math.floor((dailyMs % 3600000) / 60000);

  // Weekly: next Friday
  const dayOfWeek = now.getUTCDay();
  let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  if (daysUntilFriday === 0) daysUntilFriday = 7;

  return {
    dailyResetsIn: `${dailyH}h ${dailyM}m`,
    weeklyResetsIn: `${daysUntilFriday} day${daysUntilFriday !== 1 ? "s" : ""}`,
  };
}
