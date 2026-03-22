"use client";

import { useEffect } from "react";

/** Apply theme + font-size from localStorage to the DOM */
function applyTheme() {
  const el = document.documentElement;
  const theme = localStorage.getItem("theme") || "dark";
  el.dataset.theme = theme;
  el.dataset.fontSize = localStorage.getItem("fontSize") || "medium";
  el.classList.toggle("light", theme === "light");
}

/** Handle theme change — called from same-tab event or cross-tab storage */
function onThemeChange() {
  applyTheme();
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme();

    // Listen for same-tab theme changes (dispatched by profile page)
    const handleThemeChange = () => onThemeChange();
    window.addEventListener("themechange", handleThemeChange);

    // Listen for cross-tab theme changes
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "theme" || e.key === "fontSize") onThemeChange();
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("themechange", handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return <>{children}</>;
}
