"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * ClaimBanner — one reusable, Lionade-themed dismissible claim/upgrade
 * banner. Pure presentational shell: NO data fetching, NO claim logic.
 * Every surface that uses it keeps its own hooks/handlers and just feeds
 * this component text + an action + (optionally) an onDismiss.
 *
 * Variants map to the existing claim surfaces so the swap is visually
 * faithful:
 *   - gold     → daily Fangs (DailyReadyNudge, ClockIn "ready" block)
 *   - ember    → streak revive (StreakReviveBanner)
 *   - electric → daily drill (DailyDrillWidget "ready" card)
 *   - purple   → Pro upgrade nudge
 *
 * Hydration-safe: renders the SAME element tree on server and first
 * client paint (motion.div is a plain <div> on the server). framer-motion
 * `initial`/`animate` are style VALUES applied post-mount, not tree
 * changes. No Math.random / Date / window / document at render.
 * `prefers-reduced-motion` is honored (motion collapses to opacity only,
 * hover/tap micro-anims disabled).
 */

export type ClaimBannerVariant = "gold" | "ember" | "electric" | "purple";
export type ClaimBannerSize = "pill" | "panel";

interface ClaimAction {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

interface ClaimBannerProps {
  variant?: ClaimBannerVariant;
  size?: ClaimBannerSize;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned tag, e.g. "+50F". Hidden on the smallest widths. */
  meta?: ReactNode;
  primaryAction?: ClaimAction;
  secondaryAction?: Omit<ClaimAction, "href" | "loading">;
  /** When provided, a dismiss X is shown and wired to this handler. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Slot rendered under the description (countdowns, dual buttons…). */
  children?: ReactNode;
  className?: string;
  role?: "status" | "region";
  ariaLabel?: string;
}

const VARIANT: Record<
  ClaimBannerVariant,
  { accent: string; border: string; bg: string; glow: string; iconBg: string }
> = {
  gold: {
    accent: "#FFD700",
    border: "border-gold/35",
    bg: "bg-gradient-to-r from-gold/[0.08] via-gold/[0.04] to-transparent",
    glow: "0 0 20px rgba(255,215,0,0.10)",
    iconBg: "bg-gold/[0.15]",
  },
  ember: {
    accent: "#EF4444",
    border: "border-[#EF4444]/35",
    bg: "bg-gradient-to-br from-[#EF4444]/[0.10] to-[#A855F7]/[0.08]",
    glow: "0 0 22px rgba(239,68,68,0.10)",
    iconBg: "bg-[#EF4444]/[0.18]",
  },
  electric: {
    accent: "#4A90D9",
    border: "border-electric/30",
    bg: "bg-gradient-to-r from-electric/[0.07] to-transparent",
    glow: "0 0 20px rgba(74,144,217,0.10)",
    iconBg: "bg-electric/[0.18]",
  },
  purple: {
    accent: "#7C3AED",
    border: "border-[#7C3AED]/35",
    bg: "bg-gradient-to-r from-[#7C3AED]/[0.10] via-[#4A90D9]/[0.05] to-transparent",
    glow: "0 0 22px rgba(124,58,237,0.12)",
    iconBg: "bg-[#7C3AED]/[0.18]",
  },
};

export default function ClaimBanner({
  variant = "gold",
  size = "pill",
  icon,
  eyebrow,
  title,
  description,
  meta,
  primaryAction,
  secondaryAction,
  onDismiss,
  dismissLabel = "Dismiss",
  children,
  className,
  role = "status",
  ariaLabel,
}: ClaimBannerProps) {
  const reduce = useReducedMotion();
  const v = VARIANT[variant];
  const isPanel = size === "panel";

  // Motion = VALUES only (opacity/translate). Same DOM node on SSR and
  // first client render → no hydration mismatch. Reduced motion → fade.
  const initial = reduce ? { opacity: 0 } : { opacity: 0, y: 8 };
  const animate = { opacity: 1, y: 0 };
  const hover = reduce ? undefined : { y: -1 };

  const primaryCls = cn(
    "group inline-flex items-center justify-center gap-1.5 rounded-full font-syne font-semibold",
    "transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60",
    isPanel ? "px-4 py-2.5 text-[14px]" : "px-3.5 py-1.5 text-[13px]",
  );

  const Primary = primaryAction
    ? (() => {
        const inner = (
          <span className="inline-flex items-center gap-1.5">
            {primaryAction.loading ? "…" : primaryAction.label}
          </span>
        );
        const styleProps = {
          backgroundColor: v.accent,
          color: variant === "gold" ? "#04080F" : "#04080F",
        };
        if (primaryAction.href && !primaryAction.disabled) {
          return (
            <motion.a
              href={primaryAction.href}
              whileHover={reduce ? undefined : { scale: 1.02 }}
              whileTap={reduce ? undefined : { scale: 0.98 }}
              className={primaryCls}
              style={styleProps}
            >
              {inner}
            </motion.a>
          );
        }
        return (
          <motion.button
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled || primaryAction.loading}
            whileHover={reduce || primaryAction.disabled ? undefined : { scale: 1.02 }}
            whileTap={reduce || primaryAction.disabled ? undefined : { scale: 0.98 }}
            className={primaryCls}
            style={styleProps}
          >
            {inner}
          </motion.button>
        );
      })()
    : null;

  return (
    <motion.div
      initial={initial}
      animate={animate}
      whileHover={hover}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      role={role}
      aria-label={ariaLabel}
      className={cn(
        "relative flex items-center gap-3 border backdrop-blur",
        v.border,
        v.bg,
        isPanel ? "rounded-[14px] px-5 py-4 sm:px-6" : "rounded-full px-4 py-2.5",
        className,
      )}
      style={{ boxShadow: v.glow }}
    >
      {icon != null && (
        <span
          className={cn(
            "shrink-0 grid place-items-center rounded-full",
            v.iconBg,
            isPanel ? "w-11 h-11 sm:w-12 sm:h-12" : "w-7 h-7",
          )}
          style={{ color: v.accent }}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}

      <div className="flex-1 min-w-0">
        {eyebrow != null && (
          <p
            className={cn(
              "font-mono uppercase tracking-[0.26em] mb-1",
              isPanel ? "text-[10px]" : "text-[9px]",
            )}
            style={{ color: v.accent }}
          >
            {eyebrow}
          </p>
        )}
        <p
          className={cn(
            "font-syne font-semibold text-cream leading-snug",
            isPanel ? "text-[16px] sm:text-[17px]" : "text-[13px]",
          )}
        >
          {title}
        </p>
        {description != null && (
          <p
            className={cn(
              "text-cream/65 leading-snug",
              isPanel ? "text-[13px] mt-1" : "text-[13px]",
            )}
          >
            {description}
          </p>
        )}
        {children}
      </div>

      {meta != null && (
        <span
          className="hidden sm:inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] shrink-0"
          style={{ color: v.accent }}
        >
          {meta}
        </span>
      )}

      {(Primary || secondaryAction) && (
        <div className="flex items-center gap-2 shrink-0">
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
              className={cn(
                "rounded-full border border-white/[0.12] bg-white/[0.05] text-cream",
                "hover:bg-white/[0.08] hover:border-white/[0.22] transition-colors",
                "font-syne font-semibold disabled:opacity-60 disabled:cursor-not-allowed",
                isPanel ? "px-4 py-2.5 text-[14px]" : "px-3.5 py-1.5 text-[13px]",
              )}
            >
              {secondaryAction.label}
            </button>
          )}
          {Primary}
        </div>
      )}

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className={cn(
            "shrink-0 grid place-items-center rounded-full",
            "text-cream/40 hover:text-cream hover:bg-white/[0.06] transition-colors",
            isPanel ? "absolute top-3 right-3 w-7 h-7" : "w-6 h-6",
          )}
        >
          <X size={isPanel ? 13 : 11} weight="bold" />
        </button>
      )}
    </motion.div>
  );
}
