-- Migration: Mastery Hint Pack consumer (makes boost_mastery_hint_pack real).
--
-- The shop sells "Mastery Hint Pack" (boost_mastery_hint_pack, 900 Fangs, 5
-- hints) but nothing consumed it, so it was gated "Coming Soon". This adds the
-- server-owned counter + the grant/consume primitives so the Mastery Mode
-- "Reveal a hint" action (eliminate a wrong MCQ option) works, after which the
-- shop gate is removed.
--
-- STORAGE: profiles.mastery_hints_remaining (integer, default 0).
--
-- FORGE GUARD: profiles has table-level UPDATE for `authenticated`, so — exactly
-- like the equipped_* pointers (migration 064) — a client could self-grant hints
-- via a direct supabase.from('profiles').update(). We EXTEND the existing
-- guard_profile_equipped trigger to also pin this column: authenticated INSERTs
-- force it to 0, and authenticated UPDATEs that change it are rejected. Only the
-- service-role routes (purchase grant + /hint consume, via the RPCs below) move
-- it. The function body below is the live prod definition with ONLY the two
-- mastery_hints lines added.
--
-- ATOMICITY: grant_mastery_hints / consume_mastery_hint do the +/- in a single
-- UPDATE so concurrent tabs can't lose or over-spend a hint. consume returns the
-- new remaining count, or -1 when the user has none (so the route 400s cleanly).

alter table profiles
  add column if not exists mastery_hints_remaining integer not null default 0;

create or replace function public.guard_profile_equipped()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' then
      new.equipped_frame       := null;
      new.equipped_name_color  := null;
      new.equipped_banner      := null;
      new.equipped_avatar_aura := null;
      -- Consumable counter: a client cannot pre-seed hints on insert.
      new.mastery_hints_remaining := 0;
    else
      if new.equipped_frame            is distinct from old.equipped_frame
        or new.equipped_name_color     is distinct from old.equipped_name_color
        or new.equipped_banner         is distinct from old.equipped_banner
        or new.equipped_avatar_aura    is distinct from old.equipped_avatar_aura
        or new.equipped_username_effect is distinct from old.equipped_username_effect
        or new.mastery_hints_remaining  is distinct from old.mastery_hints_remaining then
        raise exception 'forbidden: equipped cosmetics / hint counter can only be changed via their server routes'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- Grant N hints (called by the service-role shop purchase route on a successful
-- boost_mastery_hint_pack buy). Negative deltas are clamped to 0.
create or replace function public.grant_mastery_hints(p_user_id uuid, p_delta integer)
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare v_new integer;
begin
  update profiles
    set mastery_hints_remaining = mastery_hints_remaining + greatest(0, p_delta)
    where id = p_user_id
    returning mastery_hints_remaining into v_new;
  return coalesce(v_new, 0);
end;
$function$;

-- Consume exactly one hint atomically. Returns the new remaining count, or -1 if
-- the user has none (the /hint route maps -1 -> 400 "no hints left").
create or replace function public.consume_mastery_hint(p_user_id uuid)
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare v_new integer;
begin
  update profiles
    set mastery_hints_remaining = mastery_hints_remaining - 1
    where id = p_user_id and mastery_hints_remaining > 0
    returning mastery_hints_remaining into v_new;
  if v_new is null then
    return -1;
  end if;
  return v_new;
end;
$function$;

-- Lock down the RPCs: service-role only (the routes call them via supabaseAdmin).
revoke all on function public.grant_mastery_hints(uuid, integer)  from public, anon, authenticated;
grant execute on function public.grant_mastery_hints(uuid, integer)  to service_role;
revoke all on function public.consume_mastery_hint(uuid)             from public, anon, authenticated;
grant execute on function public.consume_mastery_hint(uuid)          to service_role;
