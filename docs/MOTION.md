# Lionade Motion System

A short guide to the reveal/celebration primitives that ship in `components/`. Pick the right one for the moment.

---

## The four primitives

| Component | When to use | File |
|---|---|---|
| `<RevealText>` | Hero text that should type in character-by-character | `components/RevealText.tsx` |
| `<RevealList>` | A list of items that should stagger into view | `components/RevealList.tsx` |
| `<CountUp withDigitReveal>` | A cinematic number that should count up THEN pop per digit | `components/CountUp.tsx` |
| `<Confetti>` | One-shot particle burst on a celebration | `components/Confetti.tsx` |
| `<CinematicReveal>` | Drop-in trio of RevealText + Confetti + halo for "moment" reveals | `components/CinematicReveal.tsx` |

All four respect `prefers-reduced-motion`. Reduced-motion users get the final visual state without the animation — never a half-rendered result.

---

## `<RevealText>` — per-character typewriter

```tsx
<RevealText
  text="BLUFFED"
  color="#FCA5A5"
  glow="0 0 8px rgba(239,68,68,0.45)"
/>
```

Props:
- `text` — string to type out
- `color?` — per-character color, falls back to `currentColor`
- `glow?` — text-shadow string applied per char
- `delay?` — seconds before first char (default `0.15`)
- `charDelay?` — seconds added per char (default `0.05`)
- `charDuration?` — per-char duration (default `0.22`)
- `className?` — applied to the wrapping `<span>`
- `ariaLabel?` — defaults to `text`

Already used at: Sketchy `RoundEndOverlay` word, Bluff "THE TRUTH", Poker Face "BLUFFED"/"HONEST", Roardle "NICE!", Resume Coach section headers, Mastery exam-title reveal.

**Don't** use for body copy, button labels, or anything > ~20 characters. The stagger reads as ostentatious past that length.

---

## `<RevealList>` — staggered list items

```tsx
<RevealList as="ul" className="space-y-2" itemDelay={0.06}>
  {strengths.map((s) => (
    <li key={s.id}>{s.text}</li>
  ))}
</RevealList>
```

Each child gets wrapped in a `motion.span` with the stagger applied. `as`
prop picks the wrapper element (`"div"` default, `"ul"`/`"ol"` for
semantic lists). Defaults: `delay 0.15s`, `itemDelay 0.06s`,
`itemDuration 0.32s`.

Already wired in: brand-new component as of MOTION.md v2. Migration
targets: Bluff voter chips per answer, Poker Face per-caller rows on
reveal, Resume Coach strengths/weaknesses bullet lists, Pardy Final
Tally tier indicator + score block.

**Don't** wrap children that have their own entrance animation — the two
will fight. Pick one.

---

## `<CountUp withDigitReveal>` — cinematic numbers

```tsx
<CountUp value={score} duration={1100} withDigitReveal />
```

The new `withDigitReveal` prop layers a per-digit overshoot pop on top of the existing count-up animation. Each digit runs `count-up-digit-pop` (opacity + y + scale overshoot, 320ms ease-out, 40ms stagger).

**Default behavior is unchanged.** Don't pass `withDigitReveal` to the navbar Fang counter or the leaderboard rank — they should stay calm.

Pass it at: end-of-game scores, "you earned N Fangs" big reveal, Pardy Final Tally.

---

## `<Confetti>` — particle burst

```tsx
<Confetti
  trigger={shouldFire}
  count={60}
  origin="top"
  duration={2000}
  palette={["#FFD700", "#A855F7", "#FDE68A"]}
  onComplete={() => setShouldFire(false)}
/>
```

Self-positions fixed to the viewport. Fires from `origin: "top" | "center"`. `trigger` is a one-shot — flip it to `true` for the burst, then back to `false` (`onComplete` callback does this).

Reuse the palette conventions:
- **Gold tier** (win, perfect, master): `["#FFD700", "#FDE68A", "#FFFFFF"]`
- **Win + game accent**: `["#FFD700", "#FDE68A", <accent>]`
- **Truth/honesty**: `["#FFD700", "#A855F7", "#22C55E", "#FDE68A"]`
- **Bluff / fooled-them**: `["#FFD700", "#A855F7", "#FDE68A", "#E9D5FF"]`

Don't fire on the loss / miss / time's-up state. No fake celebrations.

---

## `<CinematicReveal>` — the drop-in trio

```tsx
<CinematicReveal
  text="PERFECT GAME"
  accent="#FFD700"
  confettiPalette={["#FFD700", "#FDE68A", "#FFFFFF"]}
/>
```

When you need RevealText + Confetti + radial halo in one shot and your surrounding layout is plain. Sites with custom structure (multi-line copy, embedded buttons, special positioning) keep wiring the parts separately.

Props: `text, accent?, glow?, noConfetti?, confettiCount?, confettiPalette?, delay?, className?`.

The halo is a radial gradient at 22% alpha keyed on `accent`. Confetti fires ~120ms after the text-delay so the halo lands first.

---

## Accent color conventions

| Color | Hex | Use |
|---|---|---|
| Gold | `#FFD700` | Win, perfect, master tier, premium |
| Emerald | `#86EFAC` | Truth, honest, correct, ready-to-pass |
| Red-200 | `#FCA5A5` | Bluff, missed, time's up, struggling |
| Electric blue | `#00BFFF` | Poker Face accent, decent run |
| Purple | `#A855F7` | Sketchy accent, epic tier |
| Cream/45 | `rgba(238,244,255,0.45)` | Neutral, tough round, dim |

Glow strings: same hue at 35–55% alpha, 6–10px blur. `0 0 8px rgba(34,197,94,0.45)` is a good emerald default.

---

## Default timings

| Where | Delay | Char delay | Duration |
|---|---|---|---|
| Standard reveal (Bluff truth, Poker verdict) | 0.15s | 0.05s | 0.22s |
| Snappier reveal (Roardle NICE) | 0.15s | 0.07s | 0.22s |
| Word-by-word (RoundEndOverlay word) | 0.32s | 0.06s | 0.18s |
| Section header (Resume STRENGTHS) | 0.18s | 0.04s | 0.22s |
| Long string (Mastery exam title) | 0.18s | 0.035s | 0.22s |

If you find yourself reaching for new timings, ask first whether the existing ones do the job. The system is only useful if it stays a system.

---

## Anti-patterns

- ❌ Wrapping body copy in `<RevealText>` — it's for hero text, not paragraphs
- ❌ Firing `<Confetti>` on every render without a `trigger` gate
- ❌ Adding `withDigitReveal` to a counter that updates frequently (it'll re-fire every change)
- ❌ Custom char-delays > 0.1s — the reveal feels stalled past that
- ❌ Building a new ad-hoc `Array.from(text).map((c, i) => <motion.span>)` somewhere. If you need a typewriter, use the component. If the component can't do it, extend the component.

---

## Adding a new motion primitive

If you genuinely need a new primitive (e.g. `<RevealList>` for staggered list items), follow the existing shape:

1. Component file in `components/` with the `"use client"` directive
2. Single default export, props interface above
3. Reduced-motion handling that renders the final state
4. Default timings documented in props doc comments
5. Update this `MOTION.md` with the new primitive + use cases
