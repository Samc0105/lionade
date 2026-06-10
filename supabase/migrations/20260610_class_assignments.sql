-- Academia: class assignment tracker.
--
-- WHY:
--   Classes already own notes (class_notes), mastery targets (user_exams),
--   and grade rows (class_grades). The missing piece for a real "agenda" is
--   lightweight, dateable to-dos: "Problem set 4 due Friday", "Read Ch. 7".
--   `class_assignments` is that table. It powers two things:
--     1. A per-class assignment board (todo / doing / done).
--     2. The unified /api/academia/agenda endpoint, which merges exam target
--        dates (user_exams.target_date) with assignment due dates into one
--        date-sorted calendar feed.
--
-- WHAT THIS DOES (idempotent — create-if-not-exists + drop-then-create RLS +
-- if-not-exists indexes, so re-running is safe):
--   1. Creates `class_assignments` keyed to a user + class, with a status
--      enum-via-CHECK ('todo','doing','done'), a nullable due_date (DATE), and
--      created_at / updated_at timestamps.
--   2. RLS: owner-only CRUD (auth.uid() = user_id) + FORCE row level security,
--      mirroring vocab_banks / class_* tables.
--   3. Indexes: (user_id, due_date) for the agenda range scan, (class_id) for
--      the per-class board fetch.
--   4. updated_at auto-touch trigger so PATCH never has to remember to set it
--      and direct PostgREST writes stay honest.
--
-- COLUMN-PARITY NOTE:
--   due_date is a DATE (not timestamptz) to match user_exams.target_date and
--   class_grades.due_date — the agenda merges all three and they must compare
--   as plain YYYY-MM-DD with no timezone skew.
--
-- NOT PUSHED TO REMOTE. Sam runs `npx supabase db push` after review.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists class_assignments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  class_id   uuid not null references classes(id)  on delete cascade,
  title      text not null,
  due_date   date,
  status     text not null default 'todo' check (status in ('todo','doing','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Title length guard (1..200). NOT VALID + VALIDATE so re-running on an
-- already-populated table never takes a long AccessExclusiveLock scan.
alter table class_assignments
  drop constraint if exists class_assignments_title_len;
alter table class_assignments
  add constraint class_assignments_title_len
    check (length(title) between 1 and 200) not valid;
alter table class_assignments
  validate constraint class_assignments_title_len;

-- ---------------------------------------------------------------------------
-- 2. RLS — owner only, FORCED
-- ---------------------------------------------------------------------------

alter table class_assignments enable row level security;
alter table class_assignments force  row level security;

drop policy if exists class_assignments_select on class_assignments;
create policy class_assignments_select on class_assignments
  for select using (auth.uid() = user_id);

drop policy if exists class_assignments_insert on class_assignments;
create policy class_assignments_insert on class_assignments
  for insert with check (auth.uid() = user_id);

drop policy if exists class_assignments_update on class_assignments;
create policy class_assignments_update on class_assignments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists class_assignments_delete on class_assignments;
create policy class_assignments_delete on class_assignments
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

-- Agenda range scan: WHERE user_id=? AND due_date BETWEEN ? AND ?
create index if not exists class_assignments_user_due_idx
  on class_assignments (user_id, due_date);

-- Per-class board fetch.
create index if not exists class_assignments_class_idx
  on class_assignments (class_id);

-- ---------------------------------------------------------------------------
-- 4. updated_at auto-touch
-- ---------------------------------------------------------------------------

create or replace function class_assignments_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists class_assignments_touch_updated_at on class_assignments;
create trigger class_assignments_touch_updated_at
  before update on class_assignments
  for each row execute function class_assignments_touch_updated_at();
