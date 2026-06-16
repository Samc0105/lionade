// Admin credential vault — shared types (server-only domain).
//
// Mirrors the `shared_credentials` table created in migration
// 20260616130000_shared_credentials.sql (run manually by Sam). Column names use
// snake_case to match the DB exactly so a non-secret `select(...)` maps straight
// onto VaultItem without a transform layer.
//
// SECURITY INVARIANT: VaultItem deliberately OMITS secret_ciphertext, secret_iv,
// and secret_auth_tag. The list/create/update routes select only these
// non-secret columns and return only this shape, so a sealed secret can never
// leave the server by accident. The plaintext secret leaves the server in
// EXACTLY one place: the reveal route's response body, and never as a stored
// type. Timestamps are ISO-8601 strings (Postgres timestamptz via supabase-js).

/**
 * The non-secret projection of a `shared_credentials` row. This is the only
 * shape returned by the list/create/update routes. It carries no ciphertext,
 * IV, or auth tag — never widen it to include those columns.
 */
export interface VaultItem {
  id: string;
  /** Human-readable name, e.g. "Stripe dashboard". Required, non-empty. */
  label: string;
  /** Free-text grouping (social / email / infra / ...). Nullable. */
  category: string | null;
  /** NON-secret: the login email/handle, for display and search. Nullable. */
  username: string | null;
  /** NON-secret: where the credential is used. Nullable. */
  url: string | null;
  /** NON-secret notes. The secret itself is never stored here. Nullable. */
  notes: string | null;
  /** FK -> profiles(id) ON DELETE SET NULL. The admin who created the row. */
  created_by: string | null;
  /** FK -> profiles(id) ON DELETE SET NULL. The admin who last updated the row. */
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The exact non-secret column list to SELECT for any list/create/update read.
 * Keeping it in one place guarantees the three secret columns are never added
 * to a projection by a careless edit.
 */
export const VAULT_NON_SECRET_COLUMNS =
  "id, label, category, username, url, notes, created_by, updated_by, created_at, updated_at";
