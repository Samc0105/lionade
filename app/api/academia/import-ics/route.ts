import { NextRequest, NextResponse } from "next/server";
import dns from "dns/promises";
import dnsCb from "dns";
import net from "net";
import http from "http";
import https from "https";
import type { IncomingMessage } from "http";
import { supabaseAdmin } from "@/lib/supabase-server";
import { requireAuth } from "@/lib/api-auth";

/**
 * POST /api/academia/import-ics — import a calendar feed as class assignments.
 *
 * Two modes, branched on body shape:
 *
 *   PREVIEW  { url }                         -> { events, count, truncated }
 *     Fetch + hand-parse the ICS feed, return parseable VEVENTs in the
 *     [today-7d, today+365d] window, sorted, capped at 200.
 *
 *   COMMIT   { classId, events[] }           -> { created }
 *     Owner-verify the class, bulk-insert each event as a class_assignments
 *     row (status 'todo', due_date = event date).
 *
 * SECURITY: PREVIEW fetches a USER-SUPPLIED URL server-side. This is a classic
 * SSRF sink, so the URL + every resolved IP + every redirect hop is validated
 * against private / loopback / link-local / reserved ranges before any socket
 * is opened. The fetch is size-capped, time-capped, and redirects are followed
 * manually so each hop is re-guarded. We NEVER leak the internal error, the
 * resolved IP, or the response body to the caller.
 *
 * The connection itself is made with node:http(s) using a CUSTOM `lookup` that
 * resolves the host, runs EVERY returned address through isBlockedIP, and hands
 * the socket exactly ONE pre-validated public address. There is no second,
 * uncontrolled name resolution between validation and connect, so the address
 * we validated IS the address we connect to — closing the DNS-rebinding TOCTOU
 * that a global fetch() (which re-resolves on its own) would leave open. SNI /
 * cert validation stay correct because we keep the original hostname as `host`
 * and only override which IP the lookup returns.
 *
 * requireAuth on BOTH modes. user_id always comes from the token, never body.
 * ZERO AI. No outbound calls beyond the single calendar fetch.
 */

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EVENTS = 200;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 3;
const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 365;

const GENERIC_FETCH_ERROR =
  "That calendar link could not be fetched. Check the URL and try again.";

// ─────────────────────────────────────────────────────────────────────────────
// SSRF guard
// ─────────────────────────────────────────────────────────────────────────────

/** True if an IPv4 string is in a private / loopback / link-local / reserved range. */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable -> treat as blocked
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/** True if an IPv6 string is loopback / unique-local / link-local / mapped-private. */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0]; // strip zone id
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — validate the embedded v4.
  const mapped = lower.match(/^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  // Hex-form IPv4-mapped, e.g. ::ffff:7f00:1
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedIPv4(v4);
  }
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

function isBlockedIP(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isBlockedIPv4(ip);
  if (kind === 6) return isBlockedIPv6(ip);
  return true; // not an IP literal we recognize -> blocked
}

/**
 * Validate a single URL: scheme, no embedded creds, no obviously-internal
 * hostname, and DNS-resolve the host rejecting any private/reserved address.
 * Throws on any failure (caller maps to the generic 400). Returns the hostname.
 */
async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("unparseable url");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("bad scheme");
  }
  if (u.username || u.password) {
    throw new Error("embedded credentials");
  }

  const host = u.hostname.toLowerCase().replace(/\.$/, ""); // trailing-dot normalize
  if (!host) throw new Error("empty host");
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("localhost");
  if (host.endsWith(".local")) throw new Error("mdns .local");

  // Raw-IP host: validate directly (bracketed IPv6 -> URL strips brackets in hostname).
  if (net.isIP(host)) {
    if (isBlockedIP(host)) throw new Error("blocked literal ip");
    return;
  }

  // Hostname: resolve ALL addresses and reject if ANY is blocked. Rejecting on
  // any single bad address closes DNS-rebinding-style multi-record tricks.
  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("dns failure");
  }
  if (records.length === 0) throw new Error("no dns records");
  for (const r of records) {
    if (isBlockedIP(r.address)) throw new Error("resolved to blocked ip");
  }
}

/**
 * Pinned DNS lookup factory. Returns a node:http(s) `lookup` implementation
 * bound to `expectedHost` that resolves the host, runs EVERY returned address
 * through isBlockedIP, and hands the socket exactly one pre-validated PUBLIC
 * address. If any/all addresses are blocked (or resolution fails) it errors
 * the callback so the socket is never opened.
 *
 * This is the TOCTOU closer: node connects to precisely the address this
 * callback returns, so the address we validated IS the address we connect to.
 * No independent re-resolution happens between validation and connect.
 */
type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

function makePinnedLookup(expectedHost: string) {
  return (
    hostname: string,
    _options: unknown,
    callback: LookupCb,
  ): void => {
    // Guard against the agent calling lookup for some other host than the one
    // we validated (e.g. a Host-header / connection-reuse mismatch).
    if (hostname.toLowerCase().replace(/\.$/, "") !== expectedHost) {
      callback(new Error("lookup host mismatch") as NodeJS.ErrnoException, "", 0);
      return;
    }
    dnsCb.lookup(hostname, { all: true }, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        callback(
          (err ?? new Error("no dns records")) as NodeJS.ErrnoException,
          "",
          0,
        );
        return;
      }
      // Reject if ANY resolved address is blocked — matches assertSafeUrl's
      // posture and prevents a rebinding record set from slipping a private IP
      // past us. Then pin to the first surviving (public) address.
      for (const a of addresses) {
        if (isBlockedIP(a.address)) {
          callback(
            new Error("resolved to blocked ip") as NodeJS.ErrnoException,
            "",
            0,
          );
          return;
        }
      }
      const chosen = addresses[0];
      callback(null, chosen.address, chosen.family);
    });
  };
}

/**
 * Fetch the ICS feed with the full SSRF posture: per-hop host re-validation,
 * manual redirect following (max 3), 8s timeout, 2 MB body cap. Returns the
 * raw text. Throws on any failure; caller maps to a generic 400.
 *
 * Uses node:http(s) with a pinned `lookup` (see makePinnedLookup) so the
 * connected address is exactly the validated one — no DNS-rebinding gap.
 */
async function fetchIcsSafely(startUrl: string): Promise<string> {
  let currentUrl = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertSafeUrl(currentUrl); // re-guard EVERY hop, including the original

    const { status, location, text } = await requestPinned(currentUrl);

    // Manual redirect handling: re-validate the Location target through the
    // SAME guard before re-fetching. Never auto-follow.
    if (status >= 300 && status < 400) {
      if (!location) throw new Error("redirect with no location");
      if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
      // Resolve relative redirects against the current URL, then re-guard at
      // the top of the loop (which re-runs assertSafeUrl + a fresh pinned
      // lookup for the new host).
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (status < 200 || status >= 300) throw new Error(`http ${status}`);

    const head = (text ?? "").trimStart().slice(0, 64).toUpperCase();
    if (!head.startsWith("BEGIN:VCALENDAR")) {
      throw new Error("not an ics feed");
    }
    return text ?? "";
  }

  throw new Error("redirect loop exhausted");
}

interface PinnedResult {
  status: number;
  location: string | null;
  /** Body text, only read for non-redirect 2xx responses. */
  text: string | null;
}

/**
 * Perform a single GET against `rawUrl` over node:http(s) with a pinned lookup,
 * an 8s timeout, and a 2 MB streamed body cap. On a 3xx we return status +
 * location WITHOUT reading the body (the redirect target is re-validated by the
 * caller). Content-Length is never trusted — we count bytes off the socket.
 */
function requestPinned(rawUrl: string): Promise<PinnedResult> {
  const u = new URL(rawUrl);
  const isHttps = u.protocol === "https:";
  const transport = isHttps ? https : http;
  const expectedHost = u.hostname.toLowerCase().replace(/\.$/, "");

  return new Promise<PinnedResult>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const req = transport.request(
      {
        protocol: u.protocol,
        // host = the real hostname (keeps Host header + TLS SNI / cert
        // validation correct); the pinned lookup decides which IP we connect to.
        host: u.hostname,
        servername: isHttps ? u.hostname : undefined,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          Host: u.host,
          "User-Agent": "Lionade/1.0 (support@getlionade.com)",
          Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
        },
        lookup: makePinnedLookup(expectedHost),
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;

        // Redirect: grab Location, discard the body, let the caller re-validate.
        if (status >= 300 && status < 400) {
          const loc = res.headers.location ?? null;
          res.resume(); // drain so the socket can be freed
          done(() => resolve({ status, location: loc, text: null }));
          return;
        }

        // Stream + cap. Never trust Content-Length; count actual bytes.
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_BODY_BYTES) {
            res.destroy();
            req.destroy();
            done(() => reject(new Error("body too large")));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          done(() => resolve({ status, location: null, text }));
        });
        res.on("error", (e) => done(() => reject(e)));
      },
    );

    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy();
      done(() => reject(new Error("timeout")));
    });
    req.on("error", (e) => done(() => reject(e)));
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hand-rolled ICS parser (RFC 5545, V1: DTSTART date only, RRULE ignored)
// ─────────────────────────────────────────────────────────────────────────────

interface IcsEvent {
  title: string;
  date: string; // YYYY-MM-DD
}

/**
 * RFC 5545 line unfolding: a line beginning with a space or tab is a
 * continuation of the previous logical line. Strip the single leading
 * whitespace and concatenate. Handles CRLF and bare LF.
 */
function unfold(raw: string): string[] {
  const physical = raw.split(/\r\n|\n|\r/);
  const logical: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else {
      logical.push(line);
    }
  }
  return logical;
}

/** Unescape RFC 5545 TEXT values: \n \, \; \\ . */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * Pull the YYYY-MM-DD date out of a DTSTART value. Handles:
 *   DATE form:        20260315
 *   DATE-TIME (UTC):  20260315T090000Z
 *   DATE-TIME local:  20260315T090000   (TZID-prefixed or floating)
 * Returns null if the leading 8 digits aren't a plausible calendar date.
 */
function parseDtStartDate(value: string): string | null {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const monthNum = Number(mo);
  const dayNum = Number(d);
  if (monthNum < 1 || monthNum > 12) return null;
  if (dayNum < 1 || dayNum > 31) return null;
  return `${y}-${mo}-${d}`;
}

/**
 * Split a content line into its property name (before the first ':' that is
 * not inside a quoted param) and its value. Params after ';' on the name side
 * are kept on the name (e.g. "DTSTART;TZID=America/New_York").
 */
function splitLine(line: string): { name: string; value: string } | null {
  // Find the first unquoted colon.
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      return { name: line.slice(0, i), value: line.slice(i + 1) };
    }
  }
  return null;
}

/**
 * Parse VEVENT blocks defensively. Never throws — a malformed feed yields
 * whatever parsed cleanly. Each event needs both a SUMMARY and a parseable
 * DTSTART or it is skipped.
 */
function parseIcs(raw: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  let inEvent = false;
  let summary: string | null = null;
  let date: string | null = null;

  try {
    for (const line of unfold(raw)) {
      const upper = line.toUpperCase();
      if (upper === "BEGIN:VEVENT") {
        inEvent = true;
        summary = null;
        date = null;
        continue;
      }
      if (upper === "END:VEVENT") {
        if (inEvent && summary && date) out.push({ title: summary, date });
        inEvent = false;
        summary = null;
        date = null;
        continue;
      }
      if (!inEvent) continue;

      const parsed = splitLine(line);
      if (!parsed) continue;
      const propName = parsed.name.split(";")[0].toUpperCase();

      if (propName === "SUMMARY") {
        const t = unescapeText(parsed.value).slice(0, 200);
        if (t.length > 0) summary = t;
      } else if (propName === "DTSTART") {
        const d = parseDtStartDate(parsed.value);
        if (d) date = d;
      }
    }
  } catch {
    // Defensive: return whatever we collected before the throw.
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

function todayUtcMs(): number {
  return Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
}

function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  return DATE_RE.test(s) ? s : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ownership
// ─────────────────────────────────────────────────────────────────────────────

async function verifyClassOwnership(classId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("classes")
    .select("user_id, archived")
    .eq("id", classId)
    .single();
  return !!data && data.user_id === userId && !data.archived;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — branches on body shape
// ─────────────────────────────────────────────────────────────────────────────

interface ReqBody {
  url?: unknown;
  classId?: unknown;
  events?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // COMMIT mode: a classId means "save these events".
  if (typeof body.classId === "string") {
    return commit(body, userId);
  }
  // PREVIEW mode: a url means "fetch + parse".
  if (typeof body.url === "string") {
    return preview(body.url);
  }

  return NextResponse.json({ error: "Provide a calendar url or a classId." }, { status: 400 });
}

// ── PREVIEW ─────────────────────────────────────────────────────────────────
async function preview(url: string): Promise<NextResponse> {
  let raw: string;
  try {
    raw = await fetchIcsSafely(url.trim());
  } catch (e) {
    // Log the real reason server-side only; the caller gets a generic message.
    console.error("[academia/import-ics preview]", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: GENERIC_FETCH_ERROR }, { status: 400 });
  }

  const parsed = parseIcs(raw);

  const lowMs = todayUtcMs() - WINDOW_PAST_DAYS * 86_400_000;
  const highMs = todayUtcMs() + WINDOW_FUTURE_DAYS * 86_400_000;

  const inWindow = parsed.filter((ev) => {
    const ms = Date.parse(ev.date + "T00:00:00Z");
    return !Number.isNaN(ms) && ms >= lowMs && ms <= highMs;
  });

  inWindow.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const truncated = inWindow.length > MAX_EVENTS;
  const events = inWindow.slice(0, MAX_EVENTS);

  return NextResponse.json({ events, count: events.length, truncated });
}

// ── COMMIT ──────────────────────────────────────────────────────────────────
async function commit(body: ReqBody, userId: string): Promise<NextResponse> {
  const classId = String(body.classId);

  if (!(await verifyClassOwnership(classId, userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rawEvents = Array.isArray(body.events) ? body.events : [];

  // Build clean rows. Invalid events (bad date, empty title) are skipped rather
  // than 500'd, so one malformed entry never sinks an otherwise-good import.
  const rows = rawEvents
    .slice(0, MAX_EVENTS)
    .map((ev) => {
      const e = ev as { date?: unknown; title?: unknown };
      const date = parseDate(e?.date);
      const title = String(e?.title ?? "").trim().slice(0, 200);
      if (!date || title.length < 1) return null;
      return {
        user_id: userId,
        class_id: classId,
        title,
        due_date: date,
        status: "todo" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return NextResponse.json({ created: 0 });
  }

  const { data, error } = await supabaseAdmin
    .from("class_assignments")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("[academia/import-ics commit]", error.message);
    return NextResponse.json({ error: "Couldn't import the calendar." }, { status: 500 });
  }

  return NextResponse.json({ created: data?.length ?? 0 }, { status: 201 });
}
