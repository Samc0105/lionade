"use client";

import { useEffect } from "react";

const DEFAULTS = { theme: "dark", fontSize: "medium", layout: "expanded" };

function applyPrefs() {
  const el = document.documentElement;
  el.dataset.theme = localStorage.getItem("theme") || DEFAULTS.theme;
  el.dataset.fontSize = localStorage.getItem("fontSize") || DEFAULTS.fontSize;
  el.dataset.layout = localStorage.getItem("layout") || DEFAULTS.layout;
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyPrefs();

    const handler = (e: StorageEvent) => {
      if (["theme", "fontSize", "layout"].includes(e.key ?? "")) applyPrefs();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return <>{children}</>;
}
