-- 20260618130000_coin_tx_types_and_competitive_settle.sql
-- ============================================================
-- WEB migration. RUN MANUALLY (Sam) via the Supabase SQL editor. UNAPPLIED.
-- Idempotent (drop-if-exists / create-if-not-exists / create-or-replace).
-- Sorts AFTER 20260618120000_mastery_server_backlog.sql.
--
-- APPLY THIS BEFORE merging/relying on feat/server-backlog AND before turning on
-- live Stripe Fang purchases — three things depend on it, all rooted in one bug:
-- the coin_transactions type CHECK constraint (last set in 057_admin_console.sql)
-- REJECTS 10 type values the app actually writes, so every one of those ledger
-- inserts has been SILENTLY failing in prod (best-effort, swallowed) -> audit
-- drift, AND it makes the arena settle dedup (competitive_match) and the Fang
-- IAP credit (fang_iap_purchase) no-ops / hard failures.
--
-- Verified live constraint was missing: bet_placed, bet_won, competitive_match,
-- founder_badge_grant, ninny_abandon, ninny_refund, vocab_clone, vocab_review,
-- vocab_save, fang_iap_purchase.
--
--   (1) Widen coin_transactions_type_check to the full set the code emits.
--   (2) Partial UNIQUE index for the competitive_match per-(user,match) dedup.
--   (3) settle_competitive_credit RPC: atomic marker-insert + cashable credit.

-- ── (1) Widen the type CHECK constraint ─────────────────────────────────────
-- A widening: every existing row already satisfies the old (narrower) set, so
-- ADD ... NOT VALID + VALIDATE is safe and avoids a long ACCESS-EXCLUSIVE scan.
-- Run off-peak regardless. The list below is the UNION of the prior live set and
-- every type literal the app inserts into coin_transactions (TS + RPCs), plus
-- 'reward' (credit_user_coins_logged default) and 'fang_iap_refund' (Apple
-- refund hook) for forward-safety.
alter table coin_transactions drop constraint if exists coin_transactions_type_check;
alter table coin_transactions add constraint coin_transactions_type_check
  check (type = any (array[
    'admin_adjustment','arena_loss','arena_win','badge_bonus','bet_placed','bet_won',
    'bounty_reward','bounty_stake','competitive_match','daily_bonus','daily_drill',
    'daily_spin','duel_loss','duel_win','exam_session','fang_iap_purchase',
    'fang_iap_refund','focus_session','founder_badge_grant','game_reward','login_bonus',
    'mastery_session','mission_reward','ninny_abandon','ninny_refund','ninny_session',
    'ninny_unlock','quiz_reward','reward','shop_purchase','shop_refund','signup_bonus',
    'streak_bonus','streak_milestone','streak_revive','vocab_clone','vocab_review','vocab_save'
  ]::text[])) not valid;
alter table coin_transactions validate constraint coin_transactions_type_check;

-- ── (2) Per-(user,match) dedup index for competitive settlement ─────────────
-- Because the old constraint rejected every 'competitive_match' insert, there
-- are ZERO such rows today, so this index creates cleanly. It is the atomic
-- dedup key settle_competitive_credit relies on.
create unique index if not exists uq_coin_tx_competitive_match
  on coin_transactions (user_id, reference_id)
  where type = 'competitive_match';

-- ── (3) Atomic per-user competitive settlement credit ───────────────────────
-- ONE transaction: insert the (user, match) marker ON CONFLICT DO NOTHING, and
-- ONLY if it inserted, apply the cashable balance delta (clamped >= 0) and stamp
-- the effective amount onto the marker. So a duplicate / concurrent / resumed
-- settle is a guaranteed no-op (returns credited:false) — no double Fang credit,
-- and the caller skips the ELO write too. Mirrors the cashable branch of
-- update_user_coins (072): coins + fangs_cashable move together; lifetime_*
-- counters are untouched (a wager win/loss is not a cash-out "spend"). Migration
-- 078's profiles guard allows auth.role()='service_role' through. SECURITY
-- DEFINER, service_role-only, search_path pinned.
create or replace function public.settle_competitive_credit(
  p_user_id     uuid,
  p_match_id    uuid,
  p_delta       integer,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txn_id    uuid;
  v_coins     integer;
  v_effective integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: service role only' using errcode = '42501';
  end if;

  -- Atomic claim: one marker per (user_id, reference_id) where type matches the
  -- partial unique index. A duplicate/concurrent settle inserts nothing.
  insert into coin_transactions (user_id, amount, type, reference_id, description)
  values (p_user_id, 0, 'competitive_match', p_match_id, p_description)
  on conflict (user_id, reference_id) where type = 'competitive_match' do nothing
  returning id into v_txn_id;

  if v_txn_id is null then
    -- Already settled for this (user, match): no-op.
    return jsonb_build_object('credited', false, 'effective', 0);
  end if;

  -- We won the claim. Read + clamp + apply, all in this txn (row-locked).
  select coins into v_coins from profiles where id = p_user_id for update;
  if v_coins is null then
    -- Profile vanished mid-settle: keep the (amount 0) marker so a retry won't
    -- re-credit, and report a zero effective credit.
    return jsonb_build_object('credited', true, 'effective', 0);
  end if;

  v_effective := greatest(0, v_coins + p_delta) - v_coins;

  update profiles
     set coins = coins + v_effective,
         fangs_cashable = greatest(0, fangs_cashable + v_effective)
   where id = p_user_id;

  update coin_transactions set amount = v_effective where id = v_txn_id;

  return jsonb_build_object('credited', true, 'effective', v_effective);
end;
$$;

revoke execute on function public.settle_competitive_credit(uuid, uuid, integer, text) from public, anon, authenticated;
grant  execute on function public.settle_competitive_credit(uuid, uuid, integer, text) to service_role;
