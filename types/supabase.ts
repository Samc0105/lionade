export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          coins: number;
          streak: number;
          max_streak: number;
          xp: number;
          level: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          coins?: number;
          streak?: number;
          max_streak?: number;
          xp?: number;
          level?: number;
        };
        Update: {
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          coins?: number;
          streak?: number;
          max_streak?: number;
          xp?: number;
          level?: number;
        };
        Relationships: [];
      };
      questions: {
        Row: {
          id: string;
          subject: string;
          question: string;
          options: Json;
          correct_answer: number;
          difficulty: string;
          coin_reward: number;
          explanation: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          subject: string;
          question: string;
          options: Json;
          correct_answer: number;
          difficulty: string;
          coin_reward: number;
          explanation?: string | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          subject?: string;
          question?: string;
          options?: Json;
          correct_answer?: number;
          difficulty?: string;
          coin_reward?: number;
          explanation?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      quiz_sessions: {
        Row: {
          id: string;
          user_id: string;
          subject: string;
          total_questions: number;
          correct_answers: number;
          coins_earned: number;
          xp_earned: number;
          streak_bonus: boolean;
          completed_at: string;
        };
        Insert: {
          user_id: string;
          subject: string;
          total_questions: number;
          correct_answers: number;
          coins_earned: number;
          xp_earned: number;
          streak_bonus?: boolean;
        };
        Update: {
          user_id?: string;
          subject?: string;
          total_questions?: number;
          correct_answers?: number;
          coins_earned?: number;
          xp_earned?: number;
          streak_bonus?: boolean;
          completed_at?: string;
        };
        Relationships: [];
      };
      user_answers: {
        Row: {
          id: string;
          session_id: string;
          question_id: string;
          selected_answer: number | null;
          is_correct: boolean;
          time_left: number;
          answered_at: string;
        };
        Insert: {
          session_id: string;
          question_id: string;
          selected_answer: number | null;
          is_correct: boolean;
          time_left: number;
        };
        Update: {
          session_id?: string;
          question_id?: string;
          selected_answer?: number | null;
          is_correct?: boolean;
          time_left?: number;
        };
        Relationships: [];
      };
      daily_activity: {
        Row: {
          id: string;
          user_id: string;
          date: string;
          questions_answered: number;
          coins_earned: number;
          streak_maintained: boolean;
        };
        Insert: {
          user_id: string;
          date: string;
          questions_answered: number;
          coins_earned: number;
          streak_maintained?: boolean;
        };
        Update: {
          user_id?: string;
          date?: string;
          questions_answered?: number;
          coins_earned?: number;
          streak_maintained?: boolean;
        };
        Relationships: [];
      };
      duels: {
        Row: {
          id: string;
          challenger_id: string;
          opponent_id: string;
          subject: string;
          status: string;
          challenger_score: number;
          opponent_score: number;
          winner_id: string | null;
          coins_wagered: number;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          challenger_id: string;
          opponent_id: string;
          subject: string;
          status?: string;
          challenger_score?: number;
          opponent_score?: number;
          winner_id?: string | null;
          coins_wagered: number;
          completed_at?: string | null;
        };
        Update: {
          challenger_id?: string;
          opponent_id?: string;
          subject?: string;
          status?: string;
          challenger_score?: number;
          opponent_score?: number;
          winner_id?: string | null;
          coins_wagered?: number;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      badges: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          icon: string;
          rarity: string;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          description?: string | null;
          icon: string;
          rarity: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          icon?: string;
          rarity?: string;
        };
        Relationships: [];
      };
      user_badges: {
        Row: {
          id: string;
          user_id: string;
          badge_id: string;
          earned_at: string;
        };
        Insert: {
          user_id: string;
          badge_id: string;
          earned_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      coin_transactions: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          type: string;
          reference_id: string | null;
          description: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          amount: number;
          type: string;
          reference_id?: string | null;
          description?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
