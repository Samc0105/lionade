-- ============================================================
-- Migration 073: flagged_content audit log for UGC moderation.
-- Applied to production via Supabase MCP. Fully idempotent; safe to re-run.
-- ============================================================
--
-- WHY: lib/moderation.isClean (a denylist) was wired into exactly ONE place
-- (bank rename). Bank CREATE, change-username, and the chat/DM streams published
-- raw user text with no filter — a COPPA/FERPA exposure on a 13+, minor-facing
-- app. lib/moderation-ugc.moderateText adds an OpenAI-moderations gate (free,
-- denylist fallback on timeout); this table records every blocked attempt for
-- triage and pattern detection. Service-role only.

create table if not exists flagged_content (
  id          bigint generated always as identity primary key,
  user_id     uuid references profiles(id) on delete set null,
  surface     text not null,            -- 'bank_name' | 'username' | 'dm' | ...
  content     text not null,
  categories  text[] not null default '{}',
  source      text not null,            -- 'openai' | 'denylist'
  created_at  timestamptz not null default now()
);

create index if not exists idx_flagged_content_created on flagged_content (created_at desc);

alter table flagged_content enable row level security;
revoke all on flagged_content from anon;
revoke all on flagged_content from authenticated;
grant all on flagged_content to service_role;
