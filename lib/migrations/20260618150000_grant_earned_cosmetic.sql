-- Migration: generic earned-cosmetic grant RPC for the "earn a free cosmetic"
-- milestone faucet (a free COMMON aura/frame at a streak / level / mastery
-- milestone, giving non-payers a taste of the cosmetic system).
--
-- ⚠️ NOT YET APPLIED — Sam runs this manually (per the migration policy).
--
-- Unlike grant_streak_emblem / grant_mastery_medal (which RE-VERIFY their
-- condition inside the function), this RPC takes an ARBITRARY cosmetic_id and
-- does NO condition check — the CALLER (a milestone route) is responsible for
-- gating. Therefore it must be callable ONLY by service_role; granting it to
-- `authenticated` would let any user self-grant any cosmetic for free. The
-- milestone routes call it via supabaseAdmin (service role) AFTER verifying the
-- milestone was crossed.
--
-- Idempotent via the existing earned_cosmetics UNIQUE(user_id, cosmetic_id) +
-- ON CONFLICT DO NOTHING, so re-hitting a milestone never re-grants. Returns the
-- inserted cosmetic_id, or NULL when the user already had it (lets callers
-- detect a FRESH unlock to fire a toast later).

create or replace function public.grant_earned_cosmetic(
  p_user_id uuid,
  p_cosmetic_id text,
  p_earned_via text
)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_inserted_id text;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = 'P0001';
  end if;
  if p_cosmetic_id is null or length(p_cosmetic_id) = 0 then
    raise exception 'p_cosmetic_id required' using errcode = 'P0001';
  end if;

  insert into public.earned_cosmetics (user_id, cosmetic_id, earned_via, metadata)
  values (p_user_id, p_cosmetic_id, coalesce(p_earned_via, 'milestone'), '{}'::jsonb)
  on conflict (user_id, cosmetic_id) do nothing
  returning cosmetic_id into v_inserted_id;

  return v_inserted_id; -- null on conflict (already earned)
end;
$function$;

-- service-role ONLY — the caller gates the milestone condition.
revoke all on function public.grant_earned_cosmetic(uuid, text, text) from public, anon, authenticated;
grant execute on function public.grant_earned_cosmetic(uuid, text, text) to service_role;
