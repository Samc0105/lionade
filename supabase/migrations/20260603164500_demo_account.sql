-- Shared demo account for tester onboarding.
--
-- WHY:
--   Sam wants friends/testers to try Lionade without signing up with a real
--   email. One shared, publicly-known account with a stable, hardcoded UUID
--   so server-side guards (see lib/demo-guard.ts) can short-circuit
--   destructive actions (password/username change, public bank publish,
--   social DM send, friend request send, IAP, profile edit). Leaderboards
--   and social search filter the demo user out so it doesn't pollute the
--   real ladders.
--
-- DEMO_USER_ID: d3500000-0000-0000-0000-000000000000
--   Format: not a v4 uuid (intentional — the leading 'd' and the run of
--   zeros makes it visually obvious in logs that this is the demo account,
--   not a real user). Hardcoded everywhere via lib/demo-guard.ts.
--
-- WHAT THIS DOES:
--   1. Inserts the demo row into auth.users with email demo@getlionade.com,
--      password 'LionadeDemo2026!' hashed via pgcrypto bf, email already
--      confirmed (skips confirmation email), raw_user_meta_data marks it as
--      a demo. ON CONFLICT DO NOTHING on the unique email constraint so
--      re-runs are no-ops.
--
--   2. Inserts the profile row with the same id, seeds 5000 Fangs (so the
--      demo can browse + buy Fang cosmetics in the shop), onboarding_completed
--      = true so the user lands on /dashboard not /onboarding, plan='free'
--      and subscription_tier='free' so paid gates render correctly.
--
--   3. Seeds sample data so the demo doesn't feel empty:
--      - 1 language bank (Spanish/English) with 5 vocab words
--      - 1 general bank (AWS Basics) with 3 terms
--      - Equips name_fx_rainbow username effect (visible flair so testers
--        immediately see the cosmetics system at work)
--      - 2 sample notes (one pinned, one regular) in class_notes
--
--   All inserts are idempotent — they use ON CONFLICT DO NOTHING or
--   skip-if-already-present checks so re-running the migration is safe.
--
-- ABUSE MITIGATION:
--   The demo account is publicly known (credentials are printed on the login
--   page). lib/demo-guard.ts hardcodes this same UUID and is checked at
--   every mutating endpoint that could be abused (password change, username
--   change, public bank publish, DM, friend request, profile edit, IAP, etc.).
--   The migration itself is the SOURCE OF TRUTH for the UUID — if it
--   changes here, change lib/demo-guard.ts in lockstep.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

begin;

-- ---------------------------------------------------------------------------
-- 1. auth.users row
-- ---------------------------------------------------------------------------
--
-- Standard Supabase auth.users INSERT pattern. We:
--   - hash the password server-side via pgcrypto's crypt() with bf salt
--     (matches what gotrue itself does on signup, so the resulting row is
--     indistinguishable from a real signup)
--   - set email_confirmed_at = now() so the user can log in immediately
--     without clicking a confirmation link (no email is ever sent to
--     demo@getlionade.com — there is no mailbox at that address)
--   - aud + role both 'authenticated' (the only roles gotrue issues for
--     normal users)
--   - raw_user_meta_data marks it as a demo so future analytics queries can
--     exclude it cheaply
--
-- ON CONFLICT (email) DO NOTHING — the email column has a unique index in
-- auth.users, so re-running this migration after the row already exists is
-- a no-op (does NOT update the password — if Sam rotates the password
-- later, that's a separate migration).

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values (
  'd3500000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'demo@getlionade.com',
  crypt('LionadeDemo2026!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"is_demo": true, "display_name": "Demo User", "username": "demo"}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. profile row
-- ---------------------------------------------------------------------------
--
-- The standard signup trigger normally creates this row, but it may or may
-- not have fired depending on Supabase version / trigger state. Insert
-- explicitly with ON CONFLICT DO NOTHING so we end up with exactly one row
-- whether the trigger fired or not.
--
-- coins = 5000 so the demo isn't broke — testers can immediately try
-- shop purchases (which our demo guard ALLOWS for Fang cosmetics but
-- BLOCKS for IAP / cash items).

insert into profiles (
  id,
  username,
  display_name,
  coins,
  xp,
  level,
  streak,
  max_streak,
  onboarding_completed,
  created_at,
  updated_at
)
values (
  'd3500000-0000-0000-0000-000000000000'::uuid,
  'demo',
  'Demo User',
  5000,
  250,
  1,
  3,
  3,
  true,
  now(),
  now()
)
on conflict (id) do nothing;

-- Best-effort: set plan + subscription_tier if those columns exist. We
-- wrap in a DO block so the migration doesn't fail on a fresh schema that
-- hasn't run the stripe-subscriptions migration yet (those columns are
-- added in 20260603010601_stripe_subscriptions.sql; if this migration is
-- ever re-ordered before that one, we degrade gracefully).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'subscription_tier'
  ) then
    update profiles
      set subscription_tier = 'free'
      where id = 'd3500000-0000-0000-0000-000000000000'::uuid
        and (subscription_tier is null or subscription_tier <> 'free');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'plan'
  ) then
    update profiles
      set plan = 'free'
      where id = 'd3500000-0000-0000-0000-000000000000'::uuid
        and (plan is null or plan <> 'free');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Seed: equipped username effect (name_fx_rainbow)
-- ---------------------------------------------------------------------------
--
-- Insert a user_inventory row marking name_fx_rainbow as owned + equipped.
-- The UNIQUE (user_id, item_id) constraint makes ON CONFLICT DO NOTHING
-- correct for re-runs.

insert into user_inventory (user_id, item_id, item_type, quantity, equipped, rarity)
values (
  'd3500000-0000-0000-0000-000000000000'::uuid,
  'name_fx_rainbow',
  'name_color',
  1,
  true,
  'rare'
)
on conflict (user_id, item_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Seed: language bank (Spanish ↔ English) + 5 vocab words
-- ---------------------------------------------------------------------------
--
-- Only seed the bank if the V2 schema is live (vocab_banks exists). If
-- somebody runs this migration on a fresh schema before the vocab tables
-- exist, skip silently rather than failing the migration. We pick a stable
-- UUID for the bank so word inserts can target it without a SELECT round
-- trip and so re-running this whole migration is idempotent.

do $$
declare
  v_lang_bank_id uuid := 'd3500000-0000-0000-0000-000000000001'::uuid;
  v_general_bank_id uuid := 'd3500000-0000-0000-0000-000000000002'::uuid;
  v_user_id uuid := 'd3500000-0000-0000-0000-000000000000'::uuid;
begin
  -- Language bank — only if vocab_banks table exists
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vocab_banks'
  ) then
    insert into vocab_banks (id, user_id, name, slug, kind, source_lang, target_lang, color, icon)
    values (v_lang_bank_id, v_user_id, 'Spanish Starter', 'spanish-starter', 'language', 'es', 'en', '#A855F7', '🇪🇸')
    on conflict (id) do nothing;

    insert into vocab_banks (id, user_id, name, slug, kind, color, icon)
    values (v_general_bank_id, v_user_id, 'AWS Basics', 'aws-basics', 'general', '#FF9900', '☁️')
    on conflict (id) do nothing;
  end if;

  -- Vocab words — language bank
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vocab_words'
  )
  and exists (
    select 1 from vocab_banks where id = v_lang_bank_id
  ) then
    -- 5 Spanish words; user_definition added so the SR cards have content
    -- The UNIQUE on vocab_words is (user_id, source_lang, target_lang,
    -- lower(word)) in V1 — V2 didn't narrow that — so we can rely on
    -- ON CONFLICT DO NOTHING to make this idempotent.
    insert into vocab_words (user_id, bank_id, word, translation, source_lang, target_lang, user_definition, definition_source, ease_factor, review_count, correct_count, next_review_at)
    values
      (v_user_id, v_lang_bank_id, 'hola',     'hello',     'es', 'en', 'A greeting; the most common informal Spanish hello.', 'mymemory', 2.5, 0, 0, now()),
      (v_user_id, v_lang_bank_id, 'gracias',  'thank you', 'es', 'en', 'Used to express gratitude — equivalent to thanks.', 'mymemory', 2.5, 0, 0, now()),
      (v_user_id, v_lang_bank_id, 'agua',     'water',     'es', 'en', 'Feminine noun (la agua → el agua because of stressed initial a). The basic word for water.', 'mymemory', 2.5, 0, 0, now()),
      (v_user_id, v_lang_bank_id, 'amigo',    'friend',    'es', 'en', 'Masculine. Feminine form is amiga. Used widely for friend.', 'mymemory', 2.5, 0, 0, now()),
      (v_user_id, v_lang_bank_id, 'libro',    'book',      'es', 'en', 'Masculine noun. Plural: libros.', 'mymemory', 2.5, 0, 0, now())
    on conflict (user_id, source_lang, target_lang, lower(word)) do nothing;
  end if;

  -- General bank terms — AWS Basics
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'vocab_words'
  )
  and exists (
    select 1 from vocab_banks where id = v_general_bank_id
  ) then
    -- General banks use term_definition (not translation). The V2 schema
    -- enforces "at least one of translation / term_definition is set" via
    -- vocab_words_has_answer. The UNIQUE is still on
    -- (user_id, source_lang, target_lang, lower(word)) which in V1 was NOT
    -- NULL — V2 doesn't NULL them either; we use 'xx'/'xx' placeholders to
    -- avoid colliding with real ISO codes (xx is reserved-for-private-use
    -- under ISO 639-2). This is the same convention V2 backfill used for
    -- general banks. If a future migration tightens the unique-by-bank
    -- constraint, this still works.
    --
    -- Note: vocab_words.source_lang/target_lang have an ISO regex CHECK
    -- ('^[a-z]{2}$') which 'xx' satisfies. The langs aren't user-facing
    -- on a general bank.
    insert into vocab_words (user_id, bank_id, word, translation, source_lang, target_lang, term_definition, definition_source, ease_factor, review_count, correct_count, next_review_at)
    values
      (v_user_id, v_general_bank_id, 'EC2', null, 'xx', 'xx', 'Elastic Compute Cloud — AWS service offering resizable virtual servers (instances) in the cloud.', 'manual', 2.5, 0, 0, now()),
      (v_user_id, v_general_bank_id, 'S3',  null, 'xx', 'xx', 'Simple Storage Service — object storage for files, backups, static websites, and data lakes. 99.999999999% durability.', 'manual', 2.5, 0, 0, now()),
      (v_user_id, v_general_bank_id, 'IAM', null, 'xx', 'xx', 'Identity and Access Management — controls who is authenticated and what permissions they have across AWS resources.', 'manual', 2.5, 0, 0, now())
    on conflict (user_id, source_lang, target_lang, lower(word)) do nothing;
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 5. Seed: sample class notes
-- ---------------------------------------------------------------------------
--
-- Two notes so the demo dashboard / quick-note surfaces have content. Only
-- if class_notes exists (migrations/033_class_notebook.sql).

do $$
declare
  v_user_id uuid := 'd3500000-0000-0000-0000-000000000000'::uuid;
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'class_notes'
  ) then
    -- Use deterministic UUIDs so re-running this migration doesn't insert
    -- duplicate notes. The id-conflict path is the most reliable
    -- idempotency guard here (class_notes has no natural unique key).
    insert into class_notes (id, user_id, title, body, source, pinned, archived)
    values
      ('d3500000-0000-0000-0000-000000000003'::uuid, v_user_id,
        'Welcome to Lionade',
        'This is the shared demo account. Anything you change here is visible to other testers.\n\nTry: tap Clock In, run a quick quiz, claim a bounty, or browse the Shop.',
        'manual', true, false),
      ('d3500000-0000-0000-0000-000000000004'::uuid, v_user_id,
        'Spanish — pronunciation notes',
        '- ll sounds like English y (calle = ka-yay)\n- ñ is a separate letter, palatalized n (mañana)\n- h is always silent (hola = ola)\n- Rolled r at the start of words and after l/n/s',
        'manual', false, false)
    on conflict (id) do nothing;
  end if;
end$$;

commit;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
--
-- After this migration runs, the following should be true:
--
--   select id, email, email_confirmed_at is not null as confirmed
--     from auth.users where email = 'demo@getlionade.com';
--   → 1 row, id = d3500000-0000-0000-0000-000000000000, confirmed = true
--
--   select id, username, coins, onboarding_completed
--     from profiles where id = 'd3500000-0000-0000-0000-000000000000';
--   → 1 row, username='demo', coins=5000, onboarding_completed=true
--
--   select item_id, equipped from user_inventory
--     where user_id = 'd3500000-0000-0000-0000-000000000000';
--   → 1 row, item_id='name_fx_rainbow', equipped=true
--
--   select count(*) from vocab_banks
--     where user_id = 'd3500000-0000-0000-0000-000000000000';
--   → 2 (assuming vocab_banks migration has run)
--
--   select count(*) from vocab_words
--     where user_id = 'd3500000-0000-0000-0000-000000000000';
--   → 8 (assuming vocab_words exists)
--
--   select count(*) from class_notes
--     where user_id = 'd3500000-0000-0000-0000-000000000000';
--   → 2 (assuming class_notes exists)
--
-- Logging in: POST /auth/v1/token?grant_type=password with
--   {"email": "demo@getlionade.com", "password": "LionadeDemo2026!"}
-- should succeed and return a JWT for user d3500000-0000-0000-0000-000000000000.

-- ---------------------------------------------------------------------------
-- RLS guard: prevent the demo user from editing its own profile row.
--
-- The profile-edit surface at app/profile/page.tsx writes directly via the
-- anon client (supabase.from("profiles").update(...)), bypassing every
-- API-route guard. Without this RLS clause the demo account could be
-- renamed / re-avatared / bio-spammed by any tester. Since the demo's
-- credentials are publicly displayed on the login page, that grief vector
-- WILL be exploited.
--
-- The existing profile-update RLS policies allow auth.uid() = id; we add a
-- separate restrictive policy that EXCLUDES the demo user. RESTRICTIVE
-- policies are AND'd with PERMISSIVE policies, so this acts as a veto.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_block_demo_self_update on public.profiles;

create policy profiles_block_demo_self_update
  on public.profiles
  as restrictive
  for update
  to authenticated
  using (id <> 'd3500000-0000-0000-0000-000000000000'::uuid);

-- Service-role bypass: this restrictive policy does NOT apply to service
-- role, so admin operations (re-seeding via a future migration, rotating
-- the demo password) still work.
