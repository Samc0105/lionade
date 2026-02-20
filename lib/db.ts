import { supabase } from "@/lib/supabase";
import type { Subject } from "@/types";

// ── Profile ───────────────────────────────────────────────────

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProfile(userId: string, updates: {
  username?: string;
  display_name?: string;
  avatar_url?: string;
}) {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Questions ─────────────────────────────────────────────────

export async function getQuestions(subject: Subject): Promise<{
  id: string;
  subject: string;
  question: string;
  options: string[];
  correct_answer: number;
  difficulty: string;
  coin_reward: number;
  explanation: string | null;
}[]> {
  const { data, error } = await supabase
    .from("questions")
    .select("id, subject, question, options, correct_answer, difficulty, coin_reward, explanation")
    .eq("subject", subject)
    .eq("is_active", true)
    .limit(10);
  if (error) throw error;
  return (data ?? []).map(q => ({ ...q, options: q.options as string[] }));
}

// ── Quiz Sessions ─────────────────────────────────────────────

export async function saveQuizSession(session: {
  user_id: string;
  subject: string;
  total_questions: number;
  correct_answers: number;
  coins_earned: number;
  xp_earned: number;
  streak_bonus: boolean;
}): Promise<{ id: string; user_id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; xp_earned: number; streak_bonus: boolean; completed_at: string }> {
  const { data: rawSession, error } = await supabase
    .from("quiz_sessions")
    .insert(session)
    .select()
    .single();
  if (error) throw error;
  const data = rawSession as unknown as { id: string; user_id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; xp_earned: number; streak_bonus: boolean; completed_at: string };

  // Award coins and XP to profile manually
  await incrementCoins(session.user_id, session.coins_earned);
  await incrementXP(session.user_id, session.xp_earned);

  // Log coin transaction
  if (session.coins_earned > 0) {
    await supabase.from("coin_transactions").insert({
      user_id: session.user_id,
      amount: session.coins_earned,
      type: "quiz_reward",
      reference_id: data.id,
      description: `${session.subject} quiz — ${session.correct_answers}/${session.total_questions} correct`,
    });
  }

  // Update streak / daily activity
  await upsertDailyActivity(session.user_id, session.coins_earned, session.total_questions);

  return data;
}

export async function saveUserAnswer(answer: {
  session_id: string;
  question_id: string;
  selected_answer: number | null;
  is_correct: boolean;
  time_left: number;
}) {
  const { error } = await supabase.from("user_answers").insert(answer);
  if (error) throw error;
}

// ── Streak / Daily Activity ───────────────────────────────────

async function upsertDailyActivity(userId: string, coinsEarned: number, questionsAnswered: number) {
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("daily_activity")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("daily_activity")
      .update({
        questions_answered: existing.questions_answered + questionsAnswered,
        coins_earned: existing.coins_earned + coinsEarned,
        streak_maintained: true,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("daily_activity").insert({
      user_id: userId,
      date: today,
      questions_answered: questionsAnswered,
      coins_earned: coinsEarned,
      streak_maintained: true,
    });

    // Check if yesterday had activity to continue streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    const { data: yesterdayActivity } = await supabase
      .from("daily_activity")
      .select("streak_maintained")
      .eq("user_id", userId)
      .eq("date", yesterdayStr)
      .maybeSingle();

    const { data: profile } = await supabase
      .from("profiles")
      .select("streak, max_streak")
      .eq("id", userId)
      .single();

    if (profile) {
      const newStreak = yesterdayActivity?.streak_maintained ? profile.streak + 1 : 1;
      const newMax = Math.max(newStreak, profile.max_streak);
      await supabase
        .from("profiles")
        .update({ streak: newStreak, max_streak: newMax })
        .eq("id", userId);
    }
  }
}

// ── Leaderboard ───────────────────────────────────────────────

export async function getLeaderboard(limit = 10): Promise<{
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  level: number;
  streak: number;
  coins_this_week: number;
}[]> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Get weekly coins via coin_transactions
  const { data, error } = await supabase
    .from("coin_transactions")
    .select("user_id, amount")
    .gte("created_at", weekAgo.toISOString())
    .eq("type", "quiz_reward");

  if (error) throw error;

  // Aggregate by user
  const weeklyMap: Record<string, number> = {};
  for (const row of data ?? []) {
    weeklyMap[row.user_id] = (weeklyMap[row.user_id] ?? 0) + row.amount;
  }

  if (Object.keys(weeklyMap).length === 0) {
    // Fallback: just return top profiles by total coins
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, level, streak, coins")
      .order("coins", { ascending: false })
      .limit(limit);

    return (profiles ?? []).map((p, i) => ({
      rank: i + 1,
      user_id: p.id,
      username: p.username,
      avatar_url: p.avatar_url,
      level: p.level,
      streak: p.streak,
      coins_this_week: p.coins,
    }));
  }

  const topUserIds = Object.entries(weeklyMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id]) => id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, level, streak")
    .in("id", topUserIds);

  return topUserIds.map((uid, i) => {
    const profile = profiles?.find(p => p.id === uid);
    return {
      rank: i + 1,
      user_id: uid,
      username: profile?.username ?? "Unknown",
      avatar_url: profile?.avatar_url ?? null,
      level: profile?.level ?? 1,
      streak: profile?.streak ?? 0,
      coins_this_week: weeklyMap[uid] ?? 0,
    };
  });
}

// ── Recent Activity ───────────────────────────────────────────

export async function getRecentActivity(userId: string, limit = 8) {
  const { data, error } = await supabase
    .from("coin_transactions")
    .select("amount, type, description, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ── Quiz History ──────────────────────────────────────────────

export async function getQuizHistory(userId: string, limit = 10) {
  const { data, error } = await supabase
    .from("quiz_sessions")
    .select("id, subject, total_questions, correct_answers, coins_earned, completed_at")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ── Badges ────────────────────────────────────────────────────

export async function getAllBadges(): Promise<{ id: string; name: string; description: string | null; icon: string; rarity: string }[]> {
  const { data, error } = await supabase
    .from("badges")
    .select("*")
    .order("rarity");
  if (error) throw error;
  return (data as unknown as { id: string; name: string; description: string | null; icon: string; rarity: string }[]) ?? [];
}

export async function getUserBadges(userId: string) {
  const { data, error } = await supabase
    .from("user_badges")
    .select("earned_at, badges(id, name, description, icon, rarity)")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(row => ({
    ...(row.badges as unknown as { id: string; name: string; description: string | null; icon: string; rarity: string }),
    earnedAt: row.earned_at,
  }));
}

export async function awardBadge(userId: string, badgeId: string) {
  const { error } = await supabase
    .from("user_badges")
    .insert({ user_id: userId, badge_id: badgeId });

  if (!error) {
    await supabase.from("coin_transactions").insert({
      user_id: userId,
      amount: 100,
      type: "badge_bonus",
      reference_id: badgeId,
      description: "Badge unlocked!",
    });
    await incrementCoins(userId, 100);
  }
}

// ── Duels ─────────────────────────────────────────────────────

export async function createDuel(duel: {
  challenger_id: string;
  opponent_id: string;
  subject: string;
  coins_wagered: number;
}): Promise<{ id: string; challenger_id: string; opponent_id: string; subject: string; status: string; coins_wagered: number }> {
  const { data, error } = await supabase
    .from("duels")
    .insert({ ...duel, status: "active" })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as { id: string; challenger_id: string; opponent_id: string; subject: string; status: string; coins_wagered: number };
}

export async function completeDuel(duelId: string, result: {
  challenger_score: number;
  opponent_score: number;
  winner_id: string | null;
  challenger_id: string;
  opponent_id: string;
  coins_wagered: number;
}) {
  await supabase
    .from("duels")
    .update({
      status: "completed",
      challenger_score: result.challenger_score,
      opponent_score: result.opponent_score,
      winner_id: result.winner_id,
      completed_at: new Date().toISOString(),
    })
    .eq("id", duelId);

  // Award coins to winner
  if (result.winner_id) {
    const prize = result.coins_wagered * 2;
    await incrementCoins(result.winner_id, prize);

    await supabase.from("coin_transactions").insert({
      user_id: result.winner_id,
      amount: prize,
      type: "duel_win",
      reference_id: duelId,
      description: "Duel victory 🏆",
    });
  }
}

export async function getUserDuels(userId: string, limit = 5) {
  const { data, error } = await supabase
    .from("duels")
    .select("*, challenger:profiles!challenger_id(username, avatar_url), opponent:profiles!opponent_id(username, avatar_url)")
    .or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

// ── Subject Stats ─────────────────────────────────────────────

export async function getSubjectStats(userId: string) {
  const { data, error } = await supabase
    .from("quiz_sessions")
    .select("subject, total_questions, correct_answers, coins_earned")
    .eq("user_id", userId);

  if (error) throw error;

  const stats: Record<string, { questionsAnswered: number; correctAnswers: number; coinsEarned: number }> = {};
  for (const row of data ?? []) {
    if (!stats[row.subject]) {
      stats[row.subject] = { questionsAnswered: 0, correctAnswers: 0, coinsEarned: 0 };
    }
    stats[row.subject].questionsAnswered += row.total_questions;
    stats[row.subject].correctAnswers += row.correct_answers;
    stats[row.subject].coinsEarned += row.coins_earned;
  }

  return Object.entries(stats).map(([subject, s]) => ({ subject, ...s }));
}

// ── Increment helper (server-side safe) ───────────────────────

export async function incrementCoins(userId: string, amount: number) {
  const { data } = await supabase
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .single();

  if (data) {
    await supabase
      .from("profiles")
      .update({ coins: data.coins + amount })
      .eq("id", userId);
  }
}

export async function incrementXP(userId: string, amount: number) {
  const { data } = await supabase
    .from("profiles")
    .select("xp")
    .eq("id", userId)
    .single();

  if (data) {
    await supabase
      .from("profiles")
      .update({ xp: data.xp + amount })
      .eq("id", userId);
  }
}
