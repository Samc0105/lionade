// Team mailbox provisioning — provider abstraction (server-only).
//
// Team members get an @getlionade.com mailbox that simply FORWARDS to their
// personal email. Today that's implemented with Cloudflare Email Routing
// (free, fetch-only, no SDK). The EmailProvider interface keeps the team API
// routes provider-agnostic so we can migrate to Google Workspace (real
// mailboxes) later without touching the call sites.
//
// ENV-GATING: every env var is read at CALL time inside getEmailProvider() /
// the request methods — NEVER at module load. Importing this file must never
// crash a route; a missing env surfaces as a clear "not configured" Error only
// when an email operation is actually attempted.
//
// Cloudflare Email Routing REST API reference:
//   GET/POST  zones/{zone}/email/routing/rules
//   GET/PUT/DELETE zones/{zone}/email/routing/rules/{rule_tag}
// Each rule has a `matchers` array (we match type:"literal", field:"to",
// value:"<mailbox>") and an `actions` array (we use type:"forward",
// value:["<personal email>"]). The rule `tag` is our addressId.

import type { EmailAddress } from "./types";

/** Network timeout for every Cloudflare API call (matches lib convention). */
const CF_TIMEOUT_MS = 15_000;
const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Provider-agnostic team-mailbox operations. `username` is the local-part
 * (e.g. "sam"); the provider appends the routing domain. `forwardTo` is the
 * personal destination address. `addressId` is the provider's opaque rule id,
 * persisted into team_members.cloudflare_address_id.
 */
export interface EmailProvider {
  /** Create a forwarding mailbox username@<domain> -> forwardTo. */
  createAddress(username: string, forwardTo: string): Promise<{ addressId: string }>;
  /** Tear down the mailbox by its provider rule id. */
  deleteAddress(addressId: string): Promise<void>;
  /** List all forwarding addresses the provider currently has. */
  listAddresses(): Promise<EmailAddress[]>;
  /** Re-point an existing mailbox at a new personal destination. */
  updateForwardingDestination(addressId: string, newForwardTo: string): Promise<void>;
}

// --- Cloudflare wire types (subset of the documented response shapes). ---

interface CfMatcher {
  type: string;
  field?: string;
  value?: string;
}
interface CfAction {
  type: string;
  value: string[];
}
interface CfRule {
  tag: string;
  name?: string;
  enabled?: boolean;
  matchers: CfMatcher[];
  actions: CfAction[];
}
interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

interface CloudflareConfig {
  token: string;
  zoneId: string;
  routingDomain: string;
}

/**
 * Reads Cloudflare config at CALL time. Throws a clear, env-naming error if
 * anything required is missing — never at module load. Note: the thrown
 * message lists the missing var name but NEVER its value (the token is a
 * secret).
 */
function cloudflareConfig(): CloudflareConfig {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const routingDomain = process.env.CLOUDFLARE_EMAIL_ROUTING_DOMAIN;
  const missing: string[] = [];
  if (!token) missing.push("CLOUDFLARE_API_TOKEN");
  if (!zoneId) missing.push("CLOUDFLARE_ZONE_ID");
  if (!routingDomain) missing.push("CLOUDFLARE_EMAIL_ROUTING_DOMAIN");
  if (missing.length > 0) {
    throw new Error(
      `Email provider not configured: set ${missing.join("/")}`,
    );
  }
  // Non-null asserted: the missing[] guard above proves all three are set.
  return { token: token!, zoneId: zoneId!, routingDomain: routingDomain! };
}

/** Whether the Cloudflare provider has everything it needs. Never throws. */
export function isEmailProviderConfigured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_API_TOKEN &&
      process.env.CLOUDFLARE_ZONE_ID &&
      process.env.CLOUDFLARE_EMAIL_ROUTING_DOMAIN,
  );
}

class CloudflareEmailProvider implements EmailProvider {
  /**
   * Thin wrapper over fetch: injects auth + timeout, parses the standard
   * Cloudflare envelope, and converts a non-success envelope into a thrown
   * Error. The thrown message is the Cloudflare error text (safe — never
   * contains our token, which lives only in the Authorization header).
   */
  private async cfFetch<T>(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<T> {
    const cfg = cloudflareConfig();
    let res: Response;
    try {
      res = await fetch(`${CF_API_BASE}/zones/${cfg.zoneId}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
        signal: AbortSignal.timeout(CF_TIMEOUT_MS),
      });
    } catch (e) {
      // Network/timeout: surface a clean message, never the raw secret-laden
      // request object.
      const reason = e instanceof Error ? e.message : "network error";
      throw new Error(`Cloudflare request failed: ${reason}`);
    }

    let envelope: CfEnvelope<T> | null = null;
    try {
      envelope = (await res.json()) as CfEnvelope<T>;
    } catch {
      throw new Error(`Cloudflare returned a non-JSON response (HTTP ${res.status})`);
    }

    if (!res.ok || !envelope.success) {
      const detail =
        envelope.errors?.map((x) => x.message).join("; ") || `HTTP ${res.status}`;
      throw new Error(`Cloudflare API error: ${detail}`);
    }
    return envelope.result;
  }

  async createAddress(
    username: string,
    forwardTo: string,
  ): Promise<{ addressId: string }> {
    const cfg = cloudflareConfig();
    const mailbox = `${username}@${cfg.routingDomain}`;
    const rule = await this.cfFetch<CfRule>("/email/routing/rules", {
      method: "POST",
      body: {
        name: `team:${username}`,
        enabled: true,
        matchers: [{ type: "literal", field: "to", value: mailbox }],
        actions: [{ type: "forward", value: [forwardTo] }],
      },
    });
    return { addressId: rule.tag };
  }

  async deleteAddress(addressId: string): Promise<void> {
    await this.cfFetch<unknown>(
      `/email/routing/rules/${encodeURIComponent(addressId)}`,
      { method: "DELETE" },
    );
  }

  async listAddresses(): Promise<EmailAddress[]> {
    const rules = await this.cfFetch<CfRule[]>("/email/routing/rules", {
      method: "GET",
    });
    return rules.map((rule) => {
      const toMatcher = rule.matchers.find((m) => m.field === "to");
      const forwardAction = rule.actions.find((a) => a.type === "forward");
      return {
        addressId: rule.tag,
        address: toMatcher?.value ?? "",
        forwardTo: forwardAction?.value?.[0] ?? null,
        enabled: rule.enabled ?? false,
      };
    });
  }

  async updateForwardingDestination(
    addressId: string,
    newForwardTo: string,
  ): Promise<void> {
    // Cloudflare PUT replaces the whole rule, so we GET the current rule to
    // preserve its matcher/name/enabled and only swap the forward target.
    const current = await this.cfFetch<CfRule>(
      `/email/routing/rules/${encodeURIComponent(addressId)}`,
      { method: "GET" },
    );
    await this.cfFetch<CfRule>(
      `/email/routing/rules/${encodeURIComponent(addressId)}`,
      {
        method: "PUT",
        body: {
          name: current.name,
          enabled: current.enabled ?? true,
          matchers: current.matchers,
          actions: [{ type: "forward", value: [newForwardTo] }],
        },
      },
    );
  }
}

/**
 * Google Workspace stub. Migration path: instead of Cloudflare forwarding
 * rules, this would call the Admin SDK Directory API
 * (admin.googleapis.com/admin/directory/v1) to create REAL mailboxes —
 * users.insert for a full account, or users.aliases for a forwarding alias —
 * authenticated with a service account using domain-wide delegation. The
 * EmailProvider methods map roughly to:
 *   createAddress              -> users.insert (or users.aliases.insert)
 *   deleteAddress              -> users.delete (or users.aliases.delete)
 *   listAddresses              -> users.list (domain-scoped)
 *   updateForwardingDestination-> users.update forwarding settings (Gmail API)
 * When this lands, add a TEAM_EMAIL_PROVIDER env switch in getEmailProvider().
 */
class GoogleWorkspaceProvider implements EmailProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createAddress(_username: string, _forwardTo: string): Promise<{ addressId: string }> {
    throw new Error("Not implemented yet");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteAddress(_addressId: string): Promise<void> {
    throw new Error("Not implemented yet");
  }
  async listAddresses(): Promise<EmailAddress[]> {
    throw new Error("Not implemented yet");
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateForwardingDestination(_addressId: string, _newForwardTo: string): Promise<void> {
    throw new Error("Not implemented yet");
  }
}

// Keep the stub referenced so it isn't tree-shaken / flagged unused before the
// Workspace migration wires it into the factory.
export const _googleWorkspaceProvider: EmailProvider = new GoogleWorkspaceProvider();

/**
 * Factory — returns the active email provider. Validates Cloudflare env at
 * call time and throws a clear "not configured: set X" error when missing, so
 * routes can map it to a 503/500 with an actionable message. Today this always
 * returns the Cloudflare provider; a future TEAM_EMAIL_PROVIDER switch can
 * select GoogleWorkspaceProvider.
 */
export function getEmailProvider(): EmailProvider {
  // Surfaces "Email provider not configured: set CLOUDFLARE_API_TOKEN/..."
  // before any request method runs.
  cloudflareConfig();
  return new CloudflareEmailProvider();
}
