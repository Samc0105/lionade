-- Migration 064: Make the 061/063 column REVOKEs actually effective.
--
-- WHY: migrations 061 (trivia correct_index) and 063 (profiles.equipped_*) used
-- column-level `REVOKE ... (col) FROM authenticated, anon`. That is a NO-OP when
-- the role holds a TABLE-level grant: Postgres column privileges only matter if
-- the privilege was granted at column granularity, and Supabase grants table-wide
-- SELECT/UPDATE to authenticated by default. Verified live:
--   • authenticated HAS table SELECT on trivia_rounds  -> correct_index was readable
--     (bluff_rounds, by contrast, has NO table SELECT grant -> already safe; we match it)
--   • authenticated HAS table UPDATE on profiles        -> equipped_* (and the older
--     equipped_username_effect) were client-writable -> a user could fake-equip a
--     cosmetic they never bought.
--
-- FIX:
--   1. trivia secret: revoke the TABLE-level SELECT from authenticated/anon on the
--      trivia tables (all reads go through supabaseAdmin/service_role in the API;
--      the client uses broadcast, never a direct table read). Matches bluff_rounds.
--   2. equipped-cosmetic forge guard: we CANNOT revoke table UPDATE on profiles
--      (users legitimately edit username/avatar/etc.), so mirror the existing
--      public.guard_profile_role() trigger pattern — block any authenticated UPDATE
--      that changes an equipped_* / equipped_username_effect pointer. Only the
--      service-role equip routes (auth.role() <> 'authenticated') may set them.

-- ── 1. Trivia secret: table-level SELECT revoke (matches bluff_rounds) ──
REVOKE SELECT ON public.trivia_rounds  FROM authenticated, anon;
REVOKE SELECT ON public.trivia_answers FROM authenticated, anon;

-- ── 2. Equipped-cosmetic forge guard (mirrors guard_profile_role) ──
CREATE OR REPLACE FUNCTION public.guard_profile_equipped()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      -- New profiles own nothing yet; clients cannot pre-equip on insert.
      NEW.equipped_frame       := NULL;
      NEW.equipped_name_color  := NULL;
      NEW.equipped_banner      := NULL;
      NEW.equipped_avatar_aura := NULL;
    ELSE
      IF NEW.equipped_frame            IS DISTINCT FROM OLD.equipped_frame
        OR NEW.equipped_name_color     IS DISTINCT FROM OLD.equipped_name_color
        OR NEW.equipped_banner         IS DISTINCT FROM OLD.equipped_banner
        OR NEW.equipped_avatar_aura    IS DISTINCT FROM OLD.equipped_avatar_aura
        OR NEW.equipped_username_effect IS DISTINCT FROM OLD.equipped_username_effect THEN
        RAISE EXCEPTION 'forbidden: equipped cosmetics can only be changed via the equip API'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_equipped ON public.profiles;
CREATE TRIGGER trg_guard_profile_equipped
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_equipped();
