-- ════════════════════════════════════════════════════════════════════════
-- HELD MIGRATION — do NOT apply until Sam gives the go.
-- TechHub / LionDesk shift completions + idempotent Fang grant ledger.
--
-- Purpose: persist a player's best score per shift across devices, and let the
-- server grant Fangs idempotently per shift. The API route
-- (app/api/techhub/shifts/complete) owns the reward ceiling per shift, so a
-- crafted client can never self-grant. The economy stays server-authoritative.
--
-- `granted_fangs` records the running TOTAL already paid for this shift (not a
-- boolean flag). The route grants only the positive difference between what the
-- player's BEST score has now earned and what was already paid, so:
--   * a first qualifying clear pays the full earned amount,
--   * a replay with a HIGHER score tops up the difference,
--   * a replay with the same or a lower score grants nothing.
-- This is naturally idempotent on the amount and removes the need for a later
-- boolean -> int migration once top-ups are wanted.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.techhub_shift_completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  shift_id     text not null,
  best_score   int  not null default 0 check (best_score between 0 and 100),
  last_csat    int  not null default 0 check (last_csat between 0 and 100),
  plays        int  not null default 0,
  granted_fangs int not null default 0 check (granted_fangs >= 0),
  completed_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, shift_id)
);

alter table public.techhub_shift_completions enable row level security;

-- Players may read their own completions. All WRITES go through the service
-- role in the API route (which validates + clamps the reward), so there is
-- deliberately NO client insert/update policy.
drop policy if exists "techhub_shift_completions_owner_read" on public.techhub_shift_completions;
create policy "techhub_shift_completions_owner_read"
  on public.techhub_shift_completions
  for select using (auth.uid() = user_id);

create index if not exists idx_techhub_shift_completions_user
  on public.techhub_shift_completions(user_id);
