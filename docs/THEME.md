# Theme Guide

Every new feature, page, or component must support both dark and light themes.

## Dark Theme (default)

| Element | Value |
|---------|-------|
| Background | Deep dark navy/black `#04080F` |
| Text | White and light grays `#EEF4FF` |
| Gold accent | `#FFD700` (highlights, rewards) |
| Blue accent | `#4A90D9` (primary actions) |
| Red accent | `#EF4444` (Arena, danger) |
| Cards/panels | Slightly lighter dark `#0a1020` |
| Borders | `rgba(255,255,255,0.06-0.1)` |
| Glassmorphism | `bg-white/5 backdrop-blur border border-white/10 rounded-2xl` |

## Light Theme

| Element | Value |
|---------|-------|
| Background | Warm white `#FFFBF0` |
| Text | Dark navy/black `#1a1a1a` |
| Gold accent | Same `#FFD700` |
| Red accent | Same `#EF4444` |
| Cards/panels | White with soft shadows |
| Borders | Light gray `#e5e5e5` |

## Rules

- **Use CSS variables for all colors** — never hardcode colors directly
- Every component must look correct in both themes
- The dark theme is the primary/default theme
- Use `data-force-dark` attribute on sections that must stay dark in light mode (e.g. Arena, Compete)
- Use CSS classes instead of inline styles for backgrounds that need to survive theme switching
- No grid lines or busy patterns on backgrounds
- Aesthetic: Clean and modern (like Discord/Linear) — not cluttered or over-designed
- The old ThemeProvider `fixInlineBackgrounds` function has been REMOVED — do NOT re-add it. Light theme is handled entirely by CSS `html.light` selectors.

## Fonts

| Font | Class | Usage |
|------|-------|-------|
| Bebas Neue | `font-bebas` | Headings |
| Syne | `font-syne` | Body text |
| DM Mono | — | Monospace |

## Animations

- CSS-only keyframes in `app/globals.css`
- All animations must respect `prefers-reduced-motion` — add new classes to the reduced-motion selector list at the bottom of `globals.css`

### Idle Animations
`idle-float`, `idle-pulse`, `idle-tilt`, `idle-shimmer`, `idle-shimmer-bar`, `idle-glow-mission`, `idle-glow-ninny`

### Component Classes
`btn-gold`, `btn-outline`, `btn-primary`, `card`, `tilt-card`, `gold-text`, `glow-gold`, `animate-slide-up`

## Color Palette Quick Reference

```
Dark BG:    #04080F
Light BG:   #FFFBF0
Gold:       #FFD700
Blue:       #4A90D9
Red:        #EF4444
Cream text: #EEF4FF
Dark text:  #1a1a1a
Card dark:  #0a1020
Card light: #FFFFFF
Border dk:  rgba(255,255,255,0.1)
Border lt:  #e5e5e5
```
