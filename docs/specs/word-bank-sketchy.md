# Word Banks → Sketchy Subjects

Status: **V1 shipped 2026-06-10** (migration pending) · V1.5 spec below · V2 roadmap.

Lets players use their personal Word Banks (the `/learn/vocab` study sets) as a
word source for Sketchy Subjects, so a party game doubles as a study session.

---

## V1 — shipped (this is the built state)

A player opts one of **their own** banks into a Sketchy game. It rides in the
existing per-player `selected_subjects` array as a `bank:<uuid>` token, sharing
the 2-pick cap with curated subjects. Each round draws **one** source, so banks
mix with curated subjects across rounds (round 1 Biology, round 2 your Spanish
bank, round 3 Chemistry).

- **Gate:** a bank is selectable only if owned by the caller and has `>= 30`
  words (`MIN_BANK_WORDS`). Under-threshold banks show greyed with `N/30`.
- **Picker:** grey "＋ Word Bank" button under the subject chips opens a sheet
  (`GET /api/party/rooms/[code]/banks`) listing the caller's banks with word
  counts. Selected banks render as grey chips. Other players' bank picks show
  as an anonymous "Word Bank ×N" so private bank names never leak.
- **Draw:** bank candidates get a grey "Bank" pill (vs green/yellow/red tiers)
  and show the word's **definition** as a card subline, so the drawer knows what
  to sketch (critical for foreign-language words). Drawer gets one **reroll**
  per round (`POST /sketch/rounds/[id]/reroll`) for undrawable words.
- **Reveal:** the factoid slot shows the definition under a "DEFINITION" eyebrow,
  turning each reveal into a micro study moment.
- **Answer:** the guess target is the bank word's `word` field (foreign word for
  language banks, term for general banks); existing fuzzy Levenshtein match.
- **Drawability safety:** banks mix across rounds, never within a single 3-card
  draw, so a bank round can be 3 hard-to-draw words. The reroll + the definition
  subline are the mitigation. V1.5 tightens this for language banks.

Schema: `sketch_rounds.source_kind ('curated'|'bank')`, `source_bank_id`,
`rerolled`. Migration `supabase/migrations/20260610_sketch_bank_source.sql`
(additive, defaulted). **Bank rounds do not work until it is applied.**

---

## V1.5 — the magic (spec, not yet built)

V1 treats bank words like curated words. V1.5 makes **language banks** a real
vocab drill and feeds results back into spaced repetition. This is the part that
turns the feature from fun into sticky.

### The language-bank loop

For a `kind = "language"` bank, the round is explicitly framed as
**draw the meaning, guess the word**:

1. The drawer's card shows the **translation** prominently (`dog`) with the
   foreign word (`perro`) smaller. They draw the meaning.
2. Guessers see a prompt: "Guess the Spanish word." They type `perro`. The match
   accepts the foreign word (primary) and optionally the translation (lenient
   mode, host setting) so it never feels unfair.
3. On a correct guess, the **guesser** gets SM-2 review credit on that word in
   their own copy of the bank if they own/cloned it — `correct_count++`, push
   `next_review_at` out per the SM-2 schedule. A correct recall under time
   pressure is strong evidence of mastery.
4. General banks (`kind = "general"`) keep the V1 behavior (draw the term, guess
   the term, definition at reveal); SM-2 credit there is weaker signal, so it
   stays off in V1.5.

### SM-2 write-back

Reuse the existing `/api/vocab/review/[id]` scheduling logic (do not reinvent
SM-2). New internal path: when a guesser correctly guesses a language-bank word
they own, enqueue a review event `{ wordId, correct: true, source: "party" }`.
Batch-apply at round end so a hot round does not hammer the DB. Words the
guesser does not own (it was the drawer's bank) are skipped — no cross-user SR
writes.

### End-of-game study summary

On the `GameOverScreen`, add a per-player line for bank rounds: "You reviewed 9
words tonight, 7 recalled." Pulls from the round's bank-word events. Zero-state
hidden. This is the receipt that makes the study value legible.

### Open questions for V1.5

- Match leniency: accept translation as well as the foreign word, or word-only?
  Recommend a host toggle, default word-only for real drill value.
- Accent/diacritic handling on guesses (`perro` vs `pérro`): normalize before
  the Levenshtein compare (the vocab review path may already do this — check).
- Should the drawer also get SR credit (they had to recall the word to draw it)?
  Lean no — drawing is recognition, not recall. Keep credit to guessers.

---

## V2 — roadmap (not specced in detail)

- **Multi-bank select** per player (lift the 2-pick cap for banks, or a separate
  bank slot).
- **Public / Discover banks** usable directly in a room without cloning first
  (read-only source; no SR write-back since you do not own it).
- **Player-pooled banks with consent** — a "share your bank with this room?"
  prompt so a whole study group can pool one deck, with the privacy step.
- **Confidence-weighted draw** — bias bank-word selection toward words the owner
  is `shaky`/`struggling` on (their `self_confidence` / due `next_review_at`),
  so the game preferentially drills what you are weak on.
- **Bank-only game mode** with a drawability pre-filter or a "skip, undrawable"
  vote so a pure-bank game does not stall on abstract words.

---

## Cross-platform

Web-only, consistent with Party's web-first stance. The schema additions are
platform-neutral (`sketch_rounds` columns + reads from `vocab_*`), so the
eventual iOS Party port inherits the source-selection model for free; only the
picker UI + draw/reveal surfaces need native builds. Tracked in `IOS_PARITY.md`.

## Cost

Zero API. All internal data plumbing (`vocab_words` → the sketch round flow).
No OpenAI/Anthropic spend in V1 or V1.5.
