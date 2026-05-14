/**
 * Profile API — username + profile-related endpoints.
 *
 * The /api/change-username route enforces a 365-day cooldown server-side
 * and also writes a row to `username_changes` for audit. Direct supabase
 * updates to `profiles.username` would bypass that, so this method is the
 * only correct path for renaming.
 *
 * Other profile fields (`display_name`, `bio`, `avatar_url`) are written
 * with a direct supabase.update from the client — RLS already restricts
 * `UPDATE` on `profiles` to `auth.uid() = id`, and there's no cooldown
 * or audit to honor. This module deliberately does NOT proxy those —
 * keeping them client-direct avoids an unnecessary round-trip.
 *
 * Usage:
 *   const r = await profileAPI.changeUsername(apiClient, "new_handle");
 *   if (!r.ok) showError(r.error);
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface ChangeUsernameResponse {
  success: true;
  username: string;
}

export const profileAPI = {
  /**
   * Rename the signed-in user. Server enforces:
   *   • 3-20 chars, [a-z0-9_] only (force-lowercased)
   *   • Uniqueness (no other profile may already hold the handle)
   *   • 365-day cooldown since the last change
   *
   * On 200 the server has updated `profiles.username`, inserted a row in
   * `username_changes`, and synced `auth.users.user_metadata.username`.
   */
  changeUsername(
    client: ApiClient,
    newUsername: string,
  ): Promise<ApiResult<ChangeUsernameResponse>> {
    return client.post<ChangeUsernameResponse>("/api/change-username", {
      newUsername,
    });
  },
} as const;
