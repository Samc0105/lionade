"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  coins: number;
  streak: number;
  xp: number;
  level: number;
}

export interface SignupExtra {
  firstName?: string;
  dateOfBirth?: string;
  educationLevel?: string;
  studyGoal?: string;
  referralSource?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  signup: (email: string, username: string, password: string, extra?: SignupExtra) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildAuthUser(profile: {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  coins: number;
  streak: number;
  xp: number;
  level: number;
}, email: string): AuthUser {
  return {
    id: profile.id,
    email,
    username: profile.username,
    displayName: profile.display_name ?? profile.username,
    avatar: profile.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.username}&backgroundColor=4A90D9`,
    coins: profile.coins,
    streak: profile.streak,
    xp: profile.xp,
    level: profile.level,
  };
}

// Build a minimal user from auth session alone — no DB required
function buildBasicUser(userId: string, email: string, metadata: Record<string, unknown>): AuthUser {
  const username = (metadata?.username as string | undefined)
    ?? email.split("@")[0].replace(/[^a-z0-9_]/g, "_").toLowerCase().slice(0, 20);
  return {
    id: userId,
    email,
    username,
    displayName: (metadata?.display_name as string | undefined) ?? username,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}&backgroundColor=4A90D9`,
    coins: 0,
    streak: 0,
    xp: 0,
    level: 1,
  };
}

// Upsert profile in DB — races against 5s timeout so it never blocks login
async function syncProfile(userId: string, email: string, metadata: Record<string, unknown>): Promise<AuthUser | null> {
  const username = (metadata?.username as string | undefined)
    ?? email.split("@")[0].replace(/[^a-z0-9_]/g, "_").toLowerCase().slice(0, 20);

  console.log("[Auth] syncProfile: upserting for", userId, username);

  const upsertPromise = supabase
    .from("profiles")
    .upsert(
      { id: userId, username, display_name: username },
      { onConflict: "id", ignoreDuplicates: false }
    )
    .select("id, username, display_name, avatar_url, coins, streak, xp, level")
    .single();

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => {
      console.warn("[Auth] syncProfile: timed out after 5s");
      resolve(null);
    }, 5000)
  );

  try {
    const result = await Promise.race([upsertPromise, timeoutPromise]);
    if (result?.data) {
      console.log("[Auth] syncProfile: got DB profile", result.data.username, result.data.coins);
      return buildAuthUser(result.data, email);
    }
    if (result?.error) {
      console.warn("[Auth] syncProfile: upsert error", result.error.message);
    }
  } catch (err) {
    console.warn("[Auth] syncProfile: exception", err);
  }

  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    const { data: { session: sess } } = await supabase.auth.getSession();
    if (!sess?.user) return;
    const profile = await syncProfile(
      sess.user.id,
      sess.user.email ?? "",
      sess.user.user_metadata ?? {}
    );
    if (profile) setUser(profile);
  };

  useEffect(() => {
    console.log("[Auth] Setting up onAuthStateChange listener");

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        console.log("[Auth] onAuthStateChange event:", event, "user:", sess?.user?.id ?? "none");

        setSession(sess);

        if (!sess?.user) {
          console.log("[Auth] No session — showing login");
          setUser(null);
          setIsLoading(false);
          return;
        }

        // Set a basic user IMMEDIATELY from session metadata — no DB call
        // This unblocks the login redirect right away
        const basicUser = buildBasicUser(
          sess.user.id,
          sess.user.email ?? "",
          sess.user.user_metadata ?? {}
        );
        console.log("[Auth] Setting basic user immediately:", basicUser.username);
        setUser(basicUser);
        setIsLoading(false);

        // Sync full profile with DB in background (non-blocking)
        syncProfile(sess.user.id, sess.user.email ?? "", sess.user.user_metadata ?? {})
          .then((profile) => {
            if (profile) {
              console.log("[Auth] Updated user from DB profile:", profile.coins, "coins");
              setUser(profile);
            }
          });
      }
    );

    return () => {
      console.log("[Auth] Cleaning up subscription");
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<{ error?: string }> => {
    console.log("[Auth] login() called for", email);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    console.log("[Auth] signInWithPassword result — error:", error?.message ?? "none", "user:", data?.user?.id ?? "none");
    if (error) return { error: error.message };
    return {};
  };

  const signup = async (
    email: string,
    username: string,
    password: string,
    extra?: SignupExtra
  ): Promise<{ error?: string }> => {
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", username.trim())
      .maybeSingle();

    if (existing) return { error: "Username already taken. Try another." };

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username.trim(),
          display_name: extra?.firstName ?? username.trim(),
          first_name: extra?.firstName ?? "",
          date_of_birth: extra?.dateOfBirth ?? null,
          education_level: extra?.educationLevel ?? "",
          study_goal: extra?.studyGoal ?? "",
          referral_source: extra?.referralSource ?? "",
        },
      },
    });

    if (error) return { error: error.message };

    // Eagerly write extra fields to profiles table (best-effort, non-blocking)
    if (data.user) {
      supabase.from("profiles").upsert({
        id: data.user.id,
        username: username.trim(),
        display_name: extra?.firstName ?? username.trim(),
        first_name: extra?.firstName ?? null,
        date_of_birth: extra?.dateOfBirth ?? null,
        education_level: extra?.educationLevel ?? null,
        study_goal: extra?.studyGoal ?? null,
        referral_source: extra?.referralSource ?? null,
      }, { onConflict: "id" }).then(({ error: e }) => {
        if (e) console.warn("[Auth] signup profile upsert:", e.message);
      });
    }

    return {};
  };

  const logout = async () => {
    console.log("[Auth] logout()");
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
