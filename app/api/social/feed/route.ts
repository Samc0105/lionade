import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * Activity feed for a user's friends — recent coin-earning events that are
 * worth surfacing in a "what's your circle up to" panel. Reads
 * `coin_transactions` (which is the canonical log for every reward event)
 * and the friends list, joins the two, and returns the latest activity.
 *
 * Events surfaced (and no more): quiz_reward, duel_win, streak_milestone,
 * bounty_reward, badge_bonus, game_reward. Chat messages and view events
 * are deliberately excluded — they'd drown the feed.
 */

interface FeedItem {
  id: string;
  friendId: string;
  friendUsername: string;
  friendAvatarUrl: string | null;
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

interface CircleRank {
  userId: string;
  username: string;
  avatarUrl: string | null;
  coinsThisWeek: number;
  isMe: boolean;
}

const SURFACED_TYPES = [
  "quiz_reward",
  "duel_win",
  "streak_milestone",
  "streak_bonus",
  "bounty_reward",
  "badge_bonus",
  "game_reward",
] as const;

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  try {
    // 1. Find accepted friend ids
    const { data: friendships } = await supabaseAdmin
      .from("friendships")
      .select("user_id, friend_id, status")
      .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
      .eq("status", "accepted");

    const friendIds = (friendships ?? [])
      .map(f => (f.user_id === userId ? f.friend_id : f.user_id))
      .filter(Boolean);

    if (friendIds.length === 0) {
      return NextResponse.json({ feed: [] as FeedItem[], circle: [] as CircleRank[] });
    }

    // Circle includes the viewer so they see themselves in the ranking
    const circleIds = [userId, ...friendIds];

    // Monday 00:00 UTC — bound for "this week"
    const weekStart = (() => {
      const now = new Date();
      const day = now.getUTCDay(); // 0 = Sunday
      const daysFromMonday = day === 0 ? 6 : day - 1;
      const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday));
      return monday.toISOString();
    })();

    // ── Wave 2: txns, profiles, weeklyTxns ALL in parallel (3x speedup) ──
    const [txnsRes, profilesRes, weekTxnsRes] = await Promise.all([
      supabaseAdmin
        .from("coin_transactions")
        .select("id, user_id, amount, type, description, created_at")
        .in("user_id", friendIds)
        .in("type", SURFACED_TYPES as unknown as string[])
        .gt("amount", 0)
        .order("created_at", { ascending: false })
        .limit(30),
      supabaseAdmin
        .from("profiles")
        .select("id, username, avatar_url")
        .in("id", circleIds),
      supabaseAdmin
        .from("coin_transactions")
        .select("user_id, amount")
        .in("user_id", circleIds)
        .gt("amount", 0)
        .gte("created_at", weekStart),
    ]);

    const { data: txns, error: txnErr } = txnsRes;
    const { data: profiles } = profilesRes;
    const { data: weekTxns } = weekTxnsRes;

    if (txnErr) {
      console.error("[social/feed] coin_transactions error:", txnErr.message);
      return NextResponse.json({ feed: [] as FeedItem[], circle: [] as CircleRank[] });
    }

    const profileMap = new Map(
      (profiles ?? []).map(p => [p.id, { username: p.username, avatar_url: p.avatar_url }]),
    );

    const weeklyTotals = new Map<string, number>();
    for (const t of weekTxns ?? []) {
      weeklyTotals.set(t.user_id, (weeklyTotals.get(t.user_id) ?? 0) + (t.amount ?? 0));
    }

    const circle: CircleRank[] = circleIds
      .map(id => {
        const p = profileMap.get(id);
        if (!p) return null;
        return {
          userId: id,
          username: p.username,
          avatarUrl: p.avatar_url,
          coinsThisWeek: weeklyTotals.get(id) ?? 0,
          isMe: id === userId,
        } satisfies CircleRank;
      })
      .filter((x): x is CircleRank => x !== null)
      .sort((a, b) => b.coinsThisWeek - a.coinsThisWeek);

    // 4b. Shape feed response — drop txns whose author has disappeared (edge case)
    const feed: FeedItem[] = (txns ?? [])
      .map(t => {
        const p = profileMap.get(t.user_id);
        if (!p) return null;
        return {
          id: t.id,
          friendId: t.user_id,
          friendUsername: p.username,
          friendAvatarUrl: p.avatar_url,
          type: t.type,
          amount: t.amount,
          description: t.description,
          createdAt: t.created_at,
        } satisfies FeedItem;
      })
      .filter((x): x is FeedItem => x !== null)
      .slice(0, 20);

    return NextResponse.json({ feed, circle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[social/feed] exception:", msg);
    return NextResponse.json({ feed: [] as FeedItem[], circle: [] as CircleRank[] });
  }
}
