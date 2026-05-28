// Competitive platform — matchmaking.
//
// Mirrors the Arena V2 queue philosophy (project_arena_v2_decisions.md):
//   - NO BOTS. If there's no opponent, the player gets an honest dead-end.
//   - 1v1: ELO ±band. Band starts at ±200 and widens to ±400 after 30s waiting.
//   - 2v2: friend-first. Players join a 4-digit "party_code" duo before queuing;
//     the matcher pairs two complete duos. Also supports solo-queue → the matcher
//     auto-pairs two waiting solos into a duo, then matches duo-vs-duo when a
//     second pair exists.
//
// All queue/match writes happen via the service-role client inside the API
// route. This module is pure logic over a SupabaseClient handle.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompetitiveFormat, CompetitiveMode } from "./types";

const BASE_BAND = 200;
const WIDE_BAND = 400;
const WIDEN_AFTER_MS = 30_000;

export interface QueueRow {
  id: string;
  user_id: string;
  format: CompetitiveFormat;
  mode: CompetitiveMode | null;
  elo: number;
  party_code: string | null;
  joined_at: string;
  status: string;
  match_id: string | null;
}

/** Band widens the longer the searcher has been waiting. */
export function eloBand(joinedAtMs: number, now: number): number {
  return now - joinedAtMs >= WIDEN_AFTER_MS ? WIDE_BAND : BASE_BAND;
}

function modeCompatible(a: CompetitiveMode | null, b: CompetitiveMode | null): boolean {
  // null = "any mode" — compatible with anything. Otherwise must match.
  if (a === null || b === null) return true;
  return a === b;
}

/** Resolve the agreed mode when two queue rows match (specific wins over "any"). */
export function resolveMode(
  a: CompetitiveMode | null,
  b: CompetitiveMode | null,
  fallback: CompetitiveMode,
): CompetitiveMode {
  return a ?? b ?? fallback;
}

/**
 * Find a 1v1 opponent for `searcher` among waiting queue rows. Returns the
 * opponent row or null. Caller is responsible for the atomic claim.
 */
export function find1v1Opponent(
  searcher: QueueRow,
  candidates: QueueRow[],
  now: number,
): QueueRow | null {
  const band = eloBand(new Date(searcher.joined_at).getTime(), now);
  let best: QueueRow | null = null;
  let bestGap = Infinity;
  for (const c of candidates) {
    if (c.user_id === searcher.user_id) continue;
    if (c.format !== "1v1") continue;
    if (c.status !== "waiting") continue;
    if (!modeCompatible(searcher.mode, c.mode)) continue;
    const gap = Math.abs(c.elo - searcher.elo);
    if (gap > band) continue;
    if (gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Build 2v2 teams. Two strategies:
 *   1. Two complete party-code duos (friends) → team_a = duo1, team_b = duo2.
 *   2. Four waiting solos → auto-pair into two duos by ELO proximity.
 * Returns the two teams (each a [user_id, user_id]) plus the involved queue
 * row ids, or null if not enough players.
 */
export function build2v2Teams(
  searcher: QueueRow,
  candidates: QueueRow[],
): { teamA: string[]; teamB: string[]; queueIds: string[] } | null {
  const pool = [searcher, ...candidates.filter((c) => c.user_id !== searcher.user_id)]
    .filter((r) => r.format === "2v2" && r.status === "waiting")
    .filter((r) => modeCompatible(searcher.mode, r.mode));

  // ── Strategy 1: complete party-code duos ──
  const duos = new Map<string, QueueRow[]>();
  const solos: QueueRow[] = [];
  for (const r of pool) {
    if (r.party_code) {
      const arr = duos.get(r.party_code) ?? [];
      arr.push(r);
      duos.set(r.party_code, arr);
    } else {
      solos.push(r);
    }
  }
  const completeDuos: QueueRow[][] = Array.from(duos.values())
    .filter((arr: QueueRow[]) => arr.length >= 2)
    .map((arr: QueueRow[]) => arr.slice(0, 2));

  // The searcher must be involved. Find which duo (if any) contains them.
  const searcherDuo = completeDuos.find((d) => d.some((r) => r.user_id === searcher.user_id));

  if (searcherDuo) {
    const otherDuo = completeDuos.find((d) => d !== searcherDuo);
    if (otherDuo) {
      return {
        teamA: searcherDuo.map((r) => r.user_id),
        teamB: otherDuo.map((r) => r.user_id),
        queueIds: [...searcherDuo, ...otherDuo].map((r) => r.id),
      };
    }
    // Have our duo but no opponent duo. Can we form an opponent from solos?
    if (solos.length >= 2) {
      const sorted = [...solos].sort((a, b) => a.elo - b.elo);
      const opp = sorted.slice(0, 2);
      return {
        teamA: searcherDuo.map((r) => r.user_id),
        teamB: opp.map((r) => r.user_id),
        queueIds: [...searcherDuo, ...opp].map((r) => r.id),
      };
    }
    return null;
  }

  // ── Strategy 2: searcher is a solo. Need 3 more solos to form two duos. ──
  const soloPool = [...solos].sort((a, b) => a.elo - b.elo);
  if (soloPool.length >= 4) {
    // Searcher + nearest-ELO partner vs the other two.
    const others = soloPool.filter((r) => r.user_id !== searcher.user_id);
    // partner = closest ELO to searcher
    others.sort(
      (a, b) => Math.abs(a.elo - searcher.elo) - Math.abs(b.elo - searcher.elo),
    );
    const partner = others[0];
    const rest = others.slice(1, 3);
    if (partner && rest.length === 2) {
      return {
        teamA: [searcher.user_id, partner.user_id],
        teamB: rest.map((r) => r.user_id),
        queueIds: [searcher.id, partner.id, ...rest.map((r) => r.id)],
      };
    }
  }

  return null;
}
