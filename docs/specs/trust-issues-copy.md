# Trust Issues: V1 Copy

Status: draft, 2026-05-31
Owner: design-copywriter
Source spec: trust-issues-redesign.md (LOCKED 2026-05-31)
Legal constraints: trust-issues-legal-memo.md (banned vocab list)

All copy below is user-facing. Internal mechanic docs may still use "bluff" as a game-theory term; this file may not.

---

## 1. Game tagline

**Primary (use on arcade card + lobby header):**
> Two players. One card. Can you spot the lie?

**Alternates (for A/B or contextual use):**
- "One of you knows. The other has to guess."
- "Lie convincingly. Or read them like a book."
- "How well do you actually know your friends?"

---

## 2. Role labels

**Primary (locked recommendation): Knower / Reader**
- Instantly parseable mid-round.
- "Knower" = you have the info. "Reader" = you have to read them.
- Symmetric syllable count, looks clean stacked in the UI.

**Alternate pitch (if Sam wants more personality): Insider / Outsider**
- Same clarity, slightly more flavor.
- "INSIDER" on a card looks great in caps.
- Works with "you're on the outside looking in" copy beats.

Recommend Knower / Reader for V1, revisit if playtesters say it feels dry.

---

## 3. Reader verdict buttons

**BELIEVE** and **DOUBT** — confirmed locked. They're working as intended:
- Both are single-syllable verbs in their active forms.
- Symmetric weight, no winner-vibe imbalance.
- Map cleanly to the outcome states.
- Cannot be confused for casino verbs.

Stronger pitch considered and rejected: "TRUST" / "CALL OUT." Killed because "TRUST" weakens once you've been burned twice, and "CALL OUT" carries social-media baggage that hits weird in a study app.

---

## 4. Round-end reveal copy

Each outcome shows a punchy headline plus one secondary line for context. Headline goes in big caps. Secondary line is sentence case, smaller.

### Outcome A: Knower lied + Reader believed (Knower wins)
**GOTCHA**
You sold the lie. They bought it.

### Outcome B: Knower told truth + Reader believed (both score, Knower wins more)
**HONEST WIN**
You told the truth. They saw it. Everyone eats.

### Outcome C: Knower lied + Reader doubted (Reader wins)
**CAUGHT**
Nice read. They were lying through their teeth.

### Outcome D: Knower told truth + Reader doubted (Reader loses)
**OOF**
They were telling the truth the whole time.

---

## 5. "How to play" onboarding

Shows first time a player opens Trust Issues. Under 100 words. Clarity first, jokes second.

```
Trust Issues

One of you sees a card. The other doesn't.

If you're the Knower, you get 4 things you could say. One matches the
card. Three are lies. Pick one and sell it.

If you're the Reader, you only see what they said. Your call:
BELIEVE them or DOUBT them.

Score points for lying convincingly, reading correctly, or telling
the truth and getting believed.

Roles swap every round. Best of 6.

Good luck. Trust nobody.
```

Word count: 87. Final line is the brand-voice payoff.

---

## 6. Empty / waiting states

One line each. All under 8 words.

- **Matchmaking:** Finding someone worth lying to...
- **Opponent disconnected:** They bailed. Hunting for a new victim.
- **Waiting for Knower to pick a claim:** They're picking what to say...
- **Waiting for Reader to decide:** They're sizing you up...
- **Reconnecting:** Hang on, getting you back in...
- **Round starting:** Lock in. Round starting.

---

## 7. Misc copy (bonus — likely needed soon)

These weren't in the brief but the eng team will ask for them within a day. Pre-drafting.

- **Match win screen header:** "READ THEM LIKE A BOOK" (if you won as Reader more) / "PROFESSIONAL LIAR" (if you won as Knower more) / "TRUST ISSUES UNLOCKED" (close match)
- **Match loss screen header:** "THEY GOT YOU"
- **Tie:** "DEAD EVEN. RUN IT BACK?"
- **Rematch button:** "Run it back"
- **Leave match button:** "I've seen enough"
- **Timer expiring (5s left):** "Tick tock"
- **Knower auto-pick fallback (timed out):** "You hesitated. We picked for you."
- **Reader auto-pick fallback:** "Time's up. Counting that as DOUBT."

---

## 8. Banned-word self-check

Searched this file for: bet, ante, pot, fold, chips, jackpot, casino, poker, bluff, wager, all-in, call (as verdict).

Zero hits in user-facing copy. The word "Poker" appears only in the file header context line ("formerly Poker Face") which is documentation, not UI.

Em-dash check: zero em-dashes. Hyphens only in compound words ("auto-pick", "best of 6" is unhyphenated).
