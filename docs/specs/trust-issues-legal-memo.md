## Trust Issues Redesign: Legal/Compliance Memo (formerly Poker Face)

Status: draft, awaiting lawyer review before V1 ships
Author: business-legal-compliance (NOT an attorney)
Date: 2026-05-31 (renamed from poker-face-legal-memo.md on rename of game to "Trust Issues")

## Locked Answers (2026-05-31)

- **Game name → "Trust Issues" (LOCKED).** Strengthens the regulatory posture — the name no longer evokes casino play, which matters for App Store review and state-AG keyword sweeps.
- **No Fang stakes in V1.** XP + leaderboard only. Pass first App Store review on the safest possible framing.
- **Banned casino vocabulary in user-facing copy:** poker, bluff, ante, call (as verdict), fold, chips, pot, jackpot, all-in, casino, bet, wager. The verb "bluff" stays in INTERNAL mechanical docs (this memo + the spec) but never in UI, marketing, or store listings.
- **Preferred vocabulary:** stake, prize, round, claim, challenge, reveal, believe, doubt, reward.

### 1. Verdict (no Fang stakes)

The pure asymmetric-information redesign, with XP and leaderboard only, clears our prior gambling-adjacency flag. Skill-and-deception game, no consideration changing hands per round. The rename to **Trust Issues** also strengthens the regulatory posture: the name itself no longer evokes casino play.

### 2. With Fang stakes

If both players stake 50 Fangs and winner takes the prize:

- **US/UK gambling law.** Fangs are non-redeemable virtual currency with no cash-out path in V1, so the "prize of value" prong of most state gambling tests is not met. Keeps Fang-staked Trust Issues outside the classic three-prong (consideration + chance + prize) definition in most states. Caveat: a few states (WA in particular) have stretched "thing of value" to include in-game advantage. Lawyer review required before enabling stakes.
- **Apple Guideline 5.3.** Targets real-money gaming. Non-redeemable virtual stakes are generally permitted, but Apple has rejected apps that simulate casino mechanics even with virtual currency. A deceive/doubt loop with a stake and prize reads as casino-adjacent regardless of branding. Material risk; the rename to Trust Issues helps but does not eliminate it.
- **COPPA.** 13+ gated at signup; COPPA not triggered. No extra disclosure needed.
- **Age-gating.** Even with virtual stakes, "deceive, stake, winner takes all" can read as teaching minors casino play. Keep the 13+ gate firm; avoid visuals or copy mimicking chips, felt, or poker tables.

### 3. App Store framing: banned vs safer language

**Banned** in any UI / marketing / store listing copy: bet, ante, pot, wager, bluff, call, fold, jackpot, all-in, chips, casino, poker.

**Prefer:** stake, prize, round, claim, challenge, reveal, believe, doubt, reward.

The verb "bluff" appears in INTERNAL mechanical documentation ("the Knower chooses to bluff or tell the truth") which is fine — it's a description of game theory, not user-facing copy. It must never appear in a button label, screen title, push notification, App Store description, or marketing email.

UI must never show chip piles or a felt table. Use existing Lionade card art and the Fang glyph only.

### 4. V1 recommendation

Ship XP and leaderboard only. No Fang stake, no prize pool, no stake language. Pass first App Store review on the iOS port with the safest possible framing. After 30+ days live and clean, revisit a capped Fang-stake mode (web first, iOS gated behind separate review) with explicit legal sign-off.

### 5. Open questions for a real lawyer

- Confirm non-redeemable Fangs are not "a thing of value" under WA, IL, and NY law.
- Whether a future Fangs to cash conversion (V2) retroactively reclassifies past Fang-staked rounds.
- Whether a rated ladder with Fang stakes triggers contest/sweepstakes registration in any state.
- UK Gambling Commission position on virtual-currency staking in skill-with-deception games.
- Apple App Review precedent on deception mechanics with virtual stakes.
