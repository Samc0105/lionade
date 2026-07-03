-- 20260702090000_web_features_ledger_types.sql
-- ============================================================
-- HELD: apply manually (Sam) via the Supabase SQL editor. UNAPPLIED.
-- MUST be applied AFTER 20260618130000_coin_tx_types_and_competitive_settle.sql
-- (which is itself still unapplied) -- this migration re-states the FULL type
-- allowlist from that file plus the four new types below, so applying this one
-- alone would "work" but the ordering keeps the widening history linear and the
-- per-migration intent auditable.
--
-- WHY: the 2026-07-02 web feature batch introduces four new server-authoritative
-- Fang movements that need ledger rows in coin_transactions:
--   focus_room_bonus   -- group focus-room completion bonus credit
--   pact_milestone     -- study-pact milestone reward credit
--   set_tip_sent       -- Fang tip debit from a set/tip sender
--   set_tip_received   -- Fang tip credit to the set author/recipient
-- The coin_transactions type CHECK is an allowlist; without this widening every
-- insert of those types is rejected. Routes FAIL-SOFT until applied (feature
-- works, reward/tip skipped, honest UI copy) per house rules.
--
-- ALSO IN THIS FILE: update_user_coins gains a 'tip_spend' source (cashable-only
-- debit that never counts toward lifetime_fangs_spent) — see the second section
-- below for the full rationale.
--
-- Idempotent: drop constraint if exists, then re-add. This is a pure WIDENING
-- (superset of the 20260618130000 list), so every existing row already passes.
-- ADD ... NOT VALID + VALIDATE avoids a long ACCESS-EXCLUSIVE validation scan;
-- run off-peak regardless.

-- ── Widen the type CHECK constraint ─────────────────────────────────────────
-- Full list = the 36-type list from 20260618130000 UNION the 4 new types
-- (focus_room_bonus, pact_milestone, set_tip_received, set_tip_sent),
-- kept alphabetical.
alter table coin_transactions drop constraint if exists coin_transactions_type_check;
alter table coin_transactions add constraint coin_transactions_type_check
  check (type = any (array[
    'admin_adjustment','arena_loss','arena_win','badge_bonus','bet_placed','bet_won',
    'bounty_reward','bounty_stake','competitive_match','daily_bonus','daily_drill',
    'daily_spin','duel_loss','duel_win','exam_session','fang_iap_purchase',
    'fang_iap_refund','focus_room_bonus','focus_session','founder_badge_grant',
    'game_reward','login_bonus','mastery_session','mission_reward','ninny_abandon',
    'ninny_refund','ninny_session','ninny_unlock','pact_milestone','quiz_reward',
    'reward','set_tip_received','set_tip_sent','shop_purchase','shop_refund',
    'signup_bonus','streak_bonus','streak_milestone','streak_revive','vocab_clone',
    'vocab_review','vocab_save'
  ]::text[])) not valid;
alter table coin_transactions validate constraint coin_transactions_type_check;

-- ── update_user_coins: add the 'tip_spend' source ────────────────────────────
-- Base definition: migration 072_spend_refund_source.sql (applied to prod).
-- This is a STRICT SUPERSET: every existing branch (cashable / iap / spend /
-- spend_refund) is byte-identical to 072; only the new 'tip_spend' elsif and
-- its comment are added. CREATE OR REPLACE keeps it idempotent.
--
-- WHY 'tip_spend' exists (vs reusing 'spend'):
--   1. Tips debit CASHABLE ONLY — no iap dip. 'spend' lets the debit fall
--      through into fangs_iap, which would let paired accounts launder
--      purchased (iap) Fangs into another account's CASHABLE balance via the
--      tip credit, i.e. convert card money into cash-out-eligible Fangs.
--   2. Tips do NOT increment lifetime_fangs_spent. Tips are transfers, not
--      consumption — counting them would let paired accounts tip back and
--      forth to pump the cash-out eligibility gate's spend counter for free.
-- Insufficient CASHABLE balance (even with plenty of iap Fangs) means no row
-- matches, so the function raises insufficient_coins (P0001) — the tip route
-- surfaces "Not enough Fangs".
--
-- FAIL-SOFT: until this file is applied, the deployed RPC raises
-- 'invalid_source: tip_spend' (P0001) BEFORE any balance moves; the tip route
-- catches that and answers tipsPending with honest copy.

create or replace function public.update_user_coins(
  p_user_id uuid,
  p_delta integer,
  p_min_balance integer default 0,
  p_source text default 'cashable'
)
returns table (new_coins integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_coins integer;
  v_role text := coalesce(auth.role(), '');
begin
  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden: caller % cannot mutate user %', auth.uid(), p_user_id
        using errcode = '42501';
    end if;
    if p_source <> 'spend' then
      raise exception 'forbidden: non-service caller may only call source=spend'
        using errcode = '42501';
    end if;
    if p_delta >= 0 then
      raise exception 'forbidden: non-service caller may only debit (p_delta < 0)'
        using errcode = '42501';
    end if;
  end if;

  if p_min_balance < 0 then
    raise exception 'invalid_min_balance: must be >= 0'
      using errcode = 'P0001';
  end if;

  if p_source = 'cashable' then
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'iap' then
    update profiles
      set coins = coins + p_delta,
          fangs_iap = greatest(0, fangs_iap + p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'spend' then
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta),
          fangs_iap = case
                        when fangs_cashable + p_delta < 0
                        then fangs_iap + (fangs_cashable + p_delta)
                        else fangs_iap
                      end,
          lifetime_fangs_spent = lifetime_fangs_spent + abs(p_delta)
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'spend_refund' then
    -- Reverse a prior spend. p_delta is expected POSITIVE (a credit). Credits
    -- cashable and unwinds the lifetime spend counter (clamped at 0).
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = greatest(0, fangs_cashable + p_delta),
          lifetime_fangs_spent = greatest(0, lifetime_fangs_spent - abs(p_delta))
      where id = p_user_id
        and coins + p_delta >= p_min_balance
      returning coins into v_new_coins;

  elsif p_source = 'tip_spend' then
    -- Fang tip debit. CASHABLE ONLY — never dips into fangs_iap (blocks
    -- iap -> cashable laundering through the tip credit) and does NOT touch
    -- lifetime_fangs_spent (tips are transfers, not consumption — counting
    -- them would let paired accounts pump the cash-out eligibility gate).
    -- The fangs_cashable guard makes "not enough cashable" raise
    -- insufficient_coins instead of clamping.
    update profiles
      set coins = coins + p_delta,
          fangs_cashable = fangs_cashable + p_delta
      where id = p_user_id
        and coins + p_delta >= p_min_balance
        and fangs_cashable + p_delta >= 0
      returning coins into v_new_coins;

  else
    raise exception 'invalid_source: %', p_source
      using errcode = 'P0001';
  end if;

  if v_new_coins is null then
    raise exception 'insufficient_coins'
      using errcode = 'P0001';
  end if;

  return query select v_new_coins;
end;
$$;

revoke execute on function public.update_user_coins(uuid, integer, integer, text) from public, authenticated, anon;
grant execute on function public.update_user_coins(uuid, integer, integer, text) to service_role;
