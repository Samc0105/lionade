"use client";

/**
 * Shared UI primitives for the route-based settings overhaul.
 *
 * The six section pages (Account / Privacy / Notifications / Data & Usage /
 * Subscription / Danger Zone) import from this file so the section chrome,
 * rows, toggles, segmented controls, and "Saved ✓" affordance stay
 * pixel-identical across every settings route.
 *
 * Design system: navy bg, cream text, electric primary, gold accents.
 * Glass cards: bg gradient + border-electric/10, rounded-2xl, section-eyebrow
 * header (font-mono small-caps + gold/electric rule). All motion here is
 * GPU-only (opacity / transform) and collapses under prefers-reduced-motion
 * via the transition utilities + the globals.css blanket reduced-motion rule.
 *
 * Dependency-light: only React + phosphor's Check icon.
 */

import { useCallback, useState } from "react";
import { Check } from "@phosphor-icons/react";

// ── SettingsCard ────────────────────────────────────────────────────────────
// Glass card with an optional section-eyebrow header. The eyebrow is the
// small-caps mono label; the title is the bebas heading. Omit both `title`
// and `eyebrow` for a bare glass container.
//
//   <SettingsCard eyebrow="Identity" title="Your account"> … </SettingsCard>
//
export function SettingsCard({
  title,
  eyebrow,
  children,
}: {
  /** Bebas heading shown beneath the eyebrow. Optional for bare cards. */
  title?: string;
  /** Small-caps mono kicker above the title (e.g. "Visibility"). */
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border border-electric/10 p-6 mb-5 animate-slide-up transform-gpu"
      style={{
        background:
          "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))",
      }}
    >
      {(title || eyebrow) && (
        <header className="mb-4">
          {eyebrow && (
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="inline-block w-6 h-px bg-gold/70"
                aria-hidden="true"
              />
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/45 leading-none">
                {eyebrow}
              </p>
            </div>
          )}
          {title && (
            <h2 className="font-bebas text-[24px] tracking-wider leading-none text-cream">
              {title}
            </h2>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

// ── SettingRow ───────────────────────────────────────────────────────────────
// Label (+ optional description) on the left, control on the right. Stacks
// vertically on mobile so a wide control (segmented, select) never crowds the
// label. Drop any control as `children` — a Toggle, Segmented, button, etc.
//
//   <SettingRow label="Public profile" description="Appear in search">
//     <Toggle checked={pub} onChange={setPub} />
//   </SettingRow>
//
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <p className="text-cream text-sm font-semibold leading-tight">{label}</p>
        {description && (
          <p className="text-cream/45 text-xs mt-1 leading-snug">{description}</p>
        )}
      </div>
      {children && <div className="flex-shrink-0">{children}</div>}
    </div>
  );
}

// ── Toggle ───────────────────────────────────────────────────────────────────
// Ported from the legacy single-page settings Toggle, stripped to a pure
// control (label/description now live in SettingRow). GPU-only (transform +
// background-color), respects prefers-reduced-motion via the transition
// utilities + globals.css blanket rule.
//
//   <Toggle checked={enabled} onChange={setEnabled} />
//
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Optional accessible label when the control isn't inside a labelled row. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={label}
      className={`relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200 transform-gpu focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 ${
        checked ? "bg-electric" : "bg-white/10"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        aria-hidden="true"
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 transform-gpu"
        style={{
          transform: checked ? "translateX(20px)" : "translateX(0)",
          willChange: "transform",
        }}
      />
    </button>
  );
}

// ── Segmented ─────────────────────────────────────────────────────────────────
// Pill segmented selector for the 2–3 option privacy / visibility choices.
// Active segment is electric-filled; others are quiet glass. Pure
// background-color transition (GPU-safe, reduced-motion safe).
//
//   <Segmented
//     options={[
//       { value: "public", label: "Public" },
//       { value: "friends", label: "Friends" },
//       { value: "private", label: "Private" },
//     ]}
//     value={visibility}
//     onChange={setVisibility}
//   />
//
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]"
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors duration-200 transform-gpu focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 ${
              isActive
                ? "bg-electric text-white"
                : "text-cream/55 hover:text-cream hover:bg-white/10"
            } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── useSavedConfirm + SavedTick ──────────────────────────────────────────────
// Inline "Saved ✓" affordance. Call `flash()` after a successful PATCH; `saved`
// flips true then auto-clears after 2s. Render <SavedTick show={saved} /> next
// to the control that was just saved.
//
//   const { saved, flash } = useSavedConfirm();
//   const save = async (v) => { … if (res.ok) flash(); };
//   <SettingRow label="…">
//     <div className="flex items-center gap-2">
//       <SavedTick show={saved} />
//       <Toggle checked={v} onChange={save} />
//     </div>
//   </SettingRow>
//
export function useSavedConfirm(): { saved: boolean; flash: () => void } {
  const [saved, setSaved] = useState(false);
  const flash = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);
  return { saved, flash };
}

// GPU opacity fade; reduced-motion users get the instant on/off via the
// globals.css blanket transition-stripping rule. Always mounted (opacity-0
// when hidden) so it never shifts layout when it appears.
export function SavedTick({ show }: { show: boolean }) {
  return (
    <span
      aria-live="polite"
      className={`inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-green-400 transition-opacity duration-300 transform-gpu ${
        show ? "opacity-100" : "opacity-0"
      }`}
      style={{ willChange: "opacity" }}
    >
      <Check size={11} weight="bold" aria-hidden="true" />
      {show ? "Saved" : ""}
    </span>
  );
}
