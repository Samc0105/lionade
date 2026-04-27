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

// ── Preferences ──────────────────────────────────────────────

export type UserPreferences = {
  theme: "dark" | "light";
  font_size: "small" | "medium" | "large";
  preferred_subjects: string[];
};

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "dark",
  font_size: "medium",
  preferred_subjects: [],
};

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return { ...DEFAULT_PREFERENCES, ...(data?.preferences as Partial<UserPreferences> | null) };
}

export async function updatePreferences(userId: string, prefs: Partial<UserPreferences>) {
  const current = await getPreferences(userId);
  const merged = { ...current, ...prefs };
  const { error } = await supabase
    .from("profiles")
    .update({ preferences: merged })
    .eq("id", userId);
  if (error) throw error;
  return merged;
}

// ── Questions ─────────────────────────────────────────────────

// Difficulty mapping: UI uses easy/medium/hard, DB uses beginner/intermediate/advanced
const DIFFICULTY_DB_MAP: Record<string, string> = {
  easy: "beginner",
  medium: "intermediate",
  hard: "advanced",
};

/** Fetch 10 random questions WITHOUT correct_answer (anti-cheat).
 *  Merges from the static `questions` table AND approved `question_bank` entries. */
export async function getQuizQuestions(subject: Subject, difficulty: string, topic?: string): Promise<{
  id: string;
  subject: string;
  question: string;
  options: string[];
  difficulty: string;
}[]> {
  const dbDifficulty = DIFFICULTY_DB_MAP[difficulty] || difficulty;

  // 1. Fetch from static questions table
  let query = supabase
    .from("questions")
    .select("id, subject, question, options, difficulty")
    .eq("subject", subject)
    .eq("difficulty", dbDifficulty);
  if (topic) {
    const topicSlug = topic.toLowerCase().replace(/\s*&\s*/g, "-").replace(/\s+/g, "-");
    query = query.eq("topic", topicSlug);
  }
  const { data: staticData, error } = await query.limit(50);
  if (error) throw error;

  // 2. Fetch from question_bank (approved AI-generated questions)
  const normalizedSubject = subject.toLowerCase().replace(/\s+/g, "-");
  const bankDifficulty = difficulty === "easy" ? "easy" : difficulty === "hard" ? "hard" : "medium";
  const { data: bankData } = await supabase
    .from("question_bank")
    .select("id, subject, question, options, difficulty, correct_index")
    .eq("status", "approved")
    .eq("difficulty", bankDifficulty)
    .or(`subject.eq.${normalizedSubject},topic.eq.${normalizedSubject}`)
    .limit(20);

  // 3. Normalize bank questions to same shape (strip correct_index for anti-cheat)
  const bankQuestions = (bankData ?? []).map((q: any) => ({
    id: q.id,
    subject: q.subject,
    question: q.question,
    options: typeof q.options === "string" ? JSON.parse(q.options) : q.options,
    difficulty: q.difficulty,
  }));

  // 4. Merge, shuffle, take 10
  const allQuestions = [...(staticData ?? []), ...bankQuestions];
  const shuffled = allQuestions.sort(() => Math.random() - 0.5).slice(0, 10);
  return shuffled.map((q: any) => ({ ...q, options: q.options as string[] }));
}

/** Fetch correct answer + explanation for a single question (called after user answers).
 *  Checks both the static `questions` table and the `question_bank` table. */
export async function checkAnswer(questionId: string): Promise<{
  correct_answer: number;
  explanation: string | null;
}> {
  // Try static questions table first
  const { data, error } = await supabase
    .from("questions")
    .select("correct_answer, explanation")
    .eq("id", questionId)
    .maybeSingle();

  if (data) {
    return { correct_answer: Number(data.correct_answer), explanation: data.explanation };
  }

  // Fall back to question_bank
  const { data: bankQ, error: bankErr } = await supabase
    .from("question_bank")
    .select("correct_index, explanation")
    .eq("id", questionId)
    .maybeSingle();

  if (bankQ) {
    return { correct_answer: bankQ.correct_index, explanation: bankQ.explanation };
  }

  throw error ?? bankErr ?? new Error("Question not found");
}

/** Legacy: fetch questions with answers (used by existing code like getQuestions) */
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
    .select("id, subject, question, options, correct_answer, difficulty, explanation")
    .eq("subject", subject)
    .limit(10);
  if (error) throw error;
  return (data ?? []).map((q: any) => ({
    ...q,
    options: q.options as string[],
    correct_answer: Number(q.correct_answer),
    coin_reward: 10,
  }));
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
  console.log("[saveQuizSession] Inserting session:", session);
  const { data: rawSession, error } = await supabase
    .from("quiz_sessions")
    .insert(session)
    .select()
    .single();
  if (error) {
    console.error("[saveQuizSession] Insert error:", error.message);
    throw error;
  }
  const data = rawSession as unknown as { id: string; user_id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; xp_earned: number; streak_bonus: boolean; completed_at: string };
  console.log("[saveQuizSession] Session saved:", data.id);

  // Award coins and XP to profile manually
  await incrementCoins(session.user_id, session.coins_earned);
  await incrementXP(session.user_id, session.xp_earned);

  // Log coin transaction
  if (session.coins_earned > 0) {
    const { error: txnError } = await supabase.from("coin_transactions").insert({
      user_id: session.user_id,
      amount: session.coins_earned,
      type: "quiz_reward",
      reference_id: data.id,
      description: `${session.subject} quiz — ${session.correct_answers}/${session.total_questions} correct`,
    });
    if (txnError) console.error("[saveQuizSession] coin_transactions error:", txnError.message);
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
  if (error) {
    console.error("[saveUserAnswer] Error:", error.message, error.details);
    throw error;
  }
  console.log("[saveUserAnswer] Saved answer for question:", answer.question_id);
}

// ── Streak / Daily Activity ───────────────────────────────────

async function upsertDailyActivity(userId: string, coinsEarned: number, questionsAnswered: number) {
  const today = new Date().toISOString().split("T")[0];
  console.log("[upsertDailyActivity] userId:", userId, "date:", today);

  const { data: existing, error: fetchErr } = await supabase
    .from("daily_activity")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (fetchErr) {
    console.error("[upsertDailyActivity] Fetch error:", fetchErr.message);
    return;
  }

  if (existing) {
    const { error: updateErr } = await supabase
      .from("daily_activity")
      .update({
        questions_answered: existing.questions_answered + questionsAnswered,
        coins_earned: existing.coins_earned + coinsEarned,
        streak_maintained: true,
      })
      .eq("id", existing.id);
    if (updateErr) console.error("[upsertDailyActivity] Update error:", updateErr.message);
    else console.log("[upsertDailyActivity] Updated existing row");
  } else {
    const { error: insertErr } = await supabase.from("daily_activity").insert({
      user_id: userId,
      date: today,
      questions_answered: questionsAnswered,
      coins_earned: coinsEarned,
      streak_maintained: true,
    });
    if (insertErr) {
      console.error("[upsertDailyActivity] Insert error:", insertErr.message);
      return;
    }
    console.log("[upsertDailyActivity] Inserted new row");

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
      const newMax = Math.max(newStreak, profile.max_streak ?? 0);
      const { error: streakErr } = await supabase
        .from("profiles")
        .update({ streak: newStreak, max_streak: newMax })
        .eq("id", userId);
      if (streakErr) console.error("[upsertDailyActivity] Streak update error:", streakErr.message);
      else console.log("[upsertDailyActivity] Streak:", profile.streak, "→", newStreak);
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

    return (profiles ?? []).map((p: any, i: number) => ({
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
    const profile = profiles?.find((p: any) => p.id === uid);
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

// ── ELO Leaderboard (ranked by arena_elo descending) ─────────

export async function getEloLeaderboard(limit = 200): Promise<{
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  arena_elo: number;
  level: number;
}[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, arena_elo, level, xp")
    .order("arena_elo", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((p: any, i: number) => ({
    rank: i + 1,
    user_id: p.id,
    username: p.username ?? "Unknown",
    avatar_url: p.avatar_url ?? null,
    arena_elo: p.arena_elo ?? 1000,
    level: p.level ?? 1,
  }));
}

// ── Weekly Activity Chart Data ────────────────────────────────

// Single range query — was 7 sequential awaits per call (one per day bucket).
export async function getWeeklyActivityChart(userId: string): Promise<{
  day: string;        // "Mon", "Tue", etc.
  date: string;       // "Apr 14"
  questions: number;
  correct: number;
  coins: number;
  xp: number;
}[]> {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // One query for the whole 7-day window; bucket in JS below.
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const startIso = new Date(Date.UTC(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate())).toISOString();
  const endIso = new Date(Date.UTC(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)).toISOString();

  const { data: sessions } = await supabase
    .from("quiz_sessions")
    .select("completed_at, total_questions, correct_answers, coins_earned, xp_earned")
    .eq("user_id", userId)
    .gte("completed_at", startIso)
    .lt("completed_at", endIso);

  // Bucket sessions by UTC day key (YYYY-MM-DD).
  const buckets: Record<string, { questions: number; correct: number; coins: number; xp: number }> = {};
  for (const s of sessions ?? []) {
    if (!s.completed_at) continue;
    const key = new Date(s.completed_at).toISOString().slice(0, 10);
    if (!buckets[key]) buckets[key] = { questions: 0, correct: 0, coins: 0, xp: 0 };
    buckets[key].questions += s.total_questions ?? 0;
    buckets[key].correct += s.correct_answers ?? 0;
    buckets[key].coins += s.coins_earned ?? 0;
    buckets[key].xp += s.xp_earned ?? 0;
  }

  return days.map((day) => {
    const key = new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())).toISOString().slice(0, 10);
    const b = buckets[key] ?? { questions: 0, correct: 0, coins: 0, xp: 0 };
    return {
      day: dayNames[day.getDay()],
      date: `${monthNames[day.getMonth()]} ${day.getDate()}`,
      questions: b.questions,
      correct: b.correct,
      coins: b.coins,
      xp: b.xp,
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
  return (data ?? []).map((row: any) => ({
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

// Default: 90-day floor + 500-row cap (dashboard "recent stats").
// Pass { lifetime: true } from the profile page where users expect totals
// across their entire history (cap raised to 5000 to keep memory bounded).
export async function getSubjectStats(userId: string, opts?: { lifetime?: boolean }) {
  const lifetime = opts?.lifetime === true;
  let q = supabase
    .from("quiz_sessions")
    .select("subject, total_questions, correct_answers, coins_earned, completed_at")
    .eq("user_id", userId)
    // Order matters: when the limit caps the result we want the MOST RECENT
    // sessions retained, not random ones from the middle of history.
    .order("completed_at", { ascending: false })
    .limit(lifetime ? 5000 : 500);
  if (!lifetime) {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    q = q.gte("completed_at", since);
  }
  const { data, error } = await q;

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

// ── Daily Progress ───────────────────────────────────────────

export async function getDailyProgress(userId: string): Promise<{
  questions_answered: number;
  coins_earned: number;
}> {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("daily_activity")
    .select("questions_answered, coins_earned")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();
  return data ?? { questions_answered: 0, coins_earned: 0 };
}

// ── Recent Topics (for Continue section) ──────────────────────

// Single batched relational-join query for answers — was 1 + N (up to 21) round-trips.
export async function getRecentTopics(userId: string, limit = 8): Promise<{
  topic: string;
  subject: string;
  correct_answers: number;
  total_questions: number;
  completed_at: string;
}[]> {
  // Get recent sessions with their questions' topics
  const { data: sessions, error } = await supabase
    .from("quiz_sessions")
    .select("id, subject, correct_answers, total_questions, completed_at")
    .eq("user_id", userId)
    .order("completed_at", { ascending: false })
    .limit(20);

  if (error || !sessions?.length) return [];

  const sessionIds = (sessions as Array<{ id: string }>).map((s) => s.id);

  // ONE query for all answers across those sessions, with relational join to questions.
  // Order by session so the per-session "first topic seen" loop below is stable
  // (without an order, Postgres can starve later sessions when limit is hit).
  const { data: answers } = await supabase
    .from("user_answers")
    .select("session_id, questions(topic)")
    .in("session_id", sessionIds)
    .order("session_id", { ascending: true })
    .limit(sessionIds.length * 5); // 5 answers per session is enough to surface one topic

  // Map session_id -> first non-null topic seen.
  const sessionTopic = new Map<string, string>();
  for (const a of answers ?? []) {
    const sid = (a as { session_id: string }).session_id;
    if (sessionTopic.has(sid)) continue;
    const topic = ((a as { questions: { topic: string } | null }).questions)?.topic ?? null;
    if (topic) sessionTopic.set(sid, topic);
  }

  const results: { topic: string; subject: string; correct_answers: number; total_questions: number; completed_at: string }[] = [];
  const seenTopics = new Set<string>();

  for (const session of sessions) {
    if (results.length >= limit) break;

    const topic = sessionTopic.get(session.id) ?? null;

    // Skip sessions with no topic — don't fall back to generic subject
    if (!topic) continue;

    // Capitalize first letter
    const label = topic.charAt(0).toUpperCase() + topic.slice(1);

    if (seenTopics.has(label)) continue;
    seenTopics.add(label);

    results.push({
      topic: label,
      subject: session.subject,
      correct_answers: session.correct_answers,
      total_questions: session.total_questions,
      completed_at: session.completed_at,
    });
  }

  return results;
}

// ── Achievements ──────────────────────────────────────────────

export async function getUserAchievements(userId: string): Promise<{ achievement_key: string; unlocked_at: string }[]> {
  const { data, error } = await supabase
    .from("achievements")
    .select("achievement_key, unlocked_at")
    .eq("user_id", userId)
    .order("unlocked_at", { ascending: false });

  if (error) {
    console.warn("[getUserAchievements] Error:", error.message);
    return [];
  }
  return data ?? [];
}

// ── Best Scores Per Subject ───────────────────────────────────

// 90-day window + 500-row cap — dashboard scoreboard, not a lifetime hall-of-fame, so trailing 90d is the right slice.
export async function getBestScores(userId: string): Promise<Record<string, { best: number; total: number }>> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("quiz_sessions")
    .select("subject, correct_answers, total_questions, completed_at")
    .eq("user_id", userId)
    .gte("completed_at", since)
    // Order so cap trims oldest first if the window is unusually busy.
    .order("completed_at", { ascending: false })
    .limit(500);

  if (error) {
    console.warn("[getBestScores] Error:", error.message);
    return {};
  }

  const best: Record<string, { best: number; total: number }> = {};
  for (const row of data ?? []) {
    if (!best[row.subject] || row.correct_answers > best[row.subject].best) {
      best[row.subject] = { best: row.correct_answers, total: row.total_questions };
    }
  }
  return best;
}

// ── Bounties ──────────────────────────────────────────────────

export interface Bounty {
  id: string;
  title: string;
  description: string;
  type: "daily" | "weekly";
  requirement_type: string;
  requirement_value: number;
  requirement_subject: string | null;
  requirement_difficulty: string | null;
  coin_reward: number;
  xp_reward: number;
}

export interface UserBounty {
  bounty_id: string;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export async function getActiveBounties(): Promise<Bounty[]> {
  const { data, error } = await supabase
    .from("bounties")
    .select("id, title, description, type, requirement_type, requirement_value, requirement_subject, requirement_difficulty, coin_reward, xp_reward")
    .eq("active", true);
  if (error) { console.warn("[getActiveBounties]", error.message); return []; }
  return (data ?? []) as Bounty[];
}

export async function getUserBountyProgress(userId: string): Promise<UserBounty[]> {
  const { data, error } = await supabase
    .from("user_bounties")
    .select("bounty_id, progress, completed, claimed")
    .eq("user_id", userId);
  if (error) { console.warn("[getUserBountyProgress]", error.message); return []; }
  return (data ?? []) as UserBounty[];
}

// ── Daily Bets ────────────────────────────────────────────────

export interface ActiveBet {
  id: string;
  coins_staked: number;
  target_score: number;
  target_total: number;
  subject: string | null;
  won: boolean | null;
  coins_won: number;
  resolved_at: string | null;
}

export async function getActiveBet(userId: string): Promise<ActiveBet | null> {
  const { data, error } = await supabase
    .from("daily_bets")
    .select("id, coins_staked, target_score, target_total, subject, won, coins_won, resolved_at")
    .eq("user_id", userId)
    .is("resolved_at", null)
    .order("placed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.warn("[getActiveBet]", error.message); return null; }
  return data as ActiveBet | null;
}

export async function getLastResolvedBet(userId: string): Promise<ActiveBet | null> {
  const { data, error } = await supabase
    .from("daily_bets")
    .select("id, coins_staked, target_score, target_total, subject, won, coins_won, resolved_at")
    .eq("user_id", userId)
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data as ActiveBet | null;
}

// ── Increment helper (server-side safe) ───────────────────────

export async function incrementCoins(userId: string, amount: number) {
  const { data, error: fetchErr } = await supabase
    .from("profiles")
    .select("coins")
    .eq("id", userId)
    .single();

  if (fetchErr) {
    console.error("[incrementCoins] Fetch error:", fetchErr.message);
    return;
  }

  if (data) {
    const newCoins = (data.coins ?? 0) + amount;
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ coins: newCoins })
      .eq("id", userId);
    if (updateErr) console.error("[incrementCoins] Update error:", updateErr.message);
    else console.log("[incrementCoins]", data.coins, "→", newCoins);
  }
}

// ── Learning Paths ───────────────────────────────────────────

export interface LearningPathStage {
  id: string;
  subject: string;
  stage_number: number;
  stage_name: string;
  stage_description: string;
  lesson_text: string | null;
  total_stages: number;
}

export interface UserStageProgress {
  id: string;
  user_id: string;
  stage_id: string;
  stars: number;
  completed: boolean;
  best_score: number;
  total_questions: number;
  attempts: number;
  completed_at: string | null;
}

export async function getLearningPaths(subject: string): Promise<LearningPathStage[]> {
  const { data, error } = await supabase
    .from("learning_paths")
    .select("id, subject, stage_number, stage_name, stage_description, lesson_text, total_stages")
    .eq("subject", subject)
    .order("stage_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LearningPathStage[];
}

export async function getAllSubjectPaths(): Promise<{ subject: string; total_stages: number }[]> {
  const { data, error } = await supabase
    .from("learning_paths")
    .select("subject, total_stages")
    .order("subject");
  if (error) throw error;
  // Deduplicate by subject
  const seen = new Map<string, number>();
  for (const row of data ?? []) {
    if (!seen.has(row.subject)) seen.set(row.subject, row.total_stages);
  }
  return Array.from(seen.entries()).map(([subject, total_stages]) => ({ subject, total_stages }));
}

export async function getUserStageProgress(userId: string, subject?: string): Promise<(UserStageProgress & { stage: LearningPathStage })[]> {
  let query = supabase
    .from("user_stage_progress")
    .select("*, stage:learning_paths!stage_id(id, subject, stage_number, stage_name, stage_description, lesson_text, total_stages)")
    .eq("user_id", userId);

  if (subject) {
    // Filter by joining through the stage's subject
    const { data: stageIds } = await supabase
      .from("learning_paths")
      .select("id")
      .eq("subject", subject);
    if (stageIds && stageIds.length > 0) {
      query = query.in("stage_id", stageIds.map((s: any) => s.id));
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    stage: row.stage as unknown as LearningPathStage,
  }));
}

export async function saveStageProgress(
  userId: string,
  stageId: string,
  score: number,
  totalQuestions: number
): Promise<{ stars: number; isNewBest: boolean }> {
  const pct = totalQuestions > 0 ? score / totalQuestions : 0;
  const stars = pct >= 0.9 ? 3 : pct >= 0.7 ? 2 : pct >= 0.5 ? 1 : 0;

  // Check existing progress
  const { data: existing } = await supabase
    .from("user_stage_progress")
    .select("id, best_score, stars, attempts, completed_at")
    .eq("user_id", userId)
    .eq("stage_id", stageId)
    .maybeSingle();

  if (existing) {
    const isNewBest = score > existing.best_score;
    const newStars = Math.max(stars, existing.stars);
    await supabase
      .from("user_stage_progress")
      .update({
        stars: newStars,
        completed: stars > 0 || existing.best_score > 0,
        best_score: isNewBest ? score : existing.best_score,
        total_questions: totalQuestions,
        attempts: existing.attempts + 1,
        completed_at: stars > 0 ? new Date().toISOString() : existing.completed_at,
      })
      .eq("id", existing.id);
    return { stars: newStars, isNewBest };
  } else {
    await supabase.from("user_stage_progress").insert({
      user_id: userId,
      stage_id: stageId,
      stars,
      completed: stars > 0,
      best_score: score,
      total_questions: totalQuestions,
      attempts: 1,
      completed_at: stars > 0 ? new Date().toISOString() : null,
    });
    return { stars, isNewBest: true };
  }
}

export async function incrementXP(userId: string, amount: number) {
  const { data, error: fetchErr } = await supabase
    .from("profiles")
    .select("xp")
    .eq("id", userId)
    .single();

  if (fetchErr) {
    console.error("[incrementXP] Fetch error:", fetchErr.message);
    return;
  }

  if (data) {
    const newXp = (data.xp ?? 0) + amount;
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ xp: newXp })
      .eq("id", userId);
    if (updateErr) console.error("[incrementXP] Update error:", updateErr.message);
    else console.log("[incrementXP]", data.xp, "→", newXp);
  }
}
