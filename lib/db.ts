import { supabase } from "@/lib/supabase";
import type { Subject } from "@/types";
import { DEMO_USER_ID } from "@/lib/demo-guard";

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

// P0 trust-gap fix 2026-06-05: server-enforced profile visibility.
// Reads/writes the dedicated profiles.profile_visibility column so that
// /api/social/search and the leaderboard ladders can filter cheaply.
export type ProfileVisibility = "public" | "friends" | "private";

export async function getProfileVisibility(userId: string): Promise<ProfileVisibility> {
  const { data } = await supabase
    .from("profiles")
    .select("profile_visibility")
    .eq("id", userId)
    .single();
  const v = (data?.profile_visibility as ProfileVisibility | null | undefined) ?? "public";
  return v === "private" || v === "friends" ? v : "public";
}

export async function updateProfileVisibility(userId: string, visibility: ProfileVisibility) {
  const { error } = await supabase
    .from("profiles")
    .update({ profile_visibility: visibility })
    .eq("id", userId);
  if (error) throw error;
  return visibility;
}

// ── Preferences ──────────────────────────────────────────────

export type NotificationPrefs = {
  daily_reminder: boolean;
  duel_challenges: boolean;
  weekly_report: boolean;
  badge_unlocked: boolean;
  streak_alert: boolean;
  new_features: boolean;
  marketing: boolean;
  leaderboard_updates: boolean;
  // Added 2026-06-05 to close the notification-trigger trust loop. friend_requests
  // gates social/friends + social/nudge inserts; party_invites gates the new
  // /api/party/rooms/[code]/invite-friend notification path. Stored alongside
  // the existing flags in profiles.preferences JSONB — no migration needed.
  friend_requests: boolean;
  party_invites: boolean;
  // Settings overhaul 2026-06-11: in-app/master enable per notification. The
  // settings UI groups these — Study {daily_reminder, streak_alert,
  // weekly_report}, Social {friend_requests, friend_accepted, duel_challenges,
  // nudge_received, party_invites}, Rewards {badge_unlocked, bounty_completed,
  // fangs_received}, Product {new_features, marketing}.
  friend_accepted: boolean;
  nudge_received: boolean;
  bounty_completed: boolean;
  fangs_received: boolean;
};

export type PrivacyPrefs = {
  show_on_leaderboard: boolean;
  show_streak: boolean;
  show_coins: boolean;
  duel_from: "everyone" | "nobody";
  // Settings overhaul 2026-06-11.
  online_status: boolean;
  friend_request_from: "everyone" | "nobody";
  show_activity_feed: boolean;
};

export type UserPreferences = {
  theme: "dark" | "light";
  font_size: "small" | "medium" | "large";
  preferred_subjects: string[];
  // P0 trust-gap fix 2026-06-05: notification + privacy toggles used to
  // be localStorage-only placebos. Now they persist server-side as
  // sub-blobs in profiles.preferences (JSONB). Top-level visibility
  // (public/friends/private) lives in the dedicated
  // profiles.profile_visibility column because the server filters on it.
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
  // Settings overhaul 2026-06-11. All persisted in profiles.preferences JSONB.
  // Per-item EMAIL toggle (opt-in). Only weekly_report defaults email-on.
  notifications_email: Partial<Record<keyof NotificationPrefs, boolean>>;
  // Quiet hours — suppress in-app/email delivery within a daily window.
  // Times are 24h "HH:MM" strings.
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  // ISO timestamp of the user's last data export. Gates the 24h export limit.
  // Written by the export route ONLY — never client-PATCHable.
  last_export_at: string | null;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  daily_reminder: true,
  duel_challenges: true,
  weekly_report: true,
  badge_unlocked: true,
  streak_alert: true,
  new_features: false,
  marketing: false,
  leaderboard_updates: true,
  // Sensible defaults: a user signing up wants to know when a friend tries
  // to reach them and when they're invited to a party room.
  friend_requests: true,
  party_invites: true,
  // Settings overhaul 2026-06-11.
  friend_accepted: true,
  nudge_received: true,
  bounty_completed: true,
  fangs_received: false,
};

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = {
  show_on_leaderboard: true,
  show_streak: true,
  show_coins: true,
  duel_from: "everyone",
  // Settings overhaul 2026-06-11.
  online_status: true,
  friend_request_from: "everyone",
  show_activity_feed: true,
};

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "dark",
  font_size: "medium",
  preferred_subjects: [],
  notifications: DEFAULT_NOTIFICATION_PREFS,
  privacy: DEFAULT_PRIVACY_PREFS,
  // Settings overhaul 2026-06-11. Email opt-in by default, except the two
  // digests users expect in their inbox: the weekly report and the
  // first-streak-day email (the email counterpart of the streak_alert in-app
  // card). These are the ONLY email-on-by-default keys.
  notifications_email: { weekly_report: true, streak_alert: true },
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "08:00",
  last_export_at: null,
};

export async function getPreferences(userId: string): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", userId)
    .single();
  if (error) throw error;
  const stored = (data?.preferences ?? {}) as Partial<UserPreferences>;
  // Deep-merge the notifications + privacy sub-blobs so adding a new
  // toggle in DEFAULT_NOTIFICATION_PREFS doesn't silently come back as
  // `undefined` for users who saved their prefs before the new key
  // existed.
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    notifications: { ...DEFAULT_NOTIFICATION_PREFS, ...(stored.notifications ?? {}) },
    privacy:       { ...DEFAULT_PRIVACY_PREFS,      ...(stored.privacy      ?? {}) },
    // Settings overhaul 2026-06-11: deep-merge the per-item email map so the
    // weekly_report email default survives a partial stored blob.
    notifications_email: { ...DEFAULT_PREFERENCES.notifications_email, ...(stored.notifications_email ?? {}) },
  };
}

/**
 * 12-factor-style gate at the notification-trigger boundary: returns false
 * if the recipient has opted out of this category, true otherwise. Defaults
 * to TRUE on any read failure so a transient DB hiccup never silences a
 * notification — under-notify is the wrong default; over-notify is recoverable
 * by the user clicking the per-row mark-read or toggling the pref off.
 *
 * Use at every server-side notifications.insert call site:
 *
 *   if (await shouldNotifyUser(recipientId, "duel_challenges")) {
 *     await supabaseAdmin.from("notifications").insert({ ... });
 *   }
 *
 * Trust gap closed 2026-06-05: previously, the Settings/Profile pref toggles
 * persisted (per the earlier P0 fix) but creators ignored them — flipping
 * "Duel Challenges: off" still caused incoming duels to insert a row.
 */
export async function shouldNotifyUser(
  userId: string,
  prefKey: keyof NotificationPrefs,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .single();
    const stored = (data?.preferences ?? {}) as Partial<UserPreferences>;
    const notif = { ...DEFAULT_NOTIFICATION_PREFS, ...(stored.notifications ?? {}) };
    return notif[prefKey] !== false;
  } catch {
    return true; // fail-open — see doc comment
  }
}

/**
 * EMAIL-channel counterpart of shouldNotifyUser. Reads the SEPARATE
 * preferences.notifications_email[key] map so the In-app checkbox and the
 * Email checkbox govern their channels independently (Settings overhaul
 * 2026-06-11). A user can keep the in-app weekly_report card while muting the
 * weekly email, or vice versa.
 *
 * Defaults: email is opt-IN, so an absent key returns FALSE — EXCEPT
 * weekly_report and streak_alert, which ship email-on by default
 * (DEFAULT_PREFERENCES.notifications_email seeds both :true and getPreferences
 * deep-merges them in). These are the only two email-on-by-default keys. Fails
 * CLOSED on read error for the same opt-in reason: we never want to email
 * someone who never opted in just because a read hiccuped.
 *
 * Use at every server-side email send site (Resend, etc.):
 *
 *   if (await emailEnabled(recipientId, "weekly_report")) {
 *     await resend.emails.send({ ... });
 *   }
 */
export async function emailEnabled(
  userId: string,
  prefKey: keyof NotificationPrefs,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .single();
    const stored = (data?.preferences ?? {}) as Partial<UserPreferences>;
    const emailMap = {
      ...DEFAULT_PREFERENCES.notifications_email,
      ...(stored.notifications_email ?? {}),
    };
    return emailMap[prefKey] === true;
  } catch {
    return false; // fail-closed — email is opt-in, see doc comment
  }
}

/**
 * Quiet-hours gate (Settings overhaul 2026-06-11). Returns true when the
 * current instant falls INSIDE the user's configured quiet window, in which
 * case in-app notification inserts should be suppressed.
 *
 * Times are stored as 24h "HH:MM" strings in the user's local wall-clock and
 * compared minute-of-day. Windows that wrap past midnight (e.g. 22:00 → 08:00)
 * are handled. We compute "now" in the user's IANA timezone when one is stored
 * in the preferences blob (preferences.timezone), falling back to the server
 * clock otherwise — a missing tz only shifts the window, it never silences a
 * notification outright. We deliberately read tz from the JSONB blob rather
 * than a dedicated column so this never depends on a column that may not exist.
 *
 * Fails OPEN (returns false = "not quiet") on any read/parse error so a bad
 * blob never permanently mutes a user.
 */
export async function isInQuietHours(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", userId)
      .single();
    const stored = (data?.preferences ?? {}) as Partial<UserPreferences> & { timezone?: unknown };
    const enabled = stored.quiet_hours_enabled ?? DEFAULT_PREFERENCES.quiet_hours_enabled;
    if (!enabled) return false;

    const start = parseHHMM(stored.quiet_hours_start ?? DEFAULT_PREFERENCES.quiet_hours_start);
    const end = parseHHMM(stored.quiet_hours_end ?? DEFAULT_PREFERENCES.quiet_hours_end);
    if (start === null || end === null) return false;
    if (start === end) return false; // zero-width window = never quiet

    const tz = typeof stored.timezone === "string" ? stored.timezone : null;
    const nowMin = minuteOfDayInTz(tz);
    if (nowMin === null) return false;

    // Non-wrapping window (e.g. 01:00 → 06:00): quiet iff start <= now < end.
    if (start < end) return nowMin >= start && nowMin < end;
    // Wrapping window (e.g. 22:00 → 08:00): quiet iff now >= start OR now < end.
    return nowMin >= start || nowMin < end;
  } catch {
    return false; // fail-open — never permanently mute on a bad read
  }
}

/** Parse "HH:MM" → minute-of-day (0..1439), or null if malformed. */
function parseHHMM(v: string | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Current minute-of-day in an IANA tz (or server-local if tz is null/invalid). */
function minuteOfDayInTz(tz: string | null): number | null {
  try {
    const now = new Date();
    if (tz) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const hh = Number(parts.find((p) => p.type === "hour")?.value);
      const mm = Number(parts.find((p) => p.type === "minute")?.value);
      if (Number.isFinite(hh) && Number.isFinite(mm)) {
        // Intl may emit "24" for midnight in some runtimes; normalize.
        return ((hh % 24) * 60 + mm);
      }
    }
    return now.getHours() * 60 + now.getMinutes();
  } catch {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
}

export type NotificationInsert = {
  /** Recipient. */
  userId: string;
  /** Pref key this notification belongs to — gates delivery via shouldNotifyUser. */
  prefKey: keyof NotificationPrefs;
  /** notifications.type tag (e.g. "friend_request", "arena_challenge"). */
  type: string;
  title: string;
  message?: string;
  action_url?: string;
  related_user_id?: string;
  /**
   * When true, bypass the quiet-hours suppression (NOT the per-key opt-out).
   * Reserved for genuinely time-sensitive pings; unused today. Per-key opt-out
   * is always honored.
   */
  ignoreQuietHours?: boolean;
};

/**
 * CENTRAL in-app notification creator (Settings overhaul 2026-06-11).
 *
 * Single choke point for `notifications` inserts so per-key opt-out AND quiet
 * hours are enforced in ONE place instead of being re-implemented (or
 * forgotten) at each call site. Returns true if a row was inserted, false if
 * it was suppressed by a pref / quiet hours / insert error.
 *
 * Gating order:
 *   1. Per-key opt-out  — shouldNotifyUser(userId, prefKey). Hard mute.
 *   2. Quiet hours      — isInQuietHours(userId). Soft, time-boxed suppression.
 *
 * Best-effort: the notifications table may not exist in every environment, so
 * insert failures are swallowed (logged) and never bubble into the caller's
 * response. Uses the service-role client via a lazy import so importing other
 * lib/db helpers from a client bundle never pulls in the secret key.
 */
export async function notifyUser(n: NotificationInsert): Promise<boolean> {
  try {
    if (!(await shouldNotifyUser(n.userId, n.prefKey))) return false;
    if (!n.ignoreQuietHours && (await isInQuietHours(n.userId))) return false;

    const { supabaseAdmin } = await import("@/lib/supabase-server");
    const { error } = await supabaseAdmin.from("notifications").insert({
      user_id: n.userId,
      type: n.type,
      title: n.title,
      message: n.message ?? null,
      action_url: n.action_url ?? null,
      related_user_id: n.related_user_id ?? null,
    });
    if (error) {
      console.error("[notifyUser]", error.message);
      return false;
    }
    return true;
  } catch (err) {
    // Table may not exist yet / transient — never break the calling mutation.
    console.error("[notifyUser]", err instanceof Error ? err.message : "insert failed");
    return false;
  }
}

export async function updatePreferences(userId: string, prefs: Partial<UserPreferences>) {
  const current = await getPreferences(userId);
  // Deep-merge sub-blobs so a PATCH of just one toggle in `notifications`
  // doesn't blow away every other notification flag or the entire
  // `privacy` blob.
  const merged: UserPreferences = {
    ...current,
    ...prefs,
    notifications: { ...current.notifications, ...(prefs.notifications ?? {}) },
    privacy:       { ...current.privacy,       ...(prefs.privacy      ?? {}) },
    // Settings overhaul 2026-06-11: deep-merge the per-item email map so a
    // PATCH of one email toggle doesn't blow away the rest.
    notifications_email: { ...current.notifications_email, ...(prefs.notifications_email ?? {}) },
  };
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

    // Time-based streak increment — mirrors app/api/save-quiz-results.
    // Bumping on every UTC-day-rollover incremented inside the same "day"
    // from the user's POV (midnight UTC = 8pm ET). We now require >= 20h
    // since last_activity_at before the streak can tick.
    const MIN_GAP_TO_INCREMENT_MS = 20 * 60 * 60 * 1000;
    const MAX_GAP_TO_CONTINUE_MS = 48 * 60 * 60 * 1000;

    const { data: profile } = await supabase
      .from("profiles")
      .select("streak, max_streak, last_activity_at")
      .eq("id", userId)
      .single();

    if (profile) {
      const lastActivityAt = (profile as { last_activity_at: string | null }).last_activity_at;
      let newStreak = profile.streak ?? 0;
      if (!lastActivityAt) {
        // Truly first activity ever — start at 1
        newStreak = newStreak > 0 ? newStreak : 1;
      } else {
        const gapMs = Date.now() - new Date(lastActivityAt).getTime();
        if (gapMs < MIN_GAP_TO_INCREMENT_MS) {
          // Same study window — keep current streak (avoid the new-row bump)
        } else if (gapMs <= MAX_GAP_TO_CONTINUE_MS) {
          newStreak = (profile.streak ?? 0) + 1;
        } else {
          // Long gap — reset (shield handling lives in save-quiz-results)
          newStreak = 1;
        }
      }
      const newMax = Math.max(newStreak, profile.max_streak ?? 0);
      const { error: streakErr } = await supabase
        .from("profiles")
        .update({ streak: newStreak, max_streak: newMax, last_activity_at: new Date().toISOString() })
        .eq("id", userId);
      if (streakErr) console.error("[upsertDailyActivity] Streak update error:", streakErr.message);
      else console.log("[upsertDailyActivity] Streak:", profile.streak, "->", newStreak);
    }
  }
}

// ── Leaderboard ───────────────────────────────────────────────

/**
 * Returns true when a fetched profile row has explicitly opted OUT of the
 * leaderboards via preferences.privacy.show_on_leaderboard (Settings overhaul
 * 2026-06-11). Tolerates the value being a boolean `false` or the string
 * "false". Treats absent/true as opted-in (default is on). Used to post-filter
 * ladder rows in JS, mirroring how the weekly ladder already drops non-public
 * profiles — the toggle lives in JSONB and can't be a cheap SQL predicate.
 */
function isLeaderboardOptedOut(prefsBlob: unknown): boolean {
  const prefs = (prefsBlob ?? {}) as { privacy?: { show_on_leaderboard?: unknown } };
  const v = prefs.privacy?.show_on_leaderboard;
  return v === false || v === "false";
}

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

  // Bounded server-side aggregation (was: fetch ALL weekly quiz_reward rows then
  // aggregate in Node — a sequential scan growing with platform activity). The
  // RPC returns the top users by summed quiz_reward Fangs, demo account excluded;
  // we over-fetch so the visibility / opt-out filter below still yields `limit`.
  const { data: weekly, error } = await supabase.rpc("weekly_quiz_leaderboard", {
    p_since: weekAgo.toISOString(),
    p_limit: limit * 3 + 10,
    p_exclude: DEMO_USER_ID,
  });

  if (error) throw error;

  const weeklyRows = (weekly ?? []) as { user_id: string; coins_this_week: number }[];
  const coinsByUser = new Map(weeklyRows.map((r) => [r.user_id, Number(r.coins_this_week)]));

  if (weeklyRows.length === 0) {
    // Fallback: just return top profiles by total coins
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url, level, streak, coins, preferences, equipped_username_effect, equipped_frame, equipped_name_color, equipped_avatar_aura")
      .neq("id", DEMO_USER_ID)
      // Settings overhaul 2026-06-11: only PUBLIC profiles appear on public
      // surfaces. 'friends' and 'private' are both non-public, so filter to
      // public rather than just excluding 'private'.
      .eq("profile_visibility", "public")
      .order("coins", { ascending: false })
      // Over-fetch so the JS opt-out filter below still yields up to `limit`.
      .limit(limit * 3 + 10);

    return (profiles ?? [])
      // Settings overhaul 2026-06-11: drop users who toggled "appear on
      // leaderboards" off (preferences.privacy.show_on_leaderboard).
      .filter((p: any) => !isLeaderboardOptedOut(p.preferences))
      .slice(0, limit)
      .map((p: any, i: number) => ({
        rank: i + 1,
        user_id: p.id,
        username: p.username,
        avatar_url: p.avatar_url,
        level: p.level,
        streak: p.streak,
        coins_this_week: p.coins,
      }));
  }

  // Already sorted desc + bounded by the RPC.
  const topUserIds = weeklyRows.map((r) => r.user_id);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, level, streak, equipped_username_effect, equipped_frame, equipped_name_color, equipped_avatar_aura, profile_visibility, preferences")
    .in("id", topUserIds);

  // P0 trust-gap fix 2026-06-05: drop private profiles from the weekly
  // leaderboard. We do this in JS because the weeklyMap was built off
  // coin_transactions (no visibility column on that table) — filter
  // against the fetched profile rows here.
  const out: {
    rank: number; user_id: string; username: string; avatar_url: string | null;
    level: number; streak: number; coins_this_week: number;
  }[] = [];
  let rank = 1;
  for (const uid of topUserIds) {
    if (out.length >= limit) break; // over-fetched; stop once we have `limit`
    const profile = profiles?.find((p: any) => p.id === uid);
    // Settings overhaul 2026-06-11: only PUBLIC profiles surface on the weekly
    // ladder. Anything not explicitly 'public' (friends/private) is dropped.
    if (profile && profile.profile_visibility !== "public") continue;
    // Settings overhaul 2026-06-11: also drop users who toggled "appear on
    // leaderboards" off (preferences.privacy.show_on_leaderboard).
    if (profile && isLeaderboardOptedOut(profile.preferences)) continue;
    out.push({
      rank: rank++,
      user_id: uid,
      username: profile?.username ?? "Unknown",
      avatar_url: profile?.avatar_url ?? null,
      level: profile?.level ?? 1,
      streak: profile?.streak ?? 0,
      coins_this_week: coinsByUser.get(uid) ?? 0,
    });
  }
  return out;
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
  // Exclude the shared demo account from the public ELO ladder.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, arena_elo, level, xp, preferences")
    .neq("id", DEMO_USER_ID)
    // Settings overhaul 2026-06-11: only PUBLIC profiles on the public ladder
    // (friends + private are both non-public).
    .eq("profile_visibility", "public")
    .order("arena_elo", { ascending: false })
    // Over-fetch so the JS opt-out filter below still yields up to `limit`.
    .limit(limit * 2 + 10);

  if (error) throw error;

  return (data ?? [])
    // Settings overhaul 2026-06-11: drop "appear on leaderboards" opt-outs
    // (preferences.privacy.show_on_leaderboard).
    .filter((p: any) => !isLeaderboardOptedOut(p.preferences))
    .slice(0, limit)
    .map((p: any, i: number) => ({
      rank: i + 1,
      user_id: p.id,
      username: p.username ?? "Unknown",
      avatar_url: p.avatar_url ?? null,
      arena_elo: p.arena_elo ?? 1000,
      level: p.level ?? 1,
    }));
}

// ── Multi-ladder ELO Leaderboard ─────────────────────────────
//
// Added 2026-05-28 (IA consolidation) so /leaderboard can surface all three
// ranked ladders, not just arena_elo (the Quiz Duel ladder):
//   - "arena_elo"        → Quiz Duel (the V1 1v1 duel)
//   - "competitive_elo"  → the 4 competitive modes, 1v1 (migration 20260528000000)
//   - "squad_elo"        → the 4 competitive modes, 2v2 squad
// All default to 1000. Returns a normalized `elo` field so the page renders
// any ladder identically.
export type EloLadder = "arena_elo" | "competitive_elo" | "squad_elo";

export async function getLadderLeaderboard(
  ladder: EloLadder,
  limit = 200,
): Promise<{
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  elo: number;
  level: number;
  streak: number;
  equipped_username_effect?: string | null;
  equipped_frame?: string | null;
  equipped_name_color?: string | null;
  equipped_avatar_aura?: string | null;
}[]> {
  // Exclude the shared demo account from any of the three competitive
  // ladders (arena_elo / competitive_elo / squad_elo).
  const { data, error } = await supabase
    .from("profiles")
    .select(`id, username, avatar_url, level, streak, preferences, equipped_username_effect, equipped_frame, equipped_name_color, equipped_avatar_aura, ${ladder}`)
    .neq("id", DEMO_USER_ID)
    // Settings overhaul 2026-06-11: only PUBLIC profiles on the public ladder
    // (friends + private are both non-public).
    .eq("profile_visibility", "public")
    .order(ladder, { ascending: false })
    // Over-fetch so the JS opt-out filter below still yields up to `limit`.
    .limit(limit * 2 + 10);

  if (error) throw error;

  return (data ?? [])
    // Settings overhaul 2026-06-11: drop "appear on leaderboards" opt-outs
    // (preferences.privacy.show_on_leaderboard).
    .filter((p: any) => !isLeaderboardOptedOut(p.preferences))
    .slice(0, limit)
    .map((p: any, i: number) => ({
      rank: i + 1,
      user_id: p.id,
      username: p.username ?? "Unknown",
      avatar_url: p.avatar_url ?? null,
      elo: p[ladder] ?? 1000,
      level: p.level ?? 1,
      streak: p.streak ?? 0,
      equipped_username_effect: p.equipped_username_effect ?? null,
      equipped_frame: p.equipped_frame ?? null,
      equipped_name_color: p.equipped_name_color ?? null,
      equipped_avatar_aura: p.equipped_avatar_aura ?? null,
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

// ── Subject Stats ─────────────────────────────────────────────

// Phase C (2026-05-25): client-side aggregation replaced with a Postgres
// GROUP BY via the get_subject_stats(p_user_id, p_lifetime) RPC. The old
// path SELECT'd up to 500 rows (5000 lifetime) just to SUM() in JS — that
// network payload + JS loop was ~150-300ms per Dashboard load. The RPC
// returns one row per subject in the exact JS shape (quoted camelCase
// identifiers in SQL), so cache key + callers are unchanged.
//
// Caller contract (unchanged):
//   getSubjectStats(userId)                       → trailing 90-day window
//   getSubjectStats(userId, { lifetime: true })   → all-time
//   Returns: { subject, questionsAnswered, correctAnswers, coinsEarned }[]
export async function getSubjectStats(
  userId: string,
  opts?: { lifetime?: boolean }
): Promise<
  { subject: string; questionsAnswered: number; correctAnswers: number; coinsEarned: number }[]
> {
  const lifetime = opts?.lifetime === true;
  const { data, error } = await supabase.rpc("get_subject_stats", {
    p_user_id: userId,
    p_lifetime: lifetime,
  });

  if (error) throw error;
  return (data ?? []) as {
    subject: string;
    questionsAnswered: number;
    correctAnswers: number;
    coinsEarned: number;
  }[];
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
