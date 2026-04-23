/**
 * Thin AI wrapper used by Mastery Mode routes.
 *
 * Historically this file was called `anthropic.ts` and wrapped Claude. The
 * surface area is unchanged — callers still do `callAI({ model, system,
 * userContent, maxTokens, temperature, timeoutMs })` — but under the hood
 * we call OpenAI's chat-completions API. The existing Ninny code already
 * uses OpenAI (`gpt-4o-mini`) so keys + CSP are in place.
 *
 * Model constants:
 *   LLM_MAIN   → gpt-4o            (Sonnet-tier: generation + teaching)
 *   LLM_CHEAP  → gpt-4o-mini       (Haiku-tier: socratic, feedback)
 *
 * If we ever want to re-add Claude we change the body of callAI, not the
 * callers.
 */

// ── Model constants ──────────────────────────────────────────────────────────
export const LLM_MAIN  = "gpt-4o";
export const LLM_CHEAP = "gpt-4o-mini";

// Back-compat aliases so anywhere still referring to the old names keeps
// building. Safe to remove once all callers are on LLM_MAIN / LLM_CHEAP.
export const CLAUDE_SONNET = LLM_MAIN;
export const CLAUDE_HAIKU  = LLM_CHEAP;

// Per-million-token pricing in micro-USD (1 USD = 1,000,000 micro-USD).
// OpenAI public pricing as of knowledge cutoff.
const PRICING_MICRO_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-4o":      { input: 2_500_000, output: 10_000_000 },
  "gpt-4o-mini": { input:   150_000, output:    600_000 },
};

// ── Types ────────────────────────────────────────────────────────────────────
export interface AiCallOptions {
  model: typeof LLM_MAIN | typeof LLM_CHEAP | string;
  system: string;
  /** Either a plain string (wrapped as a single user message) or a full messages array. */
  userContent: string | ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** If true, asks OpenAI for JSON output via response_format. Defaults true when using callAIForJson. */
  jsonMode?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AiResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Integer micro-USD, computed from the pricing table for the model used. */
  costMicroUsd: number;
  model: string;
  stopReason?: string | null;
}

// ── Core call ────────────────────────────────────────────────────────────────
export async function callAI(opts: AiCallOptions): Promise<AiResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const userMessages: ChatMessage[] = Array.isArray(opts.userContent)
    ? opts.userContent
    : [{ role: "user", content: opts.userContent }];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      messages: [
        { role: "system", content: opts.system },
        ...userMessages,
      ],
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";

  const inputTokens = Number(data?.usage?.prompt_tokens ?? 0) | 0;
  const outputTokens = Number(data?.usage?.completion_tokens ?? 0) | 0;

  const pricing = PRICING_MICRO_PER_MTOK[opts.model];
  const costMicroUsd = pricing
    ? Math.round(
        (inputTokens / 1_000_000) * pricing.input +
        (outputTokens / 1_000_000) * pricing.output,
      )
    : 0;

  return {
    text,
    inputTokens,
    outputTokens,
    costMicroUsd,
    model: opts.model,
    stopReason: data?.choices?.[0]?.finish_reason ?? null,
  };
}

/**
 * Pulls the first balanced `{...}` block from the model's text and parses it.
 * Handles models that wrap JSON in prose ("Here's the JSON: { ... }") even
 * when we ask for JSON-only — more robust than indexOf('{') / lastIndexOf('}').
 */
export function extractJson<T>(text: string): T {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("No JSON object in AI response");

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try { return JSON.parse(slice) as T; }
        catch (e) {
          throw new Error(`AI JSON parse failed: ${(e as Error).message}`);
        }
      }
    }
  }
  throw new Error("Unbalanced JSON in AI response");
}

/**
 * Convenience: call the model in JSON mode and return the parsed payload
 * alongside token telemetry. Used by every Mastery Mode route that expects
 * structured output.
 */
export async function callAIForJson<T>(
  opts: AiCallOptions,
): Promise<{ json: T; raw: AiResult }> {
  const raw = await callAI({ ...opts, jsonMode: opts.jsonMode ?? true });
  const json = extractJson<T>(raw.text);
  return { json, raw };
}

// ── Back-compat shims for files still importing the old names ───────────────
export const callClaude = callAI;
export const callClaudeForJson = callAIForJson;
