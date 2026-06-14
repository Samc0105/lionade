"use client";

/**
 * /settings/appearance — the Appearance section of the route-based settings
 * overhaul. This is the discoverable home for Personalization: THEME (Dark /
 * Light) and FONT SIZE, plus a pointer to /profile for cosmetics + identity.
 *
 * It renders inside the settings layout (ProtectedRoute + Navbar +
 * SpaceBackground + nav rail already supplied), so it's just a stack of
 * SettingsCards.
 *
 * THEME + FONT SIZE ride the EXACT same pipeline the profile page's
 * PersonalizationSection uses, so both surfaces stay in lockstep:
 *   1. write localStorage ("theme" / "fontSize")
 *   2. mutate the <html> element directly: dataset.theme, dataset.fontSize,
 *      and toggle the `light` class (CSS html.light overrides live in
 *      globals.css; the data-font-size scale lives there too).
 *   3. dispatch the "themechange" Event the ThemeProvider listens for (so any
 *      other mounted listener re-syncs), AND
 *   4. persist server-side via updatePreferences (profiles.preferences JSONB).
 *
 * Load order mirrors profile: localStorage first (instant, no flash), then
 * getPreferences as the source of truth.
 *
 * Motion is GPU-only and collapses under prefers-reduced-motion via
 * globals.css. No em-dashes in user-facing copy.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Moon,
  Sun,
  TextAa,
  IdentificationCard,
  CaretRight,
} from "@phosphor-icons/react";
import { SettingsCard, useSavedConfirm, SavedTick } from "@/components/settings/shared";
import { useAuth } from "@/lib/auth";
import { getPreferences, updatePreferences } from "@/lib/db";
import type { UserPreferences } from "@/lib/db";

type Theme = "dark" | "light";
type FontSize = "small" | "medium" | "large";

// Apply a {theme, font_size} delta to the live DOM + localStorage, then fire
// the same "themechange" event the ThemeProvider + bootstrap script speak. This
// is the single source of the side effects so the theme + font-size cards never
// drift from each other (or from the profile page).
function applyToDom(theme: Theme, fontSize: FontSize) {
  if (typeof window === "undefined") return;
  localStorage.setItem("theme", theme);
  localStorage.setItem("fontSize", fontSize);
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.fontSize = fontSize;
  el.classList.toggle("light", theme === "light");
  window.dispatchEvent(new Event("themechange"));
}

// ── Theme card (Dark / Light) ───────────────────────────────────────────────
const THEME_OPTIONS: {
  id: Theme;
  label: string;
  description: string;
  Icon: typeof Moon;
  swatch: string;
}[] = [
  {
    id: "dark",
    label: "Dark",
    description: "Interstellar navy. The default Lionade look.",
    Icon: Moon,
    // navy gradient
    swatch: "linear-gradient(135deg, #0D1528, #04080F)",
  },
  {
    id: "light",
    label: "Light",
    description: "Bright daylight for low-light-sensitive eyes.",
    Icon: Sun,
    swatch: "linear-gradient(135deg, #FFFFFF, #F1ECDF)",
  },
];

function ThemeCard() {
  const { user } = useAuth();
  const { saved, flash } = useSavedConfirm();
  const [theme, setTheme] = useState<Theme>("dark");
  const [fontSize, setFontSize] = useState<FontSize>("medium");

  // localStorage first (instant), then server (source of truth).
  useEffect(() => {
    const lsTheme = (localStorage.getItem("theme") as Theme) || "dark";
    const lsFs = (localStorage.getItem("fontSize") as FontSize) || "medium";
    setTheme(lsTheme);
    setFontSize(lsFs);

    if (user?.id) {
      getPreferences(user.id)
        .then((p) => {
          setTheme(p.theme);
          setFontSize(p.font_size);
          // Reconcile the DOM with the authoritative server value.
          applyToDom(p.theme, p.font_size);
        })
        .catch(() => {});
    }
  }, [user?.id]);

  const save = useCallback(
    (updates: Partial<Pick<UserPreferences, "theme" | "font_size">>) => {
      const nextTheme = updates.theme ?? theme;
      const nextFs = updates.font_size ?? fontSize;
      if (updates.theme !== undefined) setTheme(updates.theme);
      if (updates.font_size !== undefined) setFontSize(updates.font_size);

      applyToDom(nextTheme, nextFs);

      if (user?.id) {
        updatePreferences(user.id, updates)
          .then(() => flash())
          .catch(() => {});
      } else {
        flash();
      }
    },
    [theme, fontSize, user?.id, flash],
  );

  return (
    <>
      <SettingsCard eyebrow="Personalization" title="Theme">
        <div className="flex items-center justify-between mb-3">
          <p className="text-cream/45 text-xs leading-snug">
            Pick how Lionade looks. Applies instantly across the whole app.
          </p>
          <SavedTick show={saved} />
        </div>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => save({ theme: opt.id })}
                className={`flex items-center gap-3 text-left p-3.5 rounded-xl border transition-colors transform-gpu focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 ${
                  active
                    ? "border-electric bg-electric/15"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center border border-white/15"
                  style={{ background: opt.swatch }}
                >
                  <opt.Icon
                    size={20}
                    weight={active ? "fill" : "regular"}
                    className={opt.id === "light" ? "text-navy/70" : "text-cream"}
                  />
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-bold leading-tight ${
                      active ? "text-electric" : "text-cream"
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span className="block text-cream/45 text-xs mt-0.5 leading-snug">
                    {opt.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard eyebrow="Readability" title="Font size">
        <div className="flex items-center justify-between mb-3">
          <p className="text-cream/45 text-xs leading-snug">
            Scale every text size up or down to taste.
          </p>
          <SavedTick show={saved} />
        </div>
        <div role="radiogroup" aria-label="Font size" className="flex gap-3">
          {(
            [
              { id: "small" as const, label: "Small", size: "text-sm" },
              { id: "medium" as const, label: "Medium", size: "text-base" },
              { id: "large" as const, label: "Large", size: "text-lg" },
            ]
          ).map((f) => {
            const active = fontSize === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => save({ font_size: f.id })}
                className={`flex-1 py-3 rounded-xl border font-bold transition-colors transform-gpu focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 ${
                  active
                    ? "border-electric bg-electric/20 text-electric"
                    : "border-white/10 text-cream/50 hover:border-white/20"
                }`}
              >
                <span className={f.size} aria-hidden="true">
                  <TextAa size={20} weight={active ? "fill" : "regular"} className="inline" />
                </span>
                <span className="block text-xs mt-1 font-normal normal-case">
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>
    </>
  );
}

// ── Pointer to profile for cosmetics + identity ─────────────────────────────
// Cosmetics (locker / equipped looks) and identity (avatar, banner, subjects)
// stay on /profile. This card just makes them discoverable from Appearance.
function ProfileLinkCard() {
  return (
    <SettingsCard eyebrow="More looks" title="Cosmetics and identity">
      <Link
        href="/profile"
        className="group flex items-center gap-3.5 p-3.5 rounded-xl border border-white/10 bg-white/[0.03] hover:border-electric/30 hover:bg-electric/[0.06] transition-colors transform-gpu"
      >
        <span
          aria-hidden="true"
          className="w-11 h-11 rounded-lg shrink-0 flex items-center justify-center bg-electric/15 border border-electric/25"
        >
          <IdentificationCard size={20} weight="regular" className="text-electric" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-cream text-sm font-bold leading-tight">
            Manage your cosmetics and identity
          </span>
          <span className="block text-cream/45 text-xs mt-0.5 leading-snug">
            Equip owned looks, set your avatar, and pick preferred subjects on your profile.
          </span>
        </span>
        <CaretRight
          size={18}
          weight="bold"
          aria-hidden="true"
          className="text-cream/40 shrink-0 group-hover:text-electric transition-colors"
        />
      </Link>
    </SettingsCard>
  );
}

export default function AppearanceSettingsPage() {
  return (
    <div>
      <ThemeCard />
      <ProfileLinkCard />
    </div>
  );
}
