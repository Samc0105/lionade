"use client";

/**
 * AnimatedUsername — Shop V2 Identity & Status Pack (2026-06-03)
 *
 * Renders a username with the user's equipped CSS effect. All effects are
 * GPU-only (background-position + transform only) and respect
 * `prefers-reduced-motion` (degrade to a static colored variant — never the
 * raw unstyled string, so paid users still see SOMETHING distinct).
 *
 * Drop-in: wrap any existing `{username}` render with
 *   <AnimatedUsername username={u} effect={resolveEffect(u)} />
 *
 * Effects (matches /packages/lionade-core shop catalog SKU ids):
 *   - rainbow       (Fang banner — animated rainbow gradient sweep)
 *   - fire          (Fang banner — orange→red flicker)
 *   - holographic   (Cash premium — rainbow + sparkle pseudo-element)
 *   - gold          (Cash premium — solid gold + sheen sweep)
 *   - glitch        (Cash premium — static color, hover RGB-split)
 *   - galaxy        (Cash premium — purple/blue/pink + starfield mask)
 *
 * `none` (default) just renders the username with the parent's color.
 * Server contract: the user's equipped effect id lives on
 * `profiles.equipped_username_effect` (new column — flag follow-up for
 * dev-database if missing).
 */

import type { CSSProperties } from "react";
import { getNameColorStyle } from "@/lib/cosmetics/cosmetic-styles";

export type UsernameEffect =
  | "none"
  | "rainbow"
  | "fire"
  | "holographic"
  | "gold"
  | "glitch"
  | "galaxy";

export interface AnimatedUsernameProps {
  username: string | null | undefined;
  effect?: UsernameEffect | null;
  /**
   * Equipped name-color cosmetic id (Shop V2). Applied ONLY when `effect` is
   * "none" — an equipped username effect always wins. Unknown ids are ignored.
   */
  nameColor?: string | null;
  size?: "sm" | "md" | "lg";
  /** Extra Tailwind / utility classes (e.g. `truncate`, `font-bebas`). */
  className?: string;
  /** Optional inline style overrides (e.g. fontSize matching a hero header). */
  style?: CSSProperties;
  /** Render as `<span>` (default) or another tag — useful for inline-in-h1. */
  as?: "span" | "p";
}

const SIZE_CLASS: Record<NonNullable<AnimatedUsernameProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
};

/**
 * Resolve any string (DB column, SWR row, profile field) into a known effect.
 * Unknown / empty strings fall back to "none" so the UI never crashes.
 */
export function resolveUsernameEffect(value: unknown): UsernameEffect {
  if (typeof value !== "string") return "none";
  switch (value) {
    case "rainbow":
    case "fire":
    case "holographic":
    case "gold":
    case "glitch":
    case "galaxy":
      return value;
    default:
      return "none";
  }
}

/**
 * Resolve a name-color value (DB column, SWR row, equipped object) into a
 * known cosmetic id, or null for unknown / empty. Pure; safe in render.
 */
export function resolveNameColor(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || value === "none") return null;
  return getNameColorStyle(value) ? value : null;
}

export default function AnimatedUsername({
  username,
  effect = "none",
  nameColor = null,
  size = "md",
  className = "",
  style,
  as = "span",
}: AnimatedUsernameProps) {
  const safeName = username ?? "Player";
  const safeEffect: UsernameEffect = effect ?? "none";
  const Tag = as;

  // `none` effect → fall back to the equipped name color (if any), else plain.
  if (safeEffect === "none") {
    const nc = resolveNameColor(nameColor);
    const ncStyle = nc ? getNameColorStyle(nc) : null;

    if (ncStyle) {
      // Gradient name colors clip a moving gradient to the text; solid colors
      // just set `color`. The animated class (when present) only animates
      // background-position / is reduced-motion safe in globals.css.
      if (ncStyle.gradient) {
        return (
          <Tag
            className={`${ncStyle.animClass ?? ""} ${SIZE_CLASS[size]} ${className}`}
            style={{
              background: ncStyle.gradient,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
              WebkitTextFillColor: "transparent",
              ...style,
            }}
            data-name-color={nc}
          >
            {safeName}
          </Tag>
        );
      }
      return (
        <Tag
          className={`${SIZE_CLASS[size]} ${className}`}
          style={{ color: ncStyle.color, ...style }}
          data-name-color={nc}
        >
          {safeName}
        </Tag>
      );
    }

    // No effect, no name color → plain span, inherits parent color.
    return (
      <Tag className={`${SIZE_CLASS[size]} ${className}`} style={style}>
        {safeName}
      </Tag>
    );
  }

  // All animated effects use one shared base class + an effect-specific class.
  // CSS lives in app/globals.css under the "Shop V2 — Animated Usernames" block.
  return (
    <Tag
      className={`au-base au-${safeEffect} ${SIZE_CLASS[size]} ${className}`}
      style={style}
      data-effect={safeEffect}
    >
      {safeName}
    </Tag>
  );
}
