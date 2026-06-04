# Word Banks → Games Integration Spec

Status: spec, draft 2026-06-04
Owner: product-strategist (decisions), dev-frontend + dev-backend (build)
Source: Sam ask 2026-06-04 — "link the words bank with the game ones. That way u could do in like wordle or like other stuff, and flash card. Games like everything."

## 1. The product idea in one sentence

Every Word Bank a user creates (Spanish vocab, AWS Security Specialty, Math Theorems, Hacking 101, etc.) becomes playable content in Lionade's existing game modes — Flashcards, Roardle, Mastery, Quiz, Sketchy, Trust Issues. The user's personal study material becomes the engine of every game.

## 2. Why this is a strategic move

- **Single-content-many-games**: a user adds "SAML" once to their AWS bank, plays it as a flashcard, then as a Mastery question, then as a Roardle puzzle if it's 5 letters, then as a Trust Issues card. One content investment, six places of dopamine.
- **Locks in the user's data investment**: once you've built a 200-term AWS bank, you're not leaving Lionade. Every game gets stronger.
- **Pedagogically strongest**: spaced repetition + multi-modal retrieval is the gold standard of long-term retention.
- **Differentiation**: Quizlet does flashcards. Duolingo does language. Anki does SR. NOBODY does "your study material → every game type" with this depth.

## 3. Per-game integration table

| Game | How banks plug in | Required bank shape | New work |
|---|---|---|---|
| **Flashcards** (existing) | User picks a bank as the deck. Card front = term, back = canonical answer + their own user_definition | Any bank | Low — flashcard system already exists; just add a "Use a Word Bank" deck-picker option |
| **Roardle** | Filter the user's bank for words matching the target length (5 letters for classic, configurable for variants). Daily puzzle pool draws from filtered set. | Words ≥ 4 chars | Medium — needs a "is this word eligible" filter + bank-picker in the Roardle setup screen |
| **Mastery Mode** | When a user creates a Mastery exam, offer "Generate from one of my Word Banks" as a source option. AI uses bank terms + user_definitions as the curriculum. | Any bank with ≥ 20 terms | High — needs a new "from-bank" pathway in the exam-create flow; AI prompt change |
| **Quiz** (general) | Generate MCQs from bank terms with the canonical answer as correct + AI-generated distractors. Cache distractors per-term so it's $0.0005 once-ever per question. | Any bank | Medium — needs distractor generation + caching, then plug into existing quiz route |
| **Sketchy** | Use bank terms as drawing prompts (esp. good for visual subjects: anatomy, geography, AWS architecture diagrams). Bank's prompt pool replaces / supplements the default Sketchy word list. | General banks with concrete terms | Medium — wire bank-id into Sketchy round-create |
| **Trust Issues** | Bank term as the truth card; AI generates 3 lies as distractors; Knower picks one to say. | Any bank | Medium — wire bank-id into Trust Issues round-create + AI distractor gen |
| **Lionade-Pardy** (new, queued) | Each bank category becomes a column on the Jeopardy board. Tiles with point values = questions from that bank. | Banks with ≥ 5 terms | High — depends on Lionade-Pardy engine shipping first |

## 4. UX surfaces

### 4a. "Play with this bank" button on every bank
On `/learn/vocab/?bank=<slug>`, add a "🎮 Play" menu in the bank header:
- Practice (flashcards) — existing
- Roardle this bank
- Sketchy with this bank
- Trust Issues with this bank
- Generate a Quiz from this bank
- Create a Mastery exam from this bank

Clicking any option routes to the right game with the bank pre-selected.

### 4b. "Choose a Word Bank" picker on every game's setup screen
Every game that supports bank-integration gets a "Use a Word Bank" toggle in its setup. Default = system content (the existing Roardle words, default Sketchy prompts, etc.). When the user toggles on, a bank-picker dropdown lists their banks + cloned public banks they've adopted.

### 4c. "Banks I've used" section in Profile
A small surface on the profile page that shows which banks the user has played from, with stats (games played per bank, words mastered per bank). Drives engagement loop.

## 5. Technical contract

### Bank → game routing
- Every bank has a stable `slug` (already in V2 schema)
- Game URLs accept a `?bank=<slug>` query param: `/games/roardle?bank=aws-security`, `/games/sketchy?bank=spanish-starter`, etc.
- The game's setup logic reads the bank, validates it's compatible (length filter for Roardle, term count for Mastery, etc.), and falls back gracefully with a toast if not ("This bank doesn't have enough 5-letter words for Roardle — try a different game.")

### Distractor generation (for Quiz + Trust Issues)
- One AI call per term, FIRST time it's needed
- Cached globally in `vocab_distractors_cache (word_lower, source_lang, target_lang, distractors jsonb)` — same table pattern as `vocab_translations_cache`
- Cost: ~$0.0005/term once-ever. At 10k unique terms across all users, $5 lifetime.

### Mastery from-bank pathway
- Mastery already parses an "exam description" into subtopics. Bank-integration short-circuits the parse: bank.name = exam title, bank's terms grouped by definition_source or rarity become subtopics.
- The AI exam-question generator gets the bank's term + user_definition as the source-of-truth context for each question.
- Estimated cost: same as regular Mastery (~$0.04/subtopic of questions). Banks just provide BETTER source material than user-typed exam descriptions.

## 6. V3 phased build plan

### Phase A — Foundation (3 days)
- Add `?bank=<slug>` URL parsing to game setup flows
- Add "Play" menu to bank header
- Add bank-picker toggle to Flashcards, Roardle setup screens (easiest integration)
- `vocab_distractors_cache` table migration

### Phase B — AI distractor generation (3 days)
- `/api/vocab/distractors` route (Wikipedia-like cascade: Wiktionary thesaurus → AI fallback)
- Distractor cache hit logic
- Quiz integration (bank → quiz with bank-distractors)

### Phase C — Generative games (5 days)
- Mastery "from bank" exam-create option
- Trust Issues bank integration
- Sketchy bank-as-prompts (general banks only — language banks don't make sense visually)

### Phase D — Profile + analytics surface (2 days)
- "Banks I've used" section on profile
- Per-bank stats (games played, words mastered, accuracy)
- Drives the engagement-loop visibility

Total: ~13 days of focused build. Sharded into 4 shippable phases. Each phase delivers user-facing value independently.

## 7. Anti-patterns to avoid

- ❌ **Don't auto-import every bank into every game.** User picks. Forcing it creates bad matches (Spanish vocab in Sketchy is awkward).
- ❌ **Don't generate AI content silently.** Cache + cost-cap aggressively. Distractors hit the global cache, NOT a per-user cache.
- ❌ **Don't break the existing default content.** System-default Roardle / Sketchy / Quiz content stays the primary entry point; banks are an opt-in alternative.
- ❌ **Don't gate bank-game integration behind Pro.** This is core product feature, not premium add-on. The differentiated feel is what GETS users to subscribe, not the gate.

## 8. Decisions Sam needs to make before build starts

1. **Phase order:** A → B → C → D is the natural dependency order. Confirm or override.
2. **Bank size minimum to be game-eligible:** propose 5 terms minimum for any game integration (below that, the experience is hollow). Sam may want stricter (10? 20?).
3. **Distractor quality bar:** Wiktionary thesaurus only / AI only / cascade? Recommend cascade — Wiktionary covers ~40% of common terms for free; AI handles the rest.
4. **Profile surface — opt-in or always-on?** Recommend always-on (it's a stats surface, not a privacy surface). Sam may disagree.

## 9. What this does NOT include (queued for V4+)

- User-uploaded content from PDFs auto-becoming a bank (separate spec; covered partially by Mastery PDF parse + the Resume Coach work)
- Community bank ratings / reviews
- Bank co-authoring (multiple users collaborate on one bank)
- Bank → custom-rendered visual content (e.g. bank of chemical formulas auto-rendering as molecule diagrams in Sketchy)

These are real V4+ ideas. Worth tracking in a separate backlog.

---

**Sam's call:** lock or revise this spec, then dispatch Phase A when the lifecycle work fully lands and Resume Coach + Lionade-Pardy ship.
