# Sketchy Subjects — Layout Design Spec

Status: design, ready for `dev-frontend`
Source: `sketchy-roundflow-fix.md` (locked answers section is authoritative)
Owner: design-ui-ux

## 1. Side-feed layout (viewport ≥ md)

Grid wrapper on the drawing-phase root, mobile unchanged:

```
[ Subject pill ] [ drawer pill / "X is drawing" ] [ timer ]
+----------------------------------------+---------------------+
|                                        | GUESSES             |
|             CANVAS (1fr)               |  (clamp 260-360px)  |
|                                        |  scroll column      |
|                                        |                     |
|        [ Wordle blanks row ]           |  guess row          |
|        [ Toolbar (drawer) ]            |  guess row          |
|                                        |  guess row  <-- new |
|        [ Guess input (guesser) ]       |  (sticky bottom)    |
+----------------------------------------+---------------------+
```

Wrapper: `grid gap-4 md:grid-cols-[1fr_clamp(260px,25vw,360px)]`. On `<md` it collapses to a single column; the existing guesses panel renders below the canvas (unchanged).

**Order of guesses (decision)**: most recent at the **bottom**, column scrolls to bottom on new entry. Drawer is multitasking on the canvas — bottom-anchored reads like a live chat (familiar mental model), and the auto-scroll-to-newest means they only need to glance at the bottom edge for ambient awareness. Top-anchored would force re-reading.

### Component breakdown

- `SketchGuessFeed` (new) — owns the scroll container + row mapping. Replaces the existing inline panel in `SketchView.tsx` lines ~1056-1101.
- `SketchGuessRow` (new) — one row: avatar (24px), username, body OR correct badge.
- `SketchGuessFeedEmpty` (new) — empty state copy.

### Container styling

- Wrapper: `rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md flex flex-col h-full max-h-[calc(100vh-12rem)] md:max-h-none md:h-[var(--canvas-h,520px)] overflow-hidden`
- Header strip: `px-3 pt-3 pb-2 border-b border-white/5 flex items-center justify-between`
  - Label: `font-bebas text-[11px] tracking-[0.25em] text-cream/45` → `GUESSES`
  - Count chip (when > 0): `font-dm-mono text-[10px] text-cream/40` → `12`
- Scroll body: `flex-1 overflow-y-auto px-2 py-2 space-y-1 scroll-smooth`
- Fade mask: `mask-image: linear-gradient(to bottom, transparent 0, #000 16px, #000 calc(100% - 24px), transparent 100%)` (top + bottom 16/24px)

### Row styling (`SketchGuessRow`)

Base: `flex items-center gap-2 px-2 py-1.5 rounded-lg`

Variants:
- `guess`: background transparent. Username `font-syne text-xs text-cream/55`. Body `font-syne text-sm text-cream/85`. Apply existing `GuessText` greening.
- `close`: row tint `bg-amber-400/8 border border-amber-300/20`. Username unchanged. Body replaced with `font-syne text-xs italic text-amber-200` reading `is close`.
- `correct`: row tint `bg-emerald-400/12 border border-emerald-300/30`. Body replaced with chip `font-bebas text-[11px] tracking-wider px-2 py-0.5 rounded-full bg-emerald-400/20 text-emerald-200 border border-emerald-300/40` reading `GOT IT`. Add tiny gold spark dot `w-1 h-1 rounded-full bg-[#FFD700]` to the right.
- `system`: `font-syne text-[11px] italic text-cream/40 text-center justify-center` (no avatar).

Avatar: 24px circle, `rounded-full ring-1 ring-white/10`. Fallback initial: `bg-purple-500/20 text-purple-200 font-bebas text-[11px] flex items-center justify-center`.

Reuse existing `pa-guess-pop` enter animation + `pa-correct-flash` for correct. No new keyframes.

### State variants

- **Empty** (`chat.length === 0`): centered block, height `min-h-[120px]`, `font-syne text-xs text-cream/35 italic` reading `Guesses appear here`. Decorative dotted ink ring above: 28px circle `border border-dashed border-white/10`.
- **First guess**: empty state cross-fades out (200ms opacity), first row pops in via `pa-guess-pop`.
- **Many guesses** (> 8): older rows fade toward top via the mask. No truncation cap (existing `.slice(-14)` retained as a perf bound).
- **Drawer view**: identical feed, no input form rendered. Header label `GUESSES` is replaced with `WHAT THEY'RE GUESSING` (`font-bebas text-[11px] tracking-[0.25em] text-purple-200/70`) so the drawer reads it as ambient signal, not their own queue. No echo of the secret word anywhere.
- **Guesser view (post-correct)**: their own `YOU GOT IT` confirmation continues to render BELOW the canvas in the main column, NOT inside the feed (existing behavior, preserved). The feed still receives the broadcast row showing them as `GOT IT`.

## 2. Round-end overlay

New component `RoundEndOverlay`, mounted at `SketchView` root via `AnimatePresence`. Visible when server-pushed `phase === "celebrating"`. Click-through blocked; canvas pauses upstream.

```
+-----------------------------------------------------+
|                                                     |
|              [ winner avatar 96px ]                 |
|                                                     |
|             ROUND WON BY MARCUS                     |
|                                                     |
|                 word: armadillo                     |
|                                                     |
|              · · · next round · · ·                 |
|                                                     |
+-----------------------------------------------------+
```

Backdrop: `fixed inset-0 z-50 flex items-center justify-center bg-[#04080F]/82 backdrop-blur-md`. Subtle radial halo behind avatar: `background: radial-gradient(circle at center, rgba(168,85,247,0.18), transparent 60%)`.

Card: `relative flex flex-col items-center gap-4 px-8 py-10 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_0_60px_rgba(168,85,247,0.25)] max-w-md mx-4`

**State A — Someone won**:
- Winner avatar: 96px circle, `ring-2 ring-[#FFD700]/60 shadow-[0_0_24px_rgba(255,215,0,0.35)]`
- Headline: `font-bebas text-4xl md:text-5xl tracking-wider text-cream` → `ROUND WON BY {NAME}`
- Subtext: `font-dm-mono text-sm text-cream/60` → `word: {word}` (lowercase, NOT uppercased)
- Footer: `font-syne text-[11px] tracking-[0.3em] text-cream/35` with two flanking dots → `NEXT ROUND`

**State B — Time's up**:
- Replace avatar with 72px hourglass glyph in a circle: `bg-orange-500/15 border border-orange-400/40 text-orange-300` (use inline SVG or unicode). No gold ring.
- Headline: `font-bebas text-4xl md:text-5xl tracking-wider text-orange-200` → `TIME'S UP`
- Subtext: same `font-dm-mono` → `word: {word}`
- Footer: same `NEXT ROUND` strip

**Copy locked** (no dashes, no em-dashes):
- `ROUND WON BY {NAME}`
- `TIME'S UP`
- `word: {word}`
- `NEXT ROUND`

### Accessibility

- Root has `role="status" aria-live="polite" aria-atomic="true"`.
- Live region text: `Round won by {name}. The word was {word}.` OR `Time is up. The word was {word}.`
- Esc key dismisses local-only. Focus trap NOT required (no interactive content).
- `prefers-reduced-motion`: skip all transforms, fade only.

### Server payload `RoundEndOverlay` accepts

```
phase: "celebrating"
started_at: ISO string
winner: { user_id, username, avatar_url } | null   // null = time's up
word: string
```

If `winner` is null → render State B. If present → State A. Component reads server state, holds for ~2s clock, dismisses when phase advances.

## 3. Hand-off to dev-frontend

### File paths

- New: `components/party/SketchGuessFeed.tsx`
- New: `components/party/SketchGuessRow.tsx`
- New: `components/party/RoundEndOverlay.tsx`
- Modify: `components/party/SketchView.tsx` — wrap drawing-phase JSX in the grid wrapper; replace inline panel (lines ~1056-1101) with `<SketchGuessFeed />`; mount `<AnimatePresence>{phase === "celebrating" && <RoundEndOverlay ... />}</AnimatePresence>` at view root.

### Component prop shapes

```
SketchGuessFeed:
  messages: ChatMsg[]          // existing ChatMsg type
  viewerIsDrawer: boolean
  className?: string

SketchGuessRow:
  message: ChatMsg
  avatarUrl?: string | null    // resolved from players[] in parent
  reducedMotion: boolean

RoundEndOverlay:
  winner: { user_id: string; username: string | null; avatar_url: string | null } | null
  word: string
  startedAt: string            // ISO; for the local 2s hold visual
  onEscape?: () => void        // local dismiss only
```

### Tailwind tokens to reuse (no new tokens)

- Card surfaces: `rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md`
- Headline: `font-bebas tracking-wider text-cream`
- Data text: `font-dm-mono`
- Body / labels: `font-syne`
- Gold accent: arbitrary `text-[#FFD700]` and `ring-[#FFD700]/60` already used elsewhere
- Purple accent: `text-purple-200`, `bg-purple-500/15`, `border-purple-500/40` (matches existing subject pill)
- Grid: `md:grid-cols-[1fr_clamp(260px,25vw,360px)]`

### Reused animation classes (existing in `app/globals.css`)

`pa-guess-pop`, `pa-correct-flash`, `pa-pop-in`, `pa-stamp`, `pa-spotlight`. No new keyframes from this spec — overlay motion is `design-motion-web`'s deliverable.

## 4. Coordination notes for design-motion-web

One line each, `design-motion-web` specs the timings:

- **Overlay backdrop**: fade + faint scale of the blur from 0px → 16px on enter; reverse on exit.
- **Overlay card**: scale 0.92 → 1.0 + lift 12px, settled with a soft spring; on exit shrink + fade.
- **Winner avatar (State A)**: lands slightly after the card, with a gold ring sweep (stroke-dasharray reveal) circling once, then a soft pulse. Stagger ~120ms after card.
- **Headline name**: each word slides up + fades in, staggered by word (not letter); subtext fades 80ms behind.
- **Time's up hourglass (State B)**: one 180-degree flip on enter, then a single shake, no looping.
- **"Next round" footer dots**: 3-dot loading shimmer cycling left-to-right while overlay holds.
- **Side-feed new row**: keep existing `pa-guess-pop`; add a 1-frame ring-flash on the row container when `variant === "correct"` to amplify the existing `pa-correct-flash`.
- **No conflict with commit `7ea2ce8`**: Wordle tile flip + locked-word stamp continue to fire during `drawing` phase; overlay only appears during `celebrating`. Verify only that the locked-word stamp completes before `celebrating` can interrupt it (existing stamp is 0.55s; overlay enter should not race it on the same frame).

---

## Open question for Sam

When two guessers get the word within the same ~300ms window, should the overlay name the FIRST correct guesser only, OR show "ROUND WON BY MARCUS + 1 other" attribution? Current spec assumes single winner (`winner: { user_id, username, avatar_url }`). Default if not answered: first-to-submit wins (Skribbl model).
