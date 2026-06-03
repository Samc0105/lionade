-- Word Banks V3A: public banks + one-shot deep-copy "clone" into the cloner's
-- private collection.
--
-- WHY:
--   V2 (20260603143154_word_banks.sql) shipped private user-owned banks.
--   Sam's V3 vision is a Discover surface: a user opens "Word Banks → Discover",
--   browses banks other users have made public ("AWS Security Specialty",
--   "Math Theorems"), and clones any of them into their own collection. The
--   clone is a one-shot DEEP COPY (terms + definitions are copied, SR state is
--   reset so the cloner learns them fresh). The source bank can keep
--   evolving — the clone is independent.
--
-- WHAT THIS DOES:
--   1. vocab_banks gains four attribution + discovery columns:
--      - is_public (the visibility flag — false by default; clones start private)
--      - published_at (timestamp when the bank was first or most recently
--        flipped public; used for the "new this week" Discover sort)
--      - clone_count (denormalized counter bumped by clone_bank())
--      - parent_bank_id + parent_user_id (attribution snapshot at clone time;
--        parent_user_id snapshotted onto the clone row so author-credit
--        survives even if the original author deletes their account — see
--        edge-case note in the footer)
--   2. Two new indexes:
--      - (is_public, clone_count DESC, published_at DESC) for the Discover
--        sort ("most-cloned public banks, newest tiebreak")
--      - parent_bank_id for the future "show me everyone who cloned my bank"
--        query
--   3. RLS additions:
--      - vocab_banks gets a SECOND select policy: any authenticated user can
--        read rows where is_public = true (the existing owner-only select
--        stays in place for private rows; PostgreSQL's RLS policies are OR-ed
--        so the union is the access set)
--      - vocab_words gets a SECOND select policy that joins through bank: a
--        word is readable if it belongs to a public bank (existing owner-only
--        select stays in place; same OR-union semantics)
--   4. Column-level UPDATE revokes on (is_public, clone_count, parent_bank_id,
--      parent_user_id) from authenticated + anon. Bank visibility AND clone
--      attribution are server-mediated only — a user JWT cannot flip
--      is_public, forge a clone_count, or rewrite parent attribution via
--      direct PostgREST PATCH. Service-role routes (and the clone_bank RPC
--      below) are the only writers.
--   5. clone_bank(p_bank_id, p_cloner_id) RPC, SECURITY DEFINER:
--      - validates source bank exists AND is_public = true (else 'forbidden')
--      - caller-identity check (auth.uid() = p_cloner_id OR service_role)
--      - creates a new vocab_banks row owned by p_cloner_id, copying
--        name (with " (cloned)" suffix), kind, source_lang, target_lang,
--        color, icon — parent_bank_id + parent_user_id set, is_public = false
--      - one INSERT...SELECT copies every vocab_words row from source → new
--        bank, preserving translation / term_definition / user_definition /
--        definition_source, resetting SR state (review_count=0, correct_count=0,
--        ease_factor=2.5, next_review_at=now(), last_reviewed_at=null) so the
--        cloner learns the cards fresh
--      - increments source bank's clone_count in a separate UPDATE
--      - returns the new bank's id
--      - wrapped in BEGIN/COMMIT inside the function body (implicit — every
--        SECURITY DEFINER function call runs in its own subtransaction; if any
--        step raises, the whole clone rolls back, no orphan bank, no half-copied
--        cards, no double-counted clone_count)
--
-- TRANSACTIONALITY:
--   This migration is itself wrapped in BEGIN/COMMIT. The clone_bank RPC also
--   runs each invocation in a subtransaction — if the bulk word-copy fails
--   midway, the new bank row created in step 1 of the RPC is also rolled back.
--   Concretely: a user clones a 500-word bank, the INSERT...SELECT trips an
--   unrelated constraint on word 437; the COMMIT in the calling route never
--   lands and the user does not end up with a half-populated bank.
--
-- DATA-LOSS RISK:
--   Zero. This migration is additive only — no DROPs, no column-type changes,
--   no backfill of existing rows. Existing private banks remain private
--   (is_public defaults to false), and existing word rows are not touched.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

begin;

-- ---------------------------------------------------------------------------
-- 1. vocab_banks: new columns
-- ---------------------------------------------------------------------------

alter table vocab_banks
  add column if not exists is_public       boolean     not null default false,
  add column if not exists published_at    timestamptz,
  add column if not exists clone_count     int         not null default 0,
  add column if not exists parent_bank_id  uuid        references vocab_banks(id) on delete set null,
  add column if not exists parent_user_id  uuid        references profiles(id)    on delete set null;

-- clone_count must be non-negative. Defense in depth — clone_bank() is the
-- only writer, but a buggy future migration or admin SQL could otherwise
-- leave a negative counter that breaks Discover sort ordering.
alter table vocab_banks
  add constraint vocab_banks_clone_count_nonneg
    check (clone_count >= 0) not valid;
alter table vocab_banks validate constraint vocab_banks_clone_count_nonneg;

-- A row that has is_public = true must also have published_at set. This is
-- enforced as a check rather than a trigger so the constraint travels with
-- the schema (anyone reading the DDL sees it). published_at is set by
-- clone_bank()-adjacent server routes when toggling is_public; null when
-- is_public = false.
alter table vocab_banks
  add constraint vocab_banks_published_when_public
    check (
      (is_public = false)
      or
      (is_public = true and published_at is not null)
    ) not valid;
alter table vocab_banks validate constraint vocab_banks_published_when_public;

-- ---------------------------------------------------------------------------
-- 2. vocab_banks: indexes for Discover + reverse-clone lookup
-- ---------------------------------------------------------------------------

-- Discover sort: WHERE is_public=true ORDER BY clone_count DESC, published_at DESC.
-- Partial index keyed only on public rows — keeps the index tiny (will likely
-- be <1% of vocab_banks rows in steady state) and ensures the planner can use
-- an index-only scan for the Discover query.
create index if not exists vocab_banks_public_discover_idx
  on vocab_banks (clone_count desc, published_at desc)
  where is_public = true;

-- Reverse lookup: "show me every bank that was cloned from THIS bank." Future
-- "1.2k people cloned this bank" surface + author analytics.
create index if not exists vocab_banks_parent_bank_idx
  on vocab_banks (parent_bank_id)
  where parent_bank_id is not null;

-- ---------------------------------------------------------------------------
-- 3. RLS: public-read on vocab_banks + vocab_words
-- ---------------------------------------------------------------------------
--
-- The existing owner-only SELECT policies stay in place. PostgreSQL RLS
-- policies for the same command are OR-ed, so adding a SECOND select policy
-- with `is_public = true` produces the union: "I can read rows I own OR rows
-- that are public." No change to INSERT/UPDATE/DELETE — those stay
-- strictly owner-only (a user can never write to another user's bank).

drop policy if exists vocab_banks_select_public on vocab_banks;
create policy vocab_banks_select_public on vocab_banks
  for select
  to authenticated
  using (is_public = true);

-- Mirror on vocab_words: a word is publicly readable iff its bank is public.
-- The EXISTS subquery is the standard "join through" RLS pattern; the
-- (id, is_public) partial index already exists implicitly via the
-- vocab_banks PK so this join is cheap.

drop policy if exists vocab_words_select_public on vocab_words;
create policy vocab_words_select_public on vocab_words
  for select
  to authenticated
  using (
    exists (
      select 1
      from vocab_banks b
      where b.id = vocab_words.bank_id
        and b.is_public = true
    )
  );

-- ---------------------------------------------------------------------------
-- 4. vocab_banks: column-level UPDATE lockdown on attribution + counters
-- ---------------------------------------------------------------------------
--
-- Same defense-in-depth pattern as vocab_words.bank_id + definition_source
-- (V2 schema), fangs_cashable (dual-ledger), and vocab_streaks counters.
-- A user's JWT must not be able to:
--   - publish their own bank (is_public flip) without going through a server
--     route that runs additional checks (e.g. profanity scan on name, ToS
--     accept gate, "you've published 50 banks today, slow down" rate-limit).
--     The server route runs as service_role and bypasses the revoke.
--   - inflate their bank's clone_count via direct PATCH.
--   - rewrite parent_bank_id / parent_user_id to fake authorship of someone
--     else's bank.

revoke update (is_public, clone_count, parent_bank_id, parent_user_id) on vocab_banks from authenticated;
revoke update (is_public, clone_count, parent_bank_id, parent_user_id) on vocab_banks from anon;

-- published_at NOT in the revoke list — it's tightly coupled to is_public
-- (the CHECK constraint forces published_at to be set whenever is_public
-- flips true). Since is_public is revoked, published_at can't be desync'd by
-- a user JWT anyway. Still server-set in practice via the publish route.

-- ---------------------------------------------------------------------------
-- 5. clone_bank RPC — one-shot deep-copy public bank → cloner's collection
-- ---------------------------------------------------------------------------

create or replace function public.clone_bank(
  p_bank_id   uuid,
  p_cloner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role             text := coalesce(auth.role(), '');
  v_src              vocab_banks%rowtype;
  v_new_id           uuid;
  v_cloned_name      text;
begin
  -- Argument validation.
  if p_bank_id is null then
    raise exception 'p_bank_id required' using errcode = 'P0001';
  end if;
  if p_cloner_id is null then
    raise exception 'p_cloner_id required' using errcode = 'P0001';
  end if;

  -- Caller-identity check. Non-service callers can only clone INTO their own
  -- account; service_role bypasses (it has no auth.uid()). Same pattern as
  -- advance_vocab_streak + update_user_coins.
  if v_role <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_cloner_id then
      raise exception 'forbidden: caller % cannot clone as user %', auth.uid(), p_cloner_id
        using errcode = '42501';
    end if;
  end if;

  -- Load source bank.
  select * into v_src from vocab_banks where id = p_bank_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- The bank must be public to be clonable. We do NOT block the owner from
  -- "cloning" their own public bank — that's a niche but valid operation
  -- (e.g. "fork my own deck to make a variant") and rejecting it would
  -- require an extra branch with no real benefit. The clone_count counter
  -- happily bumps on self-clone, which is harmless and arguably accurate.
  if v_src.is_public is not true then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Compose cloned name. Length cap on vocab_banks.name is 80 (V2 schema);
  -- if "(cloned)" suffix would push past 80, truncate the base name.
  -- Length(" (cloned)") = 9.
  v_cloned_name := v_src.name || ' (cloned)';
  if length(v_cloned_name) > 80 then
    v_cloned_name := left(v_src.name, 80 - 9) || ' (cloned)';
  end if;

  -- Step 1: create new bank for cloner. slug is auto-derived by the
  -- vocab_banks_derive_slug trigger; collision against existing slugs in the
  -- cloner's namespace is auto-resolved with -2/-3 suffix by that trigger.
  -- is_public = false (clones start private; cloner can re-publish via the
  -- server publish route if they want). published_at = null (paired with
  -- is_public=false per the CHECK).
  insert into vocab_banks (
    user_id, name, kind, source_lang, target_lang,
    color, icon,
    parent_bank_id, parent_user_id,
    is_public, published_at, clone_count
  ) values (
    p_cloner_id, v_cloned_name, v_src.kind, v_src.source_lang, v_src.target_lang,
    v_src.color, v_src.icon,
    v_src.id, v_src.user_id,
    false, null, 0
  )
  returning id into v_new_id;

  -- Step 2: deep-copy every word from source bank → new bank in a single
  -- INSERT...SELECT (one round trip, transactional). We preserve the
  -- pedagogical content (word/translation/term_definition/user_definition/
  -- definition_source) and reset the spaced-repetition state — the cloner
  -- has not seen these cards before, so review_count/correct_count/
  -- ease_factor/next_review_at/last_reviewed_at all start fresh.
  insert into vocab_words (
    user_id, bank_id,
    word, translation, source_lang, target_lang,
    term_definition, definition_source, user_definition,
    ease_factor, review_count, correct_count,
    last_reviewed_at, next_review_at
  )
  select
    p_cloner_id, v_new_id,
    w.word, w.translation, w.source_lang, w.target_lang,
    w.term_definition, w.definition_source, w.user_definition,
    2.5, 0, 0,
    null, now()
  from vocab_words w
  where w.bank_id = p_bank_id;

  -- Step 3: bump source bank's clone_count. Done as a separate UPDATE rather
  -- than via trigger so it is explicit + auditable in this RPC (and so the
  -- counter can't drift if a future trigger gets accidentally disabled).
  update vocab_banks
    set clone_count = clone_count + 1,
        updated_at  = now()
    where id = p_bank_id;

  return v_new_id;
end;
$$;

-- The RPC is callable by authenticated users (they clone into their own
-- account, gated by the caller-identity check above) AND service_role (server
-- routes that need to script bulk clones). Anon stays out.
revoke execute on function public.clone_bank(uuid, uuid) from public, anon;
grant  execute on function public.clone_bank(uuid, uuid) to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- Notes for downstream agents
-- ---------------------------------------------------------------------------
--
-- dev-backend follow-up:
--   - POST /api/vocab/banks/[id]/publish — flips is_public true + sets
--     published_at = now(); server-side checks (profanity, ToS gate, daily
--     publish rate-limit) live here. Owner-only (verifies bank.user_id ===
--     caller before calling supabaseAdmin.update on is_public + published_at).
--   - POST /api/vocab/banks/[id]/unpublish — flips is_public false; clears
--     published_at (the CHECK requires it null when is_public=false). Owner-
--     only.
--   - POST /api/vocab/banks/[id]/clone — thin wrapper that calls
--     supabase.rpc('clone_bank', { p_bank_id, p_cloner_id }). Can be
--     called with the user's JWT (RPC enforces auth.uid() = p_cloner_id) or
--     via service-role. Returns { new_bank_id } on success, 403 on
--     'forbidden', 500 on unexpected error.
--   - GET /api/vocab/discover — lists public banks ordered by the new
--     partial index (clone_count DESC, published_at DESC); pagination via
--     limit+offset or cursor. The vocab_banks_select_public RLS policy
--     means this can also work via a direct PostgREST select for
--     authenticated users (no service role required) — useful if Sam wants
--     to keep it client-side initially.
--
-- EDGE CASES (read before shipping):
--
--   1. Infinite-loop / self-clone:
--      Cloning your own public bank is ALLOWED. There's no infinite loop
--      because each clone creates a NEW row (the new row's parent_bank_id
--      points back to the source — but nothing iterates over parents). The
--      clone_count on the original bumps by 1 on self-clone, which is
--      harmless and arguably correct (the author "forked" their own deck).
--      If product wants to block this, add an `if v_src.user_id =
--      p_cloner_id then raise exception 'cannot clone your own bank' end if;`
--      check in the RPC — flagged but not implemented in V3A.
--
--   2. Chained clone attribution:
--      A clones B's bank → A's clone has parent_bank_id=B's bank, parent_
--      user_id=B. C clones A's clone → C's clone has parent_bank_id=A's clone,
--      parent_user_id=A. Attribution chains hop one level at a time; we don't
--      track the original author through a chain. If "true source" attribution
--      becomes important later, the chain can be walked by recursive CTE on
--      parent_bank_id (until null or until parent_bank_id self-references,
--      which the FK can't enforce-prevent but is logically impossible since
--      a row's id is assigned before its parent_bank_id could reference it).
--
--   3. parent_user_id on user deletion:
--      profiles cascade-deletes the user's own banks (on delete cascade on
--      vocab_banks.user_id) — but parent_user_id on OTHER users' clones is
--      ON DELETE SET NULL. So when the original author deletes their account:
--      their banks vanish, but every clone that descended from those banks
--      keeps its data (name, words, SR progress) and simply loses the
--      author-credit pointer (parent_user_id → null). The bank still says
--      "(cloned)" in its name and parent_bank_id either survives (if the
--      original bank was not itself owned by the deleted user — rare edge
--      case via service-role manipulation) or also goes null via the same
--      ON DELETE SET NULL on parent_bank_id when the original is removed.
--      This is the right trade-off: cloners' learning progress is sacred,
--      attribution is best-effort.
--
--   4. Source bank changes after clone:
--      The clone is a one-shot deep copy. If B's bank gains 50 new words
--      after A clones it, A's clone does NOT inherit them — A is at the
--      snapshot from clone-time. This is intentional (a "fork" model, not
--      a "subscribe" model). If product later wants a subscribe model, it's
--      a separate feature (likely a new table linking subscriber → source
--      bank with a sync job).
--
--   5. Clone-then-publish-then-clone-back:
--      A clones B's bank → A's clone is private. A re-publishes their clone.
--      C clones A's republished clone. C's clone has parent_bank_id=A's
--      clone (correct), parent_user_id=A (correct). Attribution chain is
--      one hop; B's original authorship is NOT surfaced on C's clone
--      automatically. UI can walk parent_bank_id transitively if it wants
--      to display "(originally by B)".
--
--   6. clone_count race:
--      Two clones racing on the same source bank → both UPDATEs land via
--      separate transactions, both increment clone_count by 1. Postgres
--      handles the row-level lock on UPDATE; the value is durable and
--      monotonic. No double-counting, no lost updates. The clone_bank RPC
--      itself is one transactional unit, so a failure mid-clone never
--      bumps clone_count.
--
--   7. Word-copy uniqueness:
--      vocab_words has NO unique constraint on (user_id, bank_id, lower(word))
--      in V2 — the V1 unique was on (user_id, source_lang, target_lang,
--      lower(word)) and the V2 migration did not narrow it. So the
--      INSERT...SELECT cannot collide on duplicates even if the source bank
--      somehow had two cards for the same term. This was verified against
--      the V1 + V2 migration headers; if V3B adds per-bank unique, the
--      clone RPC will need a deconflict pass.
--
-- RLS TESTING APPROACH (for QA / dev-backend before pushing):
--
--   psql against a local supabase stack with two test users U1 and U2.
--
--   1. As U1 (JWT): insert a private bank; verify U2 (JWT) cannot SELECT it
--      via PostgREST or direct table query.
--   2. As U1 (service-role): flip the bank's is_public = true, set
--      published_at = now(). Verify the CHECK constraint passes.
--   3. As U2 (JWT): SELECT the bank — should now return it (the public-read
--      policy fires). SELECT vocab_words where bank_id = that bank — should
--      return all words (the join-through public-read policy fires).
--   4. As U2 (JWT): UPDATE attempts on (is_public, clone_count,
--      parent_bank_id, parent_user_id) — should all fail with permission
--      denied (column-level revoke). UPDATE on (name, color, icon) — should
--      also fail because U2 is not the owner (owner-only update policy from
--      V2 still gates the whole row).
--   5. As U2 (JWT): SELECT public.clone_bank(<bank_id>, <U2_id>) — should
--      return a new uuid. Verify: (a) new bank exists owned by U2 with
--      is_public=false, parent_bank_id=source, parent_user_id=U1, name ends
--      " (cloned)"; (b) every word from source is copied with SR state reset
--      (review_count=0, ease_factor=2.5, next_review_at within last second);
--      (c) source bank's clone_count incremented to 1.
--   6. As U2 (JWT): try clone_bank against a PRIVATE bank id (U1's other
--      private bank) — should raise 'forbidden' (42501).
--   7. As U2 (JWT): try clone_bank(<bank_id>, <U1_id>) — should raise
--      'forbidden' (42501) because auth.uid() != p_cloner_id.
--   8. Delete U1's profile (cascading). Verify: U1's banks gone; U2's clone
--      survives with parent_bank_id and parent_user_id both null.
--   9. Discover sort verification: insert 5 public banks with mixed
--      clone_count + published_at values, query
--      `SELECT id FROM vocab_banks WHERE is_public = true ORDER BY
--      clone_count DESC, published_at DESC LIMIT 10` and verify the
--      EXPLAIN uses vocab_banks_public_discover_idx.
--
-- DEFERRED (NOT in this migration):
--   - Server route /api/vocab/banks/[id]/publish — dev-backend.
--   - Server route /api/vocab/banks/[id]/clone — dev-backend (thin RPC
--     wrapper).
--   - Profanity / ToS gate on publish — design-copywriter + business-legal-
--     compliance scope.
--   - Audit log for publish/unpublish/clone events — flagged for
--     data-analytics if clone abuse becomes a problem.
--   - Per-bank-unique word constraint — V3B if dupe-cards-in-a-bank turn
--     out to be a real product problem (today they're harmless and
--     intentional in some use-cases, e.g. spaced practice of similar
--     terms).
