# Daily Spin — Proposal & Spec

**Author:** Sam · **Date:** 2026-05-03
**Status:** Spec locked — ready for implementation scoping

---

## 1. The Idea

A daily prize wheel that gives users a reason to come back every 24 hours, independent of "did I do my study quotas today." One spin per 24h, server-rolled, no re-spins. Combines the Vegas hook (anticipation + variable reward) with two real downside outcomes (Bust and Tax Man) so it doesn't feel like a free-money button.

Sits alongside Daily Quiz, Daily Drill, and Daily Clock-In as the fourth daily-return ritual — each pulls a slightly different psychological lever:

| Daily ritual | Lever |
|---|---|
| Daily Quiz | Streak / habit |
| Daily Drill | Quick warmup, low effort |
| Daily Clock-In | Show-up reward |
| **Daily Spin (new)** | **Variable reward / gambling thrill** |

---

## 2. The Wheel — Final Spec

10 slots, weighted probabilities, summing to 100%.

| Slot | Probability | Outcome | Emotional vibe |
|---|---|---|---|
| Small Fangs (50–150F random) | 30% | +50–150F | "Nice, free Fangs" |
| **Bust** | **8%** | **−500F flat** | "Bro that's it?" |
| Medium Fangs (200–400F random) | 20% | +200–400F | Solid pull |
| Booster (random — Coin Rush / XP Surge / Lucky Start) | 15% | +1 booster | Useful |
| Big Fangs (500–1,000F random) | 12% | +500–1,000F | Good run |
| Mega Fangs | 5% | +2,000F | Hyped |
| Streak Shield (1 day) | 3% | +1 mini-shield | Clutch |
| Rare cosmetic drop | 3% | +random rare item | Lucky |
| **Tax Man** | **2%** | **−33% of current Fangs** | "OH FUCK" |
| **JACKPOT** | **2%** | **+10,000F** | "LFG" |
| **Total** | **100%** | | |

### Two distinct flavors of "bad"

The wheel deliberately has **two different downside slots** at very different magnitudes:

- **Bust (8%, flat −500F):** small, predictable sting. Everyone feels exactly the same hit regardless of wealth. Roughly equivalent to losing 5 quizzes worth of grinding.
- **Tax Man (2%, scaling −33%):** rare but devastating. Scales with your holdings — a hoarder with 100K Fangs loses 33K on a single unlucky pull. The casino-roulette moment.

This pairing is intentional: the 8% Bust hits *casuals* meaningfully (they only have a few hundred Fangs) but barely affects whales. The 2% Tax Man barely affects casuals (they don't have much to lose) but devastates whales. Every player type gets calibrated stakes.

### Edge-case handling

- **Bust on a sub-500F balance:** clamp to 0. Never push a user into negative Fangs. If you have 200F and pull Bust, you go to 0F (not −300F).
- **Tax Man on a sub-1,500F balance:** still applies (33% of whatever you have). On 0F, Tax Man is functionally a Bust — not a no-op, displayed honestly.
- **No respin at all:** flat one-and-done per 24h. Removes the "compounding losses" risk and keeps the daily ritual sacred.

---

## 3. Why This Specific Ratio

### EV math (at average user holding ~50,000F)

| Component | Math | Contribution |
|---|---|---|
| Small Fangs | 30% × ~100F | +30F |
| Bust | 8% × −500F | −40F |
| Medium Fangs | 20% × ~300F | +60F |
| Booster (≈75F equivalent) | 15% × 75F | +11F |
| Big Fangs | 12% × 750F | +90F |
| Mega Fangs | 5% × 2,000F | +100F |
| Streak Shield (≈200F equiv) | 3% × 200F | +6F |
| Rare cosmetic (≈600F equiv) | 3% × 600F | +18F |
| Tax Man (50K avg holdings) | 2% × −16,500F | −330F |
| Jackpot | 2% × 10,000F | +200F |
| **Net EV per spin** | | **~+145F** |

That's roughly 1.5 quizzes worth of Fangs as the average outcome — meaningful but not economy-breaking. At 50K daily spinners, that's ~7M Fangs/day of net new currency, which the upcoming shop rebalance + booster sinks should comfortably absorb.

### Psychology balance

- **90% of spins feel positive** (any non-Bust, non-Tax-Man slot)
- **8% feel like a meh consolation** (Bust)
- **2% feel devastating** (Tax Man)
- **2% feel like winning the lottery** (Jackpot)

Variable reward + asymmetric outcomes is the exact pattern that drives slot machines, Hearthstone packs, and Fortnite chests. The 2% Jackpot symmetric with the 2% Tax Man means *every spin has equal probability of heaven and hell*, which is the cleanest possible Vegas hook.

---

## 4. Mechanics

| Rule | Spec |
|---|---|
| Cooldown | 1 free spin per 24h, rolling (not midnight-reset) |
| Re-spins | **None.** One and done. |
| Banking missed days | No — use it or lose it (drives daily return) |
| RNG location | **Server-side only** (`/api/spin/roll`) |
| Cheat protection | Outcome computed on server, returned as a token; client animates the wheel landing on the precomputed result |
| Streak interaction | Spinning does not affect (or extend) any streak — it's its own ritual |
| Plan multipliers | Pro: +25% to any positive Fangs payout · Platinum: +50%. Tax Man and Bust are NOT reduced for paid plans (the gamble is the gamble) |

---

## 5. Schema & Route

### Migration

```sql
-- lib/migrations/047_daily_spin.sql
create table daily_spins (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  spun_at         timestamptz not null default now(),
  outcome         text not null check (outcome in (
    'small_fangs','bust','medium_fangs','booster',
    'big_fangs','mega_fangs','streak_shield','rare_cosmetic',
    'tax_man','jackpot'
  )),
  fangs_delta     int not null,           -- positive or negative
  reward_payload  jsonb,                  -- booster id, cosmetic id, etc. (nullable)
  user_balance_before int not null,
  user_balance_after  int not null,
  created_at      timestamptz not null default now()
);

create index daily_spins_user_spun_idx on daily_spins (user_id, spun_at desc);

-- 24h cooldown — used by the API to gate spins
create or replace function last_spin_at(p_user_id uuid)
returns timestamptz language sql stable as $$
  select max(spun_at) from daily_spins where user_id = p_user_id
$$;
```

### API route — `app/api/spin/roll/route.ts`

```
POST /api/spin/roll
  → Auth required
  → Check last_spin_at(user) >= now() - 24h → return 429 "Cooldown" if true
  → Roll outcome server-side using weighted RNG
  → Apply Fangs delta (clamped at 0 minimum)
  → Insert daily_spins row + coin_transactions audit row
  → Return { outcome, fangs_delta, balance_after, reward_payload?, animation_seed }

GET /api/spin/status
  → Returns { can_spin: bool, next_spin_at: timestamptz, last_outcome?: ... }
```

`animation_seed` is a deterministic value the client uses to pick the wheel-landing animation — server decides outcome, client just animates the result.

### UI surface

- New page: `app/spin/page.tsx` — full-page wheel with animation
- Dashboard widget: small "Spin Available" pill on the dashboard hero when `can_spin === true`
- Result modal: shows the outcome with appropriate animation (gold particles for Jackpot, sad lion for Tax Man, "you got X Fangs" toast for everything else)

---

## 6. Where This Plugs Into the Master Plan

This is the §9.5 feature from `LIONADE_MASTER_PLAN.md`. It serves three pillars:

- **Grow pillar** — fourth daily-return ritual; high-engagement Fangs faucet with built-in spend sinks (the Bust + Tax Man slots remove Fangs from the economy, helping prevent inflation as users earn more elsewhere)
- **Pro/Platinum upgrade lever** — paid plans get a +25% / +50% boost to positive payouts, but eat the same downside. Real reason to upgrade beyond the existing multipliers.
- **Anti-inflation** — the two negative slots are net-deflationary on the Fangs supply, which partially offsets the wheel's positive EV. Helps the broader economy stay tight.

Expected impact:
- **DAU lift:** +5–10% from the daily-return ritual alone (comparable: Snapchat's daily streak rewards lift DAU ~7% per Sensor Tower benchmarks)
- **Pro conversion lift:** +0.5 pp from the paid-plan payout boost
- **Fangs supply growth:** +7M/day at 50K DAU — manageable IF the shop rebalance ships first

---

## 7. Open Questions

1. **Should free users get the spin at all, or is it Pro+?** Recommended: free users get it (it's the daily ritual hook); paid plans just get bigger payouts.
2. **Visual reveal style** — wheel with click-clack tick, slot machine, mystery box, or scratch-off? Wheel is most iconic but slot machine animations are punchier per-frame. Recommend wheel for the iconography (ties to "spin").
3. **Sound design** — tick-clack on slow-down + distinct sounds per outcome (Bust = sad horn, Tax Man = dramatic deep boom, Jackpot = coin shower). Minor but moves the dial on dopamine.
4. **Should rare cosmetic drops include items already owned?** Recommendation: never re-drop owned items. If user has all rares, that slot rolls into a 1,000F payout instead.
5. **Push notification at cooldown end** — "your spin is ready" 24h after last spin. Probably yes for Pro+; might be intrusive for free users — make it a settings toggle.

---

## 8. Recommended Next Step

Lock the spec, ship in 1.5–2 weeks:

- Day 1–2: migration `047_daily_spin.sql` + `/api/spin/roll` route with weighted RNG
- Day 3–5: `app/spin/page.tsx` page + wheel component + result modal
- Day 6–7: dashboard widget + push notification (if going forward) + edge-case testing
- Day 8: shop rebalance ships in parallel (separate work) so the new Fangs supply has a sink
- Day 9–10: QA, internal team test, push to prod

Total realistic effort: **~1.5 weeks of focused engineering** plus a half-week of polish/QA.

---

*Linked: `LIONADE_MASTER_PLAN.md` §9.5 (Daily Spin in roadmap), §6 (Fangs economy), §7 (cost structure). Proposal companion: `FOCUS_MODE_PROPOSAL.md`.*
