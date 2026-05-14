/**
 * Single source of truth for SWR cache keys used by both web and iOS.
 *
 * Previously every hook constructed its key as an inline template string,
 * e.g. `user-stats/${userId}`. This worked but made cross-hook
 * invalidation brittle — to invalidate "recent quizzes" from the quiz
 * submit handler, you had to remember the literal string format.
 *
 * Centralising here means:
 *   1. Every hook references `cacheKeys.userStats(userId)` instead of
 *      a template literal — no drift between key generation and key
 *      reference.
 *   2. The `invalidate.ts` cascade map can refer to these helpers
 *      directly, so updates to a key shape only touch ONE file.
 *   3. Both web and iOS share the exact same key strings, eliminating
 *      any chance of "iOS calls user-stats/X while web calls
 *      userStats?userId=X" mismatch.
 *
 * Keys are namespaced so SWR's `mutate(matcher)` patterns can target
 * groups (e.g. `key.startsWith("user-stats/")`).
 */

export const cacheKeys = {
  // ── User profile data ──────────────────────────────────────────────
  userStats: (userId: string) => `user-stats/${userId}`,
  weeklyActivity: (userId: string) => `weekly-activity/${userId}`,
  subjectStats: (userId: string) => `subject-stats/${userId}`,
  recentQuizzes: (userId: string) => `recent-quizzes/${userId}`,
  recentNotes: () => `/api/classes/recent-notes`,
  badges: (userId: string) => `badges/${userId}`,

  // ── Daily ritual ───────────────────────────────────────────────────
  dailyDrillStatus: () => `/api/daily-drill`,
  loginBonusStatus: () => `/api/login-bonus`,
  missionsProgress: () => `/api/missions/progress`,
  bounties: (userId: string) => `["bounties",${JSON.stringify(userId)}]`,
  dailyBet: (userId: string) => `["daily-bet",${JSON.stringify(userId)}]`,
  streakReviveStatus: () => `/api/streak-revive`,
  clockInStatus: () => `/api/login-bonus`,

  // ── Spin ───────────────────────────────────────────────────────────
  spinStatus: () => `spin/status`,

  // ── Competition ────────────────────────────────────────────────────
  arenaRank: (userId: string) => `arena-rank/${userId}`,
  arenaMatches: (userId: string) => `arena-matches/${userId}`,
  leaderboard: () => `leaderboard`,

  // ── Social ─────────────────────────────────────────────────────────
  friends: () => `/api/social/friends`,
  notifications: () => `/api/notifications`,

  // ── Classes ────────────────────────────────────────────────────────
  classes: () => `/api/classes`,
  classDetail: (classId: string) => `/api/classes/${classId}`,
  classFlashcards: (classId: string) => `/api/classes/${classId}/flashcards`,
  classGrades: (classId: string) => `/api/classes/${classId}/grades`,
  classSyllabus: (classId: string) => `/api/classes/${classId}/syllabus`,

  // ── Mastery ────────────────────────────────────────────────────────
  masteryExams: () => `/api/mastery/exams`,
  masterySession: (sessionId: string) => `mastery-session/${sessionId}`,

  // ── Wallet ─────────────────────────────────────────────────────────
  wallet: (userId: string) => `wallet/${userId}`,

  // ── Study DNA ──────────────────────────────────────────────────────
  studyDna: () => `/api/study-dna`,
} as const;
