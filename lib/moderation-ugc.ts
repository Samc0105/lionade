/**
 * UGC moderation (server-only) — the real-content gate the denylist couldn't be.
 *
 * lib/moderation.isClean is a tight slur/profanity DENYLIST — a hard floor with
 * no context awareness (its own header says "Do NOT use this for chat/UGC").
 * moderateText layers OpenAI's free /v1/moderations on top: the denylist runs
 * first (instant, offline-safe, blocks the worst), then the moderations model
 * catches context-dependent harassment / sexual / self-harm / hate that a
 * substring list can't. Fail-SAFE: on timeout or API error we fall back to the
 * denylist verdict (which already passed), so an OpenAI blip never blocks the
 * whole app — and the worst content is still blocked by the floor.
 *
 * COST: $0. The moderations endpoint is free (no token billing).
 */

import { isClean } from "@/lib/moderation";
import { supabaseAdmin } from "@/lib/supabase-server";

export interface ModerationResult {
  /** true = allowed, false = blocked. */
  ok: boolean;
  flagged: boolean;
  /** OpenAI categories (or ['denylist']) that tripped — for the audit row. */
  categories: string[];
  source: "openai" | "denylist";
}

const CACHE_MAX = 2000;
const cache = new Map<string, ModerationResult>();

function setCache(key: string, r: ModerationResult): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key, r);
}

/**
 * Moderate a short user-published string. Returns { ok } — call before
 * persisting/broadcasting bank names, usernames, DMs, lobby chat, fake answers.
 */
export async function moderateText(text: string): Promise<ModerationResult> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: true, flagged: false, categories: [], source: "denylist" };

  // Floor: the denylist is instant + offline-safe. If it trips, block now.
  if (!isClean(trimmed)) {
    return { ok: false, flagged: true, categories: ["denylist"], source: "denylist" };
  }

  const key = trimmed.toLowerCase().slice(0, 500);
  const hit = cache.get(key);
  if (hit) return hit;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // No key configured: the denylist floor already passed → allow.
    const r: ModerationResult = { ok: true, flagged: false, categories: [], source: "denylist" };
    setCache(key, r);
    return r;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "omni-moderation-latest", input: trimmed.slice(0, 4000) }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`moderations ${res.status}`);
    const data = (await res.json()) as {
      results?: Array<{ flagged?: boolean; categories?: Record<string, boolean> }>;
    };
    const result = data.results?.[0];
    const flagged = Boolean(result?.flagged);
    const categories = flagged
      ? Object.entries(result?.categories ?? {})
          .filter(([, v]) => v)
          .map(([k]) => k)
      : [];
    const r: ModerationResult = { ok: !flagged, flagged, categories, source: "openai" };
    setCache(key, r);
    return r;
  } catch (e) {
    // Fail SAFE to the denylist verdict (already passed) — never block on an
    // API blip. The worst content was already caught by the floor above.
    console.warn("[moderation-ugc] moderations failed:", e instanceof Error ? e.message : "unknown");
    const r: ModerationResult = { ok: true, flagged: false, categories: [], source: "denylist" };
    setCache(key, r);
    return r;
  }
}

/**
 * Best-effort audit row for a blocked attempt. Never throws (moderation must
 * never break the calling route).
 */
export async function logFlagged(
  userId: string | null,
  surface: string,
  content: string,
  result: ModerationResult,
): Promise<void> {
  try {
    await supabaseAdmin.from("flagged_content").insert({
      user_id: userId,
      surface,
      content: content.slice(0, 1000),
      categories: result.categories,
      source: result.source,
    });
  } catch (e) {
    console.warn("[moderation-ugc] logFlagged failed:", e instanceof Error ? e.message : "unknown");
  }
}
