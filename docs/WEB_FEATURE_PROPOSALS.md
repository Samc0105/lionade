# Web Feature Proposals — 2026-07-02

Phase-1 output of the freestyle exploration. Grounded against the live codebase
(file references verified), anchored to the three validated 2026 trends, ranked
by impact-to-effort. Nothing here is built yet.

Note on pattern references: the Mobbin MCP is not connected in this session
(install + OAuth pending), so UI patterns reference the CLAUDE.md canon
(Duolingo for gamified moments, Cash App for speed/feel, Linear for restraint,
Notion for content-first).

---

## Grounding: what Lionade web already has

Quizzes run on a static+community question pipeline (`question_bank` flywheel,
auth-gated grading). Ninny is the AI layer: Mastery Mode (topic → weighted
subtopics → Socratic sessions), Ninny chat/generate (20/day cap), quick-note
classification, syllabus parsing, resume coach. The Fangs economy is a
dual-ledger (cashable/iap) behind the `update_user_coins` RPC with a strict
`coin_transactions` type allowlist. Daily Drill re-serves 5 recent Mastery
misses per UTC day. Three independent spaced-repetition systems exist: vocab
words (real SM-2: ease factor + `next_review_at`), class flashcards
(Again/Hard/Good/Easy SM-2 variant, AI-generated from notes), and weak-spot
review (Leitner boxes over missed Ninny questions, shipped 2026-07-01, dormant
behind a HELD migration). Social has friends/DMs/feed/leaderboards; Party has
full room infrastructure (6-char codes, open/friends/closed privacy, realtime
channels, AFK reaping). Focus Lock-In is a solo sealed Pomodoro (25/45/60 min,
Fangs on completion, 6/day server cap). Streaks are personal-only (daily +
per-class + per-vocab-bank), with Freeze and Revive monetization; NO
friend/social streak mechanic exists.

---

## 1. Unified Review Hub + true SM-2 everywhere — rank #1

**What:** One "Reviews due today" surface (`/learn/review` grows into the hub)
that merges all three existing SR sources — weak-spot questions, class
flashcards, vocab words — into a single due queue with one session flow, plus
a retention stat ("you remembered 87% this week"). Under the hood, upgrade the
weak-spot module from Leitner to the same true SM-2 shape the other two
already use (`ease_factor` + explicit `next_due_at`, copying
`vocab_words`/`class_flashcards` proven column patterns; extends the existing
HELD migration).

**Why on-trend:** the true-SRS trend (SM-2 scheduling at the forgetting edge,
~87% vs ~71% retention). Lionade literally has SM-2 twice already and hides it
in tab corners; the missing piece is one front door and one scheduler.

**Uses:** `lib/weak-spot-review.ts`, `lib/vocab.ts` `sm2Advance`,
`lib/class-flashcards.ts` `applyRating`, the existing `/learn/review` page,
dashboard due-count badges.

**Complexity:** M (mostly integration + one migration; all three grading
routes exist).

**Biggest risk:** migration interplay — the weak-spot SR migration is HELD and
this extends it; the hub must fail-soft per source (established pattern) so an
unapplied migration never blanks the queue.

---

## 2. Ninny Study Sets: paste anything → instant deck — rank #2

**What:** A "Make me a study set" flow: paste notes / drop text (later: the
existing photo-OCR path) → Ninny generates a named deck of flashcards + MCQs →
the deck feeds the Review Hub scheduler immediately. Decks live under Learn,
attachable to a class. Generation preview → user trims/edits → save (never
auto-publish AI output).

**Why on-trend:** AI-generated study sets attack the #1 barrier to spaced
repetition: manual card creation. Lionade has every ingredient (AI JSON
contract in `mastery/parse`, note→flashcard generation in
`lib/class-flashcards.ts`, storage patterns) but no standalone
paste-to-deck flow.

**Uses:** `callAIForJson` + Zod at the trust boundary, the `ai_call_log`
telemetry + prompt-version convention, input-size caps (~20KB), the daily-cap
pattern (`NINNY_DAILY_LIMIT`), `class_flashcards` schema as the card shape.

**Complexity:** M/L (one new AI route + deck tables + a builder UI; the
review-side lands free if #1 ships first).

**Biggest risk / COST FLAG:** this is a NEW AI spend surface (gpt-4o class).
Mitigation: per-day generation cap (reuse the 20/day pattern), input caps,
`ai_call_log` telemetry from day one. Quality risk: bad cards poison the SRS —
the preview/trim step is mandatory, not optional.

---

## 3. Focus Rooms: bounded body-doubling — rank #3

**What:** "Study with friends" rooms: create a room (reusing the party-room
skeleton: 6-char code, open/friends/closed privacy), pick a bounded session
(25/45/60 min, same presets as Focus Lock-In), everyone locks in together —
shared countdown, live presence chips, quiet join/leave toasts, optional
focus-music toggle. Completion pays the existing Focus Lock-In Fangs PLUS a
small everyone-finished group bonus. Strictly bounded sessions with a clear
start/end and a summary screen — no infinite ambient rooms, no camera/mic.

**Why on-trend:** body doubling / "study with me" is the viral 2026 focus
mechanic; the CEO framing (bounded tool, not dependency) is respected by
design: sessions end, rooms expire (the party 5h lazy TTL already exists).

**Uses:** `party_rooms`/`party_room_players` patterns + realtime channel
helpers, `lib/presence.ts` active-session RPCs + AFK reaper, the
focus-session API (per-day cap, honor-system + server caps), friendships for
privacy modes.

**Complexity:** M/L (room plumbing is proven; new work = the focus round
model, the shared-timer surface, and the group-bonus settle done idempotently
via the `settle_competitive_credit` marker-row pattern).

**Biggest risk:** realtime edge cases (host leaves mid-session; clock drift —
solved like Focus Lock-In with server timestamps) and the empty-room cold
start (mitigate: rooms are friend-invite-first, plus a "solo with ambient"
fallback that is just Lock-In).

**Economy note:** upside-only by construction — joining costs nothing, no
Fangs at risk, bonuses on completion only (COPPA-safe, no gambling shape).

---

## 4. Streak Pacts: duo accountability streaks — rank #4 (best sleeper)

**What:** Pick a friend, form a Pact: a SHARED streak that increments only on
days BOTH of you study (any qualifying activity — quiz, review, focus
session). Pact card on the dashboard + social tab showing both avatars and the
joint count; milestone bonuses (7/30 days) pay BOTH sides; a nudge button
("Maya hasn't studied yet today") reusing the party nudge channel. Break =
reset to 0, no loss of anything else (upside-only).

**Why on-trend:** Duolingo's Friend Quests/streak socialization is the
proven-out social retention mechanic of 2025-26; Lionade has streaks and
friends but zero social-streak glue (verified: no such mechanic exists).

**Uses:** `friendships`, `daily_activity` (the both-studied check),
streak-increment server path, `update_user_coins` + a new ledger type,
social feed events.

**Complexity:** S/M (one table, one cron-or-lazy check, two surfaces).

**Biggest risk:** timezone fairness (UTC day boundaries feel wrong across
timezones; mitigate by using the existing UTC-day convention consistently and
saying so in UI copy).

---

## 5. Community Study-Set Library — rank #5 (defer)

**What:** Publish a study set (from #2) to a public library; browse/clone by
subject; Fangs tip jar for creators (upside-only). Network-effects play.

**Why on-trend:** the Quizlet-style shared-set library remains the killer
distribution loop for study tools; pairs with #2.

**Uses:** the vocab `discover/clone` pattern (`vocab_clone` ledger type
exists), moderation via `lib/moderation-ugc.ts`.

**Complexity:** L (publishing, moderation queue, search, abuse handling).

**Biggest risk:** UGC moderation surface area for a minor-heavy audience — a
real safety commitment, not a feature checkbox. Defer until #2 proves demand.

---

## Recommended picks

**#1 + #2 + #4** for maximum compounding: the Hub makes review a daily habit,
Study Sets feed it content, Pacts make both social. **#3** is the flashiest
single feature if you want the viral swing instead — it stands alone well.

Shared constraint for whatever ships: any new Fangs reward needs its ledger
type added to the `coin_transactions` CHECK — that allowlist migration is
itself HELD/unapplied, so new rewards ship dormant-until-applied per the
established fail-soft pattern.
