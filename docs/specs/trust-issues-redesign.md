# Trust Issues: Asymmetric-Info Redesign (formerly Poker Face)

Status: spec, LOCKED 2026-05-31, ready for engineering
Owner (spec): product-strategist
Source: Sam playtest feedback, 2026-05-30; CEO locks 2026-05-31
Replaces: current casino mechanics Poker Face (see `project_competitive_modes`)

## Locked Answers (2026-05-31)

CEO (Sam) closed the open questions on this spec. Anyone reading downstream: these are decisions, not proposals.

- **Game name → "Trust Issues" (LOCKED).** Casino vocabulary entirely avoided in UI/marketing (no poker / bluff / ante / call / fold / chips / pot / jackpot). Gen Z native tone, matches Lionade brand. The verb "bluff" is fine as INTERNAL mechanical description ("the Knower chooses to bluff or tell the truth"); never in user-facing copy.
- **Knower's claim input → multiple choice.** 4 generated claims per round (1 true, 3 plausible lies). Knower picks one to say. Free-text claim mode deferred to V2.
- **Card source → hybrid by phase.** V1 launch: 3 curated decks × 100 cards each = 300 cards. Themes: Pop Culture, Trivia Facts, Lionade Lore. V1.5: Ninny-generated decks as a Pro perk. Curated avoids moderation headaches at launch; Ninny-generated becomes a clear Pro upsell hook.
- **Reader verdict → BELIEVE / DOUBT** (replaces "BELIEVE / CALL THE BLUFF" — banned casino verb).
- **Probe answers → canned in V1.** Free text needs moderation; deferred.
- **Fangs staked per round → NO in V1.** XP + leaderboard only. Legal memo recommends this for first App Store review.
- **Match length → best of 6** (3 rounds as each role). Quickplay variant deferred.

## 1. Problem

- **Regulatory exposure.** Even the bounded casino variant flirts with gambling adjacent framing. Risky for App Store + state regulators.
- **Hard to grok.** Needs a poker mental model. Too much onboarding for a party game that should be teachable in one round.

Reframe as asymmetric information game inspired by MrBeast briefcase / lie detector videos. Cinematic, simple, zero gambling primitives. The rename to **Trust Issues** completes the regulatory distancing — name itself no longer evokes casino play.

## 2. Mechanic in detail

**Roles.** Two players. One **Knower**, one **Reader**. Roles swap each round. Match is best of 6 (3 as each role). Rated ladder uses competitive_elo.

**Setup (5s).** Knower is dealt one card with a TRUTH statement. Reader sees a card back + category only.

**Claim (20s).** Knower picks from **4 app-generated claims**: one verbatim truth, three plausible lies. Reader sees the pick as if the Knower said it.

**Probe (30s).** Reader sees the claim + 3 leading questions ("How confident?", "Where did you learn this?", "Stake your match score?"). Knower answers each by tapping 1 of 2 to 3 canned responses. No free text in V1.

**Verdict (15s).** Reader taps **BELIEVE** or **DOUBT**.

**Reveal (5s).** Full screen overlay: true statement, Knower's pick, outcome.

**Scoring.**
- Knower deceived, Reader believed: +2 Knower
- Knower truthful, Reader believed: +1 each
- Knower deceived, Reader doubted: +2 Reader
- Knower truthful, Reader doubted: +2 Reader, 0 Knower

**Round target:** ~75s (under Sam's 90s cap).

## 3. Card source (LOCKED — hybrid by phase)

- **V1 launch.** 3 curated decks × 100 cards each = 300 cards. Themes: **Pop Culture**, **Trivia Facts**, **Lionade Lore**. Cards live in `lib/party/trust-issues-cards.ts` (mirrors existing `pokerface-cards.ts` structure). Each card: `{ id, deck, truth, plausible_lies: [string, string, string], category }`.
- **V1.5.** Ninny-generated decks as a Pro perk. Reuses `dev-ai-specialist` infra. Generated cards pass through a moderation pre-filter before reaching players.

## 4. Acceptance criteria (V1)

- [ ] Two player session startable from party lobby.
- [ ] Roles swap each round; match ends at 6.
- [ ] Knower view + Reader view visually distinct; neither leaks the other's state.
- [ ] All 5 phases render with timers and auto advance on 0.
- [ ] 4 claims (1 truth + 3 lies) generated per round, server-authoritative (Reader never sees which is true).
- [ ] Scoring matrix implemented, shown on reveal.
- [ ] No casino UI primitives (chips, pots, raise buttons, playing card backs).
- [ ] No casino vocabulary in user-facing copy (bet / ante / pot / fold / chips / jackpot / bluff / call all banned per legal memo).
- [ ] No em-dashes in copy.
- [ ] Legal sign off recorded (see `trust-issues-legal-memo.md`).
- [ ] 300-card V1 deck loaded across the 3 themes.

## 5. Out of scope for V1

Tournaments, custom decks, user submitted cards, voice tells, video, 3+ players, spectator mode, replay sharing, Fang stakes (deferred indefinitely per legal posture), Ninny-generated cards (V1.5), free-text claims (V2).

## 6. Routing (LOCKED owners)

- **`business-legal-compliance`**: signed off in `trust-issues-legal-memo.md` (no Fangs staked → cleared). Re-review required before V1.5 Pro Ninny cards ship.
- **`design-ui-ux`**: Knower vs Reader layouts, reveal overlay, role swap transition.
- **`design-copywriter`**: claim wording, probe questions, BELIEVE/DOUBT button copy, reveal copy for all 4 outcome states, "how to play" onboarding. No casino vocab. No dashes. **Dispatched 2026-05-31** to draft V1 copy at `docs/specs/trust-issues-copy.md`.
- **`dev-realtime-web`**: two player state machine on a renamed `trustIssuesChannel` (was `pokerFaceChannel`); extend events as needed.
- **`dev-backend`**: 300-card deck loader, 4-claim generator per round, server-authoritative truth tracking.
- **`dev-ai-specialist`**: V1.5 only (Ninny-generated decks + moderation pre-filter). Out of scope for V1.
- **`data-economist`**: NOT engaged for V1 (no Fang stakes). Re-engage if V2 stakes are reconsidered.
- **`quality-qa-tester`**: both role perspectives + disconnect during claim/probe/verdict + secret-leak check (server-emitted truth never reaches Reader before reveal).

## 7. iOS parity note

Cross platform default applies. Flag for `vp-ios`: `ios-dev-screens` + `ios-dev-realtime` build the same spec on Expo; `ios-design-motion` mirrors reveal overlay in Reanimated. iOS port queued for after web V1 stabilizes. IOS_PARITY.md row exists at the top of the file dated 2026-05-31 ("spec locked, web build pending").
