-- Migration 058: persist Sketchy candidate words on the round row.
--
-- The previous design held the drawer's 3 candidate words in a per-process
-- in-memory cache (`lib/party/sketch-candidates.ts`). That works on a single
-- long-lived server but fails on Vercel serverless: the POST that deals the
-- round and the GET that fetches the candidates can land on DIFFERENT lambda
-- instances, so the GET reads an empty cache and 410s. The result was the
-- drawer staring at "Your turn! Pick a word to draw." with NO cards rendered.
--
-- Fix: move the candidate set to a JSONB column on the round row, which is
-- already RLS-hardened (migration 055 + 056 patterns: client SELECT revoked,
-- presenter-or-revealed policy). The deal route writes the column; the /words
-- route reads it through the service role (drawer-only, 403 to others); the
-- /select-word route validates the picked word against the same column.
--
-- The column is nullable so any in-flight round predating this migration
-- continues to work via the (now best-effort) in-memory cache fallback.

ALTER TABLE sketch_rounds
  ADD COLUMN IF NOT EXISTS candidate_words JSONB;
