/**
 * Dev-only viewer for the ai_call_log telemetry table.
 *
 * Surfaces three views at a glance:
 *   1. Cost + call count per route over the last 7 days
 *   2. Success rate per (route, prompt_version) — answers "did quality move
 *      when I bumped the prompt?"
 *   3. The 20 most recent failures with short error reasons
 *
 * Gated on NODE_ENV !== "production" (returns notFound in prod). Uses
 * supabaseAdmin so it bypasses RLS. Never link to this from public surfaces.
 *
 * Usage: `npm run dev` then visit `http://localhost:<port>/dev/ai-log`.
 */
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface RouteCostRow {
  route: string;
  call_count: number;
  cost_usd: number;
  avg_input_tokens: number;
  avg_output_tokens: number;
  success_rate_pct: number;
}

interface PromptVersionRow {
  route: string;
  prompt_version: string;
  call_count: number;
  success_count: number;
  success_rate_pct: number;
  cost_usd: number;
}

interface FailureRow {
  id: number;
  route: string;
  prompt_version: string;
  model: string;
  error_short: string | null;
  cost_micro_usd: number;
  created_at: string;
}

async function loadStats(): Promise<{
  byRoute: RouteCostRow[];
  byPromptVersion: PromptVersionRow[];
  failures: FailureRow[];
  totalRows: number;
}> {
  // Pull last 7 days. Capped at 5000 rows — if traffic grows past this we
  // switch to a Postgres view or a /api/dev/ai-log-stats RPC.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabaseAdmin
    .from("ai_call_log")
    .select("id, route, prompt_version, model, input_tokens, output_tokens, cost_micro_usd, success, error_short, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return { byRoute: [], byPromptVersion: [], failures: [], totalRows: 0 };
  }

  const all = rows ?? [];

  // Aggregate by route.
  const routeMap = new Map<string, { calls: number; cost: number; in_t: number; out_t: number; ok: number }>();
  for (const r of all) {
    const m = routeMap.get(r.route) ?? { calls: 0, cost: 0, in_t: 0, out_t: 0, ok: 0 };
    m.calls += 1;
    m.cost += r.cost_micro_usd;
    m.in_t += r.input_tokens;
    m.out_t += r.output_tokens;
    if (r.success) m.ok += 1;
    routeMap.set(r.route, m);
  }
  const byRoute: RouteCostRow[] = Array.from(routeMap.entries())
    .map(([route, m]) => ({
      route,
      call_count: m.calls,
      cost_usd: m.cost / 1_000_000,
      avg_input_tokens: Math.round(m.in_t / m.calls),
      avg_output_tokens: Math.round(m.out_t / m.calls),
      success_rate_pct: Math.round((m.ok / m.calls) * 100),
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd);

  // Aggregate by (route, prompt_version).
  const pvMap = new Map<string, { calls: number; ok: number; cost: number }>();
  for (const r of all) {
    const key = `${r.route}\x1f${r.prompt_version}`;
    const m = pvMap.get(key) ?? { calls: 0, ok: 0, cost: 0 };
    m.calls += 1;
    if (r.success) m.ok += 1;
    m.cost += r.cost_micro_usd;
    pvMap.set(key, m);
  }
  const byPromptVersion: PromptVersionRow[] = Array.from(pvMap.entries())
    .map(([key, m]) => {
      const [route, prompt_version] = key.split("\x1f");
      return {
        route,
        prompt_version,
        call_count: m.calls,
        success_count: m.ok,
        success_rate_pct: Math.round((m.ok / m.calls) * 100),
        cost_usd: m.cost / 1_000_000,
      };
    })
    .sort((a, b) =>
      a.route === b.route
        ? b.call_count - a.call_count
        : a.route.localeCompare(b.route),
    );

  const failures: FailureRow[] = all
    .filter((r) => !r.success)
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      route: r.route,
      prompt_version: r.prompt_version,
      model: r.model,
      error_short: r.error_short,
      cost_micro_usd: r.cost_micro_usd,
      created_at: r.created_at,
    }));

  return { byRoute, byPromptVersion, failures, totalRows: all.length };
}

export default async function AiLogPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const { byRoute, byPromptVersion, failures, totalRows } = await loadStats();
  const totalCostUsd = byRoute.reduce((s, r) => s + r.cost_usd, 0);
  const totalCalls = byRoute.reduce((s, r) => s + r.call_count, 0);

  return (
    <div className="min-h-screen bg-[#08060f] text-cream p-6 sm:p-10 font-syne">
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/35 mb-2">
            dev tools · ai_call_log
          </p>
          <h1 className="font-bebas text-4xl sm:text-5xl tracking-wider leading-none mb-1">
            AI CALL LOG
          </h1>
          <p className="text-cream/55 text-sm">
            Last 7 days · {totalRows.toLocaleString()} calls · {totalCalls.toLocaleString()} after route filter ·
            <span className="text-gold ml-1">${totalCostUsd.toFixed(4)}</span> total spend
          </p>
          <p className="text-cream/35 text-xs mt-1 italic">
            Gated on NODE_ENV !== &quot;production&quot;. Service-role reads.
          </p>
        </header>

        {/* ─── COST + CALLS BY ROUTE ─── */}
        <section>
          <h2 className="font-bebas text-xl tracking-[0.2em] text-cream/70 mb-3">BY ROUTE</h2>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-cream/55 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2">Route</th>
                  <th className="text-right px-4 py-2">Calls</th>
                  <th className="text-right px-4 py-2">Success %</th>
                  <th className="text-right px-4 py-2">Avg in tok</th>
                  <th className="text-right px-4 py-2">Avg out tok</th>
                  <th className="text-right px-4 py-2">Spend (USD)</th>
                </tr>
              </thead>
              <tbody>
                {byRoute.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-cream/40 italic">
                      No AI calls logged in the last 7 days.
                    </td>
                  </tr>
                ) : (
                  byRoute.map((r) => (
                    <tr key={r.route} className="border-t border-white/[0.06]">
                      <td className="px-4 py-2 font-mono text-[12px] text-cream/85">{r.route}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.call_count}</td>
                      <td
                        className="px-4 py-2 text-right tabular-nums font-bebas"
                        style={{
                          color: r.success_rate_pct >= 95 ? "#86EFAC" : r.success_rate_pct >= 80 ? "#FACC15" : "#FCA5A5",
                        }}
                      >
                        {r.success_rate_pct}%
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-cream/55">{r.avg_input_tokens.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-cream/55">{r.avg_output_tokens.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gold font-mono">${r.cost_usd.toFixed(4)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── SUCCESS RATE BY (ROUTE, PROMPT VERSION) ─── */}
        <section>
          <h2 className="font-bebas text-xl tracking-[0.2em] text-cream/70 mb-3">BY PROMPT VERSION</h2>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-cream/55 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2">Route</th>
                  <th className="text-left px-4 py-2">Prompt version</th>
                  <th className="text-right px-4 py-2">Calls</th>
                  <th className="text-right px-4 py-2">Success</th>
                  <th className="text-right px-4 py-2">Spend (USD)</th>
                </tr>
              </thead>
              <tbody>
                {byPromptVersion.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-cream/40 italic">
                      Nothing yet.
                    </td>
                  </tr>
                ) : (
                  byPromptVersion.map((r) => (
                    <tr key={`${r.route}-${r.prompt_version}`} className="border-t border-white/[0.06]">
                      <td className="px-4 py-2 font-mono text-[12px] text-cream/75">{r.route}</td>
                      <td className="px-4 py-2 font-mono text-[12px] text-cream/85">{r.prompt_version}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.call_count}</td>
                      <td
                        className="px-4 py-2 text-right tabular-nums font-bebas"
                        style={{
                          color: r.success_rate_pct >= 95 ? "#86EFAC" : r.success_rate_pct >= 80 ? "#FACC15" : "#FCA5A5",
                        }}
                      >
                        {r.success_count}/{r.call_count} ({r.success_rate_pct}%)
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gold font-mono">${r.cost_usd.toFixed(4)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ─── RECENT FAILURES ─── */}
        <section>
          <h2 className="font-bebas text-xl tracking-[0.2em] text-cream/70 mb-3">RECENT FAILURES (20)</h2>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-cream/55 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2">When</th>
                  <th className="text-left px-4 py-2">Route</th>
                  <th className="text-left px-4 py-2">Prompt</th>
                  <th className="text-left px-4 py-2">Model</th>
                  <th className="text-left px-4 py-2">Error</th>
                  <th className="text-right px-4 py-2">Cost paid</th>
                </tr>
              </thead>
              <tbody>
                {failures.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-emerald-300/85 italic">
                      🎉 Zero failures in the last 7 days.
                    </td>
                  </tr>
                ) : (
                  failures.map((f) => (
                    <tr key={f.id} className="border-t border-white/[0.06]">
                      <td className="px-4 py-2 font-mono text-[11px] text-cream/55">
                        {new Date(f.created_at).toISOString().replace("T", " ").slice(5, 19)}
                      </td>
                      <td className="px-4 py-2 font-mono text-[12px] text-cream/85">{f.route}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-cream/55">{f.prompt_version}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-cream/55">{f.model}</td>
                      <td className="px-4 py-2 text-[12px] text-red-300/90 max-w-md truncate" title={f.error_short ?? ""}>
                        {f.error_short ?? "(no error_short)"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-cream/55 font-mono">
                        ${(f.cost_micro_usd / 1_000_000).toFixed(6)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
