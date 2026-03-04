"use client";

import { useEffect } from "react";

function applyPrefs() {
  const el = document.documentElement;
  el.dataset.theme = localStorage.getItem("theme") || "dark";
  el.dataset.fontSize = localStorage.getItem("fontSize") || "medium";
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyPrefs();

    const handler = (e: StorageEvent) => {
      if (["theme", "fontSize"].includes(e.key ?? "")) applyPrefs();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return <>{children}</>;
}
