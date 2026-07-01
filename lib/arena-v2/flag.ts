/**
 * Arena V2 (async ghost duels) feature gate. Single source of truth — every
 * ghost code path keys off THIS helper so the whole feature is one flip away
 * from on/off. Off unless NEXT_PUBLIC_ARENA_V2_ENABLED === "true", so the
 * feature ships DORMANT: V1 live duels keep running unchanged until Sam sets
 * the env var in the deploy environment (it's in .env.local today but read by
 * nothing, which is exactly the gap this closes).
 *
 * NEXT_PUBLIC_ is inlined at build time, so this resolves identically on the
 * server (queue/settle routes) and the client (duel page).
 */
export function isArenaV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_ARENA_V2_ENABLED === "true";
}
