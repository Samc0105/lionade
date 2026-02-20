export type Subject =
  | "Math"
  | "Science"
  | "Languages"
  | "SAT/ACT"
  | "Coding"
  | "Finance"
  | "Certifications";

export type Difficulty = "easy" | "medium" | "hard";

export type DuelStatus = "pending" | "active" | "completed";

export type BadgeRarity = "common" | "rare" | "epic" | "legendary";

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: BadgeRarity;
  earnedAt?: string;
}

export interface SubjectStat {
  subject: Subject;
  questionsAnswered: number;
  correctAnswers: number;
  coinsEarned: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  coins: number;
  streak: number;
  maxStreak: number;
  xp: number;
  level: number;
  badges: Badge[];
  subjectStats: SubjectStat[];
  joinedAt: string;
  rank?: number;
}

export interface Question {
  id: string;
  subject: Subject;
  question: string;
  options: string[];
  correctAnswer: number;
  difficulty: Difficulty;
  coinReward: number;
  explanation?: string;
}

export interface DuelSession {
  id: string;
  challenger: User;
  opponent: User;
  challengerScore: number;
  opponentScore: number;
  currentQuestion: number;
  questions: Question[];
  status: DuelStatus;
  startedAt?: string;
  endedAt?: string;
}

export interface LeaderboardEntry {
  rank: number;
  user: User;
  coinsThisWeek: number;
  streak: number;
  change: "up" | "down" | "same";
  changeAmount?: number;
}

export interface QuizResult {
  subject: Subject;
  totalQuestions: number;
  correctAnswers: number;
  coinsEarned: number;
  xpEarned: number;
  timeSpent: number;
  streakBonus: boolean;
}
