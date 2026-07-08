-- Compete audit P1-1 (2026-07-08): add 'bet_refunded' to the coin_transactions
-- type allowlist so the new /api/cron/expire-daily-bets reaper can write an
-- audit row when it refunds an abandoned daily bet. Purely additive — every
-- existing row already satisfies the wider allowlist, so no data is at risk.

ALTER TABLE coin_transactions DROP CONSTRAINT IF EXISTS coin_transactions_type_check;

ALTER TABLE coin_transactions ADD CONSTRAINT coin_transactions_type_check CHECK (
  type = ANY (ARRAY[
    'admin_adjustment','arena_loss','arena_win','badge_bonus','bet_placed',
    'bet_refunded','bet_won','bounty_reward','bounty_stake','competitive_match',
    'daily_bonus','daily_drill','daily_spin','duel_loss','duel_win','exam_session',
    'fang_iap_purchase','fang_iap_refund','focus_room_bonus','focus_session',
    'founder_badge_grant','game_reward','login_bonus','mastery_session',
    'mission_reward','ninny_abandon','ninny_refund','ninny_session','ninny_unlock',
    'pact_milestone','quiz_reward','referral_bonus','referral_reward','reward',
    'set_tip_received','set_tip_sent','shop_purchase','shop_refund','signup_bonus',
    'streak_bonus','streak_milestone','streak_revive','vocab_clone','vocab_review',
    'vocab_save'
  ]::text[])
);
