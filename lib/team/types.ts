// Team management (admin IAM) — shared types.
//
// Mirrors the `team_members` table created in migration 20260616121503
// (run manually by Sam). The string-union enums below are the source of
// truth for the API layer; they MUST stay in sync with the CHECK
// constraints on the table. The DB is authoritative — if a value is added
// there (e.g. a new role), add it here too or the typed insert/read will
// silently drift.
//
// Server-only domain: these types describe rows accessed via supabaseAdmin
// (service role) behind requireRole(req, "admin").

/** team_members.role — CHECK constraint values. */
export type TeamRole =
  | "founder"
  | "engineer"
  | "support"
  | "contractor"
  | "advisor"
  | "former_team";

/** team_members.lionade_access — what this person can do inside the product. */
export type LionadeAccess = "none" | "viewer" | "editor" | "admin";

/** team_members.status — lifecycle of the team membership. */
export type TeamStatus = "active" | "suspended" | "offboarded" | "pending";

/**
 * A row from the `team_members` table. Column names use snake_case to match
 * the DB exactly so a `select("*")` maps straight onto this type without a
 * transform layer. Timestamps are ISO-8601 strings (Postgres timestamptz as
 * returned by supabase-js).
 */
export interface TeamMember {
  id: string;
  /** FK -> auth.users(id) ON DELETE SET NULL. Null before the auth user is
   *  linked (pending invite) or after the underlying account is deleted. */
  user_id: string | null;
  full_name: string;
  /** UNIQUE; matches ^[a-z][a-z0-9.-]{2,30}$. Local-part of the team email. */
  username: string;
  /** UNIQUE; the issued team mailbox, e.g. "username@getlionade.com". */
  email_address: string;
  /** Personal/forwarding destination. Where the team mailbox forwards to. */
  personal_email: string | null;
  /** Cloudflare Email Routing rule id backing email_address. Null until the
   *  forwarding rule is provisioned (or after the provider deletes it). */
  cloudflare_address_id: string | null;
  role: TeamRole;
  /** DEFAULT 'none'. */
  lionade_access: LionadeAccess;
  /** DEFAULT 'pending'. */
  status: TeamStatus;
  /** DEFAULT true — force a password rotation on first sign-in. */
  must_change_password: boolean;
  /** FK -> profiles(id). The admin who created this team member. */
  invited_by: string | null;
  invited_at: string | null;
  activated_at: string | null;
  offboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A forwarding address as reported by the email provider (Cloudflare Email
 * Routing today). Provider-shaped, NOT a DB row — `addressId` is the
 * provider's rule id that we persist into team_members.cloudflare_address_id.
 */
export interface EmailAddress {
  /** Provider rule id (Cloudflare routing rule id). */
  addressId: string;
  /** Full mailbox the rule matches, e.g. "username@getlionade.com". */
  address: string;
  /** Where mail to `address` is forwarded. Null if the rule has no forward
   *  action (e.g. drop/worker rules surfaced by the provider). */
  forwardTo: string | null;
  /** Whether the provider currently has the rule enabled. */
  enabled: boolean;
}
