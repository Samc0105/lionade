"use client";

import { AuthProvider } from "@/lib/auth";
import { useInactivityLogout } from "@/hooks/useInactivityLogout";

function InactivityGuard({ children }: { children: React.ReactNode }) {
  useInactivityLogout();
  return <>{children}</>;
}

export default function AuthProviderWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <InactivityGuard>{children}</InactivityGuard>
    </AuthProvider>
  );
}
