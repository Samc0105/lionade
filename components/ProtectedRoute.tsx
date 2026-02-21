"use client";

import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  // Safety timeout — never stay stuck on loading spinner
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setTimedOut(true), 6000);
    return () => clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    if ((!isLoading || timedOut) && !user) {
      router.replace("/login");
    }
  }, [user, isLoading, timedOut, router]);

  if (isLoading && !timedOut) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
          <p className="font-bebas text-2xl text-electric tracking-widest">LOADING...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
