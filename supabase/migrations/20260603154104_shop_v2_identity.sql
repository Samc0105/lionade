-- Shop V2: Identity & Status Pack — founder_grants + earned_cosmetics
-- + retroactive grants + RPC surface for ongoing grants.
--
-- WHY:
--   Shop V2 introduces 18 SKUs across animated usernames, premium banners,
--   cash-only premium banners, founder badges, and 4 EARNED cosmetics. Two
--   classes of grant exist that user_inventory alone can't model cleanly:
--
--   1. FOUNDER BADGES — capped cohort markers (first 500 signups, first 1000
--      Pro subscribers, "you were here in beta"). These aren't purchased;
--      they're granted by the system on signup / subscribe / migration day.
--      A cap counter has to be cheap to read on every webhook tick.
--
--   2. EARNED COSMETICS — unlocked by gameplay achievement (Mastery 95%+ on
--      an exam, 30-day study streak, 3+ language banks created, 10+ clones
--      on any owned bank). Different trigger per badge; idempotency is
--      critical because the trigger sites fire repeatedly.
--
--   user_inventory already tracks the equip/unequip state of purchased
--   cosmetics. These two new tables track the GRANT EVENT (proof you earned
--   it, including the context — which exam, which streak tier, etc.) so the
--   UI can show "earned 2026-06-15 by hitting 95% on AWS Sec Specialty."
--
-- WHAT THIS DOES:
--   1. founder_grants table — one row per (user_id, badge_id) grant; UNIQUE
--      constraint makes re-runs idempotent. RLS lets a user SELECT their own
--      grants only (so the profile UI knows which badges to render). Writes
--      are service-role only — direct INSERT from a user JWT is impossible.
--
--   2. Retroactive grants in the migration itself (single transaction):
--      - badge_lionade_og → first 500 users by created_at ASC. If there are
--        currently < 500 users, grant to all of them; the cap freezes when
--        new signups bring the total to 500 (the Stripe-webhook-side gate
--        will check is_founder_cap_open() before granting on new signups
--        going forward).
--      - badge_beta_witness → every user with created_at < 2026-06-04 UTC
--        (the deploy day). No new grants after migration; the rule simply
--        isn't checked again. Anyone who exists today gets it; tomorrow's
--        signups don't.
--      - badge_founding_scholar → NOT granted here. The Stripe webhook on
--        subscription.created (Pro tier) checks is_founder_cap_open(
--        'badge_founding_scholar', 1000) and grants if true. Frozen at the
--        first 1000 Pro subscribers ever.
--
--   3. is_founder_cap_open(p_badge_id text, p_cap int) helper — returns
--      boolean. Used by the Stripe webhook + any future cap-gated grant
--      site. SECURITY DEFINER so the count read isn't gated by RLS (the
--      RLS policy only lets users see their OWN grants, which would
--      undercount). Restricted to service_role execute only — see the RLS
--      gotcha note in the migration footer.
--
--   4. earned_cosmetics table — same shape as founder_grants but with a
--      jsonb metadata column for flexible context (Mastery medals carry
--      {exam_id, exam_name}; streak emblems carry {tier_days, snapshot_day};
--      polyglot carries {bank_count_at_grant}; knowledge_sharer carries
--      {triggering_bank_id, clone_count_at_grant}). UNIQUE (user_id,
--      cosmetic_id) means each emblem is earned ONCE — a user who hits
--      30-day streak twice doesn't get two streak_30day rows.
--
--   5. Four SECURITY DEFINER RPCs for ongoing grants:
--      - grant_streak_emblem(p_user_id uuid, p_streak_days int) — checks
--        which tier the streak crossed (10/30/100/365) and grants the
--        corresponding emblem. Caller-identity gated (auth.uid() = p_user_id
--        OR service_role). Idempotent via UNIQUE — second call at the same
--        tier returns null.
--      - grant_polyglot_badge(p_user_id uuid) — counts the user's banks
--        where kind='language'; grants if >= 3. Called from /api/vocab/banks
--        POST after the new bank row lands.
--      - grant_knowledge_sharer_badge(p_user_id uuid) — checks if any of
--        the user's owned banks has clone_count >= 10. Called from inside
--        clone_bank-adjacent server code (after the clone_count update on
--        the source bank).
--      - grant_mastery_medal(p_user_id uuid, p_exam_id uuid, p_exam_name
--        text) — one medal per exam (cosmetic_id is medal_mastery_subject_
--        <exam_id slug>), called from the Mastery session-end route when
--        the session score is >= 95%.
--
--      All four return the granted cosmetic_id on success, NULL when the
--      row already existed (no-op via UNIQUE collision caught with the
--      ON CONFLICT clause). The frontend can use the non-null return to
--      trigger a "new emblem unlocked" toast.
--
-- TRANSACTIONALITY:
--   Wrapped in BEGIN/COMMIT. Retroactive grants use INSERT...SELECT (one
--   statement each, idempotent via UNIQUE constraint — re-running the
--   migration would attempt to re-insert and either no-op via ON CONFLICT
--   or, without ON CONFLICT, fail the transaction without partial state).
--   We use ON CONFLICT DO NOTHING explicitly so a partial earlier run + a
--   later re-run lands cleanly.
--
-- DATA-LOSS RISK:
--   Zero. Two NEW tables, four NEW functions, INSERTs into the new tables
--   only. No mutations on profiles, vocab_banks, ninny_*, user_inventory.
--   Existing schema is untouched.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

begin;

-- ---------------------------------------------------------------------------
-- 1. founder_grants table
-- ---------------------------------------------------------------------------

create table if not exists public.founder_grants (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  badge_id      text not null,
  granted_at    timestamptz not null default now(),
  grant_reason  text,
  unique (user_id, badge_id)
);

-- badge_id length cap — defensive, matches user_inventory.item_id style.
alter table public.founder_grants
  add constraint founder_grants_badge_id_len_chk
    check (char_length(badge_id) between 1 and 64) not valid;
alter table public.founder_grants
  validate constraint founder_grants_badge_id_len_chk;

-- Cap-count queries: `select count(*) from founder_grants where badge_id = $1`.
-- The Stripe webhook runs this on every Pro subscription.created event, so
-- the index needs to be lean. badge_id alone is correct — counts cross all
-- users for that badge.
create index if not exists founder_grants_badge_id_idx
  on public.founder_grants (badge_id);

-- Profile-render query: "what founder badges does this user have?" One
-- index on user_id powers it. Composite (user_id, badge_id) is already
-- implicitly indexed by the UNIQUE constraint, but the planner uses leading
-- columns — a user-only filter benefits from this dedicated index.
create index if not exists founder_grants_user_id_idx
  on public.founder_grants (user_id);

-- RLS — owner-only SELECT; no INSERT/UPDATE/DELETE policies (writes are
-- service-role only). The combination of "no write policy" + RLS enabled
-- means even a user with a valid JWT cannot INSERT directly.
alter table public.founder_grants enable row level security;
alter table public.founder_grants force row level security;

drop policy if exists founder_grants_select_own on public.founder_grants;
create policy founder_grants_select_own on public.founder_grants
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Defense-in-depth column-level revoke. Without this, a future RLS policy
-- mistake could open writes. Service-role bypasses table grants.
revoke insert, update, delete on public.founder_grants from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. earned_cosmetics table
-- ---------------------------------------------------------------------------

create table if not exists public.earned_cosmetics (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  cosmetic_id   text not null,
  earned_at     timestamptz not null default now(),
  earned_via    text,
  metadata      jsonb not null default '{}'::jsonb,
  unique (user_id, cosmetic_id)
);

-- cosmetic_id length cap. NO format constraint beyond length so the shop
-- catalog can mint any SKU id shape it wants (medal_mastery_subject_<uuid>,
-- emblem_streak_30day, badge_polyglot, etc.).
alter table public.earned_cosmetics
  add constraint earned_cosmetics_cosmetic_id_len_chk
    check (char_length(cosmetic_id) between 1 and 96) not valid;
alter table public.earned_cosmetics
  validate constraint earned_cosmetics_cosmetic_id_len_chk;

-- Profile-render query: "what earned cosmetics does this user own?"
create index if not exists earned_cosmetics_user_id_idx
  on public.earned_cosmetics (user_id);

-- Cosmetic-cohort query (rare but useful for analytics: "how many users
-- have the polyglot badge?"). Cheap to maintain.
create index if not exists earned_cosmetics_cosmetic_id_idx
  on public.earned_cosmetics (cosmetic_id);

-- RLS — same pattern as founder_grants.
alter table public.earned_cosmetics enable row level security;
alter table public.earned_cosmetics force row level security;

drop policy if exists earned_cosmetics_select_own on public.earned_cosmetics;
create policy earned_cosmetics_select_own on public.earned_cosmetics
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.earned_cosmetics from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Retroactive grants — single transaction, idempotent
-- ---------------------------------------------------------------------------

-- badge_lionade_og: first 500 by created_at ASC. If <500 users today, all of
-- them get it; the cap freezes when total grants hit 500 (future signups
-- gated by is_founder_cap_open on the signup-side webhook).
--
-- ON CONFLICT DO NOTHING makes this re-run-safe — a second migration run
-- would no-op rather than raise.
insert into public.founder_grants (user_id, badge_id, grant_reason)
select id, 'badge_lionade_og', 'first_500_signup'
from public.profiles
order by created_at asc
limit 500
on conflict (user_id, badge_id) do nothing;

-- badge_beta_witness: every user existing BEFORE 2026-06-04 00:00 UTC (the
-- deploy day). No cap. After today, no new grants are made (the rule isn't
-- run again). The Stripe-webhook / signup pipeline does NOT grant this on
-- new signups — the badge is intentionally a "you were here in beta" marker.
insert into public.founder_grants (user_id, badge_id, grant_reason)
select id, 'badge_beta_witness', 'beta_active'
from public.profiles
where created_at < timestamptz '2026-06-04 00:00:00+00'
on conflict (user_id, badge_id) do nothing;

-- badge_founding_scholar: NOT granted here. Stripe webhook on
-- subscription.created (Pro tier) checks is_founder_cap_open(
-- 'badge_founding_scholar', 1000) and grants if true. This comment is the
-- ONLY registration of the rule — the actual gate lives in the webhook.

-- ---------------------------------------------------------------------------
-- 4. is_founder_cap_open helper
-- ---------------------------------------------------------------------------
--
-- Returns TRUE when fewer than p_cap rows exist for the given badge_id.
-- The Stripe webhook calls this before granting badge_founding_scholar on
-- subscription.created, and any future cap-gated grant site uses the same
-- helper. SECURITY DEFINER + service_role-only execute (see grants below)
-- — this matters for the RLS gotcha: if a user JWT could call this, they
-- could probe "is the cap full yet?" which (a) leaks cohort size, (b)
-- enables coordinated rush-the-cap signup attacks. Service-role-only
-- prevents both.

create or replace function public.is_founder_cap_open(
  p_badge_id text,
  p_cap      int
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select count(*) < p_cap
  from public.founder_grants
  where badge_id = p_badge_id;
$$;

revoke execute on function public.is_founder_cap_open(text, int) from public, anon, authenticated;
grant  execute on function public.is_founder_cap_open(text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. grant_streak_emblem RPC
-- ---------------------------------------------------------------------------
--
-- Called from the streak-increment server code with the user's NEW streak
-- count (post-increment). Tier table:
--   10  → emblem_streak_10day
--   30  → emblem_streak_30day
--   100 → emblem_streak_100day
--   365 → emblem_streak_365day
--
-- Idempotent — the UNIQUE constraint on (user_id, cosmetic_id) means a
-- second call at the same tier no-ops via ON CONFLICT DO NOTHING. Returns
-- the cosmetic_id on grant, NULL on no-op (already earned or no tier
-- crossed). The frontend uses the non-null return to fire a toast.

create or replace function public.grant_streak_emblem(
  p_user_id     uuid,
  p_streak_days int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text := coalesce(auth.role(), '');
  v_cosmetic_id text;
  v_tier_days   int;
  v_inserted_id text;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = 'P0001';
  end if;
  if p_streak_days is null or p_streak_days < 0 then
    raise exception 'p_streak_days must be >= 0' using errcode = 'P0001';
  end if;

  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- Pick the HIGHEST tier the user has crossed. If they jumped from 9 to 30
  -- in a single call (e.g. backfill), we want to grant 30-day not 10-day —
  -- the 10-day emblem can be granted by a separate explicit backfill if
  -- needed. Production calls only ever cross one tier at a time (streak
  -- goes up by 1/day) so this branch is unreachable in practice.
  if p_streak_days >= 365 then
    v_cosmetic_id := 'emblem_streak_365day';
    v_tier_days   := 365;
  elsif p_streak_days >= 100 then
    v_cosmetic_id := 'emblem_streak_100day';
    v_tier_days   := 100;
  elsif p_streak_days >= 30 then
    v_cosmetic_id := 'emblem_streak_30day';
    v_tier_days   := 30;
  elsif p_streak_days >= 10 then
    v_cosmetic_id := 'emblem_streak_10day';
    v_tier_days   := 10;
  else
    return null; -- no tier crossed
  end if;

  insert into public.earned_cosmetics (user_id, cosmetic_id, earned_via, metadata)
  values (
    p_user_id,
    v_cosmetic_id,
    'streak_' || v_tier_days || 'day',
    jsonb_build_object('tier_days', v_tier_days, 'streak_at_grant', p_streak_days)
  )
  on conflict (user_id, cosmetic_id) do nothing
  returning cosmetic_id into v_inserted_id;

  return v_inserted_id; -- null on conflict (already earned)
end;
$$;

revoke execute on function public.grant_streak_emblem(uuid, int) from public, anon;
grant  execute on function public.grant_streak_emblem(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. grant_polyglot_badge RPC
-- ---------------------------------------------------------------------------
--
-- Called from /api/vocab/banks POST AFTER the new bank lands. Checks the
-- count of language-kind banks owned by the user; grants if >= 3. The
-- threshold (3) is hard-coded here — if Sam wants to tune it, change this
-- function and the shop catalog copy in lock-step.

create or replace function public.grant_polyglot_badge(
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role         text := coalesce(auth.role(), '');
  v_bank_count   int;
  v_inserted_id  text;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = 'P0001';
  end if;

  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select count(*) into v_bank_count
  from public.vocab_banks
  where user_id = p_user_id
    and kind    = 'language';

  if v_bank_count < 3 then
    return null;
  end if;

  insert into public.earned_cosmetics (user_id, cosmetic_id, earned_via, metadata)
  values (
    p_user_id,
    'badge_polyglot',
    'polyglot_3_banks',
    jsonb_build_object('bank_count_at_grant', v_bank_count)
  )
  on conflict (user_id, cosmetic_id) do nothing
  returning cosmetic_id into v_inserted_id;

  return v_inserted_id;
end;
$$;

revoke execute on function public.grant_polyglot_badge(uuid) from public, anon;
grant  execute on function public.grant_polyglot_badge(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. grant_knowledge_sharer_badge RPC
-- ---------------------------------------------------------------------------
--
-- Called from the clone-bank server route AFTER clone_bank() returns. Checks
-- if any of the user's owned banks has clone_count >= 10. Granted once per
-- user (the badge isn't tiered; you crossed the line, you have it).

create or replace function public.grant_knowledge_sharer_badge(
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role             text := coalesce(auth.role(), '');
  v_top_clone_count  int;
  v_top_bank_id      uuid;
  v_inserted_id      text;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = 'P0001';
  end if;

  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  -- Pick the highest-cloned bank — useful as metadata, and lets the toast
  -- copy say "your bank X just hit 10 clones." If multiple banks tie at the
  -- threshold, any one is fine.
  select clone_count, id
    into v_top_clone_count, v_top_bank_id
  from public.vocab_banks
  where user_id = p_user_id
  order by clone_count desc nulls last
  limit 1;

  if v_top_clone_count is null or v_top_clone_count < 10 then
    return null;
  end if;

  insert into public.earned_cosmetics (user_id, cosmetic_id, earned_via, metadata)
  values (
    p_user_id,
    'badge_knowledge_sharer',
    'knowledge_sharer_10_clones',
    jsonb_build_object(
      'triggering_bank_id',     v_top_bank_id,
      'clone_count_at_grant',   v_top_clone_count
    )
  )
  on conflict (user_id, cosmetic_id) do nothing
  returning cosmetic_id into v_inserted_id;

  return v_inserted_id;
end;
$$;

revoke execute on function public.grant_knowledge_sharer_badge(uuid) from public, anon;
grant  execute on function public.grant_knowledge_sharer_badge(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. grant_mastery_medal RPC
-- ---------------------------------------------------------------------------
--
-- Called from the Mastery session-end route when score >= 95%. One medal
-- per exam (cosmetic_id is medal_mastery_subject_<exam_id>). The exam_name
-- is snapshotted into metadata so the profile-render UI can label the medal
-- without joining back to a (possibly renamed or deleted) exam row.

create or replace function public.grant_mastery_medal(
  p_user_id   uuid,
  p_exam_id   uuid,
  p_exam_name text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role         text := coalesce(auth.role(), '');
  v_cosmetic_id  text;
  v_inserted_id  text;
begin
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = 'P0001';
  end if;
  if p_exam_id is null then
    raise exception 'p_exam_id required' using errcode = 'P0001';
  end if;

  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  v_cosmetic_id := 'medal_mastery_subject_' || replace(p_exam_id::text, '-', '');

  insert into public.earned_cosmetics (user_id, cosmetic_id, earned_via, metadata)
  values (
    p_user_id,
    v_cosmetic_id,
    'mastery_95pct_exam_' || p_exam_id::text,
    jsonb_build_object(
      'exam_id',   p_exam_id,
      'exam_name', coalesce(p_exam_name, '')
    )
  )
  on conflict (user_id, cosmetic_id) do nothing
  returning cosmetic_id into v_inserted_id;

  return v_inserted_id;
end;
$$;

revoke execute on function public.grant_mastery_medal(uuid, uuid, text) from public, anon;
grant  execute on function public.grant_mastery_medal(uuid, uuid, text) to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- Notes for downstream agents
-- ---------------------------------------------------------------------------
--
-- dev-backend follow-up:
--   - Stripe webhook on subscription.created (Pro tier): BEFORE granting any
--     other Pro perks, call `select public.is_founder_cap_open(
--     'badge_founding_scholar', 1000)`. If true, also call
--     `insert into founder_grants (user_id, badge_id, grant_reason) values
--     ($1, 'badge_founding_scholar', 'first_1000_pro_subscriber') on conflict
--     do nothing` via service-role client. Cap check + insert race is fine
--     — the count could go to 1001 in a true thundering-herd, but the
--     business semantics (~first 1000) tolerate single-digit overshoot.
--   - Streak-increment site (wherever profiles.streak / vocab_streaks /
--     daily_activity streak_maintained gets bumped): after the bump, fire
--     `select public.grant_streak_emblem($user_id, $new_streak_count)`
--     fire-and-forget. The function handles tier detection + idempotency.
--   - /api/vocab/banks POST: after the new bank row lands, fire
--     `select public.grant_polyglot_badge($user_id)` fire-and-forget.
--   - Clone server route (/api/vocab/banks/[id]/clone): after clone_bank()
--     returns (which has already bumped the SOURCE bank's clone_count),
--     fire `select public.grant_knowledge_sharer_badge($source_bank_owner_id)`
--     against the owner of the SOURCE bank, NOT the cloner. The badge is
--     for the author whose bank got cloned 10 times — not for the cloner.
--   - Mastery session-end route (wherever score is computed): if
--     score_pct >= 95, call `select public.grant_mastery_medal($user_id,
--     $exam_id, $exam_name)`. Surface the non-null return via the
--     session-end response so the UI can pop a "Medal unlocked" toast.
--
-- shop catalog (packages/lionade-core/src/constants/shop-catalog.ts):
--   - The 18 new SKUs need TYPE values added; the schema does NOT constrain
--     cosmetic_id format, so the catalog can mint any id shape. Convention:
--     `badge_*` for status badges, `emblem_*` for tiered emblems, `medal_*`
--     for per-instance medals (e.g. per-exam mastery medals).
--   - Founder badges (badge_lionade_og, badge_beta_witness, badge_founding_
--     scholar) should be marked `acquired_via: 'founder_grant'` in the
--     catalog so the shop UI hides the "Buy" CTA and shows an "Earned"
--     state when the SKU appears in founder_grants for the viewing user.
--   - Earned cosmetics (badge_polyglot, badge_knowledge_sharer, emblem_
--     streak_*, medal_mastery_subject_*) should be marked
--     `acquired_via: 'earned'` and the shop UI joins against earned_cosmetics
--     for the unlock check.
--
-- RLS GOTCHA — is_founder_cap_open():
--   The function reads `count(*) from founder_grants` which under RLS would
--   normally be filtered to "rows the caller can see." Since the only SELECT
--   policy is owner-only (`auth.uid() = user_id`), an authenticated user
--   calling this would always get count=0 (their own grant of that badge
--   is at most 1) — leading to FALSE-positive cap-open returns and
--   over-granting. Two layers prevent this:
--     1. SECURITY DEFINER — the function runs as the function owner
--        (postgres / supabase_admin), which is NOT subject to RLS on
--        founder_grants. count(*) returns the true global count.
--     2. Execute permission is REVOKED from public/anon/authenticated and
--        GRANTED only to service_role. An end-user JWT cannot invoke this
--        function at all (will fail with 42501 / permission denied),
--        preventing cap-state probing (which would leak cohort size AND
--        enable coordinated rush-the-cap signup attacks).
--   The Stripe webhook uses the service-role client (already standard for
--   our webhooks), so it can call this freely.
--
-- IDEMPOTENCY:
--   Every grant path is idempotent via UNIQUE (user_id, badge_id) /
--   UNIQUE (user_id, cosmetic_id) + ON CONFLICT DO NOTHING. Re-running this
--   migration on a database that already has it applied is safe — the two
--   retroactive INSERT...SELECT statements will no-op on every existing
--   grant. The four RPCs are inherently re-callable safely (returning null
--   on re-grant attempt rather than raising).
--
-- METADATA SCHEMA (for jsonb columns — flexible, but conventionally):
--   emblem_streak_*    → {tier_days: int, streak_at_grant: int}
--   badge_polyglot     → {bank_count_at_grant: int}
--   badge_knowledge_sharer → {triggering_bank_id: uuid, clone_count_at_grant: int}
--   medal_mastery_*    → {exam_id: uuid, exam_name: text}
--
-- DEFERRED (NOT in this migration):
--   - Wiring the four RPCs into their call sites — dev-backend.
--   - Stripe webhook update to call is_founder_cap_open + grant
--     badge_founding_scholar — dev-backend (parallel agent).
--   - Shop catalog SKU additions + acquired_via routing — dev-backend
--     (TypeScript-only change).
--   - Profile-render UI for founder/earned badges — dev-frontend
--     (separate wave; UI reads founder_grants + earned_cosmetics for the
--     viewing user via the owner-only SELECT RLS, no new endpoints
--     required).
--   - Backfill streak emblems for users who ALREADY have qualifying
--     streaks today — flagged for a follow-up backfill script (not in
--     this migration to keep this pass purely additive + cheap).
--   - Backfill polyglot + knowledge_sharer badges for users who already
--     qualify today — same follow-up.
