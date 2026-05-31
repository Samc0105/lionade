# Sketchy Subjects: Round Flow Fix

Status: spec, LOCKED 2026-05-31, ready for engineering
Owner (spec): product-strategist
Source: Sam playtest feedback, 2026-05-30; CEO locks 2026-05-31

## Locked Answers (2026-05-31)

CEO (Sam) closed the three open questions on this spec. Anyone reading downstream: these are decisions, not proposals.

- **Missed-guess bug → diagnose-first.** Owner: `dev-realtime-web` end-to-end (with `dev-backend` if the 30-min diagnosis confirms it's a server emit gap, which is the leading hypothesis). No code edits before a 1-page diagnosis identifies the file:line where the event is dropped.
- **Round-end overlay → server-pushed phase.** Server emits `round_state: { phase: "celebrating", started_at, winner, word }` and all clients render from that authoritative state. No per-client timers for the overlay (eliminates drift, makes late-joiner state automatic, makes the overlay testable from one source of truth).
- **Side feed width → fluid `clamp(260px, 25vw, 360px)` on viewport ≥ md.** Mobile keeps the existing stacked-below-canvas layout. The earlier `280–320px` fixed range is superseded by the fluid clamp.

## 1. Problem

1. **Drawer is blind to correct guesses.** When a guesser submits the right word, the drawer's screen sometimes shows no ack. The drawer keeps drawing into a void.
2. **Guess feed steals canvas space.** Feed renders BELOW the canvas, squeezing the drawing surface. Skribbl puts the feed on the SIDE.
3. **Round end is too quiet.** Transition to next round is silent. Players miss who won, how fast, and what the word was.

## 2. Acceptance criteria

- [ ] When ANY guesser gets the word, the drawer's client updates UI within 500ms.
- [ ] If the realtime broadcast drops (tab backgrounded, transient socket loss), drawer UI reconciles within 3s via fallback refetch.
- [ ] On viewport >= md, guess feed renders to the RIGHT of the canvas as a `clamp(260px, 25vw, 360px)` fluid sidebar; canvas takes the rest.
- [ ] On viewport < md, feed stays stacked below the canvas.
- [ ] On round end (correct guess OR timer 0), the server emits `round_state.phase = "celebrating"` with `{ started_at, winner, word }`; clients render a full-screen overlay reading from that state for ~2s:
  - "Round won by {name} in {seconds}s · word: {word}"
  - "Time's up · word: {word}"
- [ ] Overlay blocks input, pauses canvas, then transitions to next round when the server emits the next phase.
- [ ] Esc dismisses overlay early (local-only; server-authoritative phase still advances on its own clock).
- [ ] No em-dashes in overlay copy.

## 3. Implementation hints

- `SKETCH_EVENTS.ROUND_ENDED` already exists on `sketchChannel(room.code)` (`lib/party/realtime-channels.ts`). The 30-min `dev-realtime-web` diagnosis should audit whether the SERVER actually emits it on a correct guess, or only on timer expiry. Leading hypothesis: incomplete emit path in `app/api/party/sketch/rounds/`.
- Drawer handler in `components/party/SketchView.tsx` (~line 355) exists; verify it isn't gated by a state flag only guessers meet.
- Fallback: on each timer tick, light poll round state if local flags disagree with server.
- Layout split in `SketchView.tsx`: grid wrapper `md:grid-cols-[1fr_clamp(260px,25vw,360px)]`.
- New component `components/party/RoundEndOverlay.tsx` mounted at view root via framer-motion AnimatePresence; reads `phase === "celebrating"` from server state.
- Server-pushed `celebrating` phase: add to the same `round_state` machine that already governs `select-word`/`drawing`/etc.; new fields `winner_user_id`, `revealed_word` set on the same write that broadcasts the phase transition.

## 4. Out of scope

Scoring math, Fang payouts, word bank, lobby flow, drawer rotation, letter reveal cadence.

## 5. Routing (LOCKED owners)

- **`dev-realtime-web`** (end-to-end OWNER for the bug): 30-minute diagnosis pass before touching code. Identify whether it's a server emit gap (leading hypothesis) or a client handler gap. Output: 1-page diagnosis with the file:line where the event is dropped + proposed fix. **Dispatched 2026-05-31.**
- **`dev-backend`** (engaged IF diagnosis confirms server-emit gap): implement the missing emit path + the new `celebrating` phase in `round_state`. Sub-owner under `dev-realtime-web`.
- **`design-ui-ux`**: side-mounted feed at `clamp(260px, 25vw, 360px)` on ≥md (stacked on mobile) + RoundEndOverlay screen design (~2s hold, reads from server `phase: "celebrating"`). **Dispatched 2026-05-31.** Hands to `dev-frontend` when designs are locked.
- **`dev-frontend`**: layout split + RoundEndOverlay component wiring once design + server state are ready.
- **`design-motion-web`**: overlay enter/exit motion, match Wordle tile flip energy.
- **`design-copywriter`**: overlay strings, no dashes.
- **`quality-qa-tester`**: reproduce missed event case: (a) two browsers, drawer tab backgrounded, guesser submits correct; (b) drawer on Slow 3G; (c) drawer rapid tab switches; (d) guesser closes tab right after submitting correct.

## 6. iOS parity note

Cross platform default applies. Flag for `vp-ios`: `ios-dev-realtime` mirrors server emit + reconciliation; `ios-dev-screens` builds side mounted layout for iPad, stacked for iPhone; `ios-design-motion` mirrors overlay in Reanimated. iOS port queued for after web V1 stabilizes. IOS_PARITY.md row exists at the top of the file dated 2026-05-31 ("spec locked, web build pending").
