-- Migration: fit stored avataaars avatars to their circular frames
--
-- WHY: the DiceBear avataaars style anchors the character to the TOP of its
-- square canvas. Every surface renders avatars in a circle (rounded-full +
-- object-cover), so the head was clipped by the top curve with empty space
-- at the bottom (Sam's "the pic wasn't lined up with the circle", 2026-07-06).
-- Fix verified visually: scale=80&translateY=6 centers the character.
--
-- Scope: ONLY dicebear avataaars URLs that don't already carry a scale param.
-- Other styles (fun-emoji, adventurer, identicon) fill their canvas
-- differently and are left alone. Uploaded photo avatars are untouched.
-- Generator code (lib/avatar.ts, lib/auth.tsx, shop, settings) now appends
-- the same params for new avatars.
--
-- Idempotent: the NOT LIKE '%scale=%' guard makes re-runs no-ops.

UPDATE public.profiles
SET avatar_url = avatar_url || '&scale=80&translateY=6'
WHERE avatar_url LIKE 'https://api.dicebear.com/%/avataaars/%'
  AND avatar_url LIKE '%?%'
  AND avatar_url NOT LIKE '%scale=%';
