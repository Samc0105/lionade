/**
 * Profile API — username + profile-related endpoints.
 *
 * The /api/change-username route enforces a 365-day cooldown server-side
 * and also writes a row to `username_changes` for audit. Direct supabase
 * updates to `profiles.username` would bypass that, so this method is the
 * only correct path for renaming.
 *
 * `display_name` + `bio` are PUBLIC, user-authored text and MUST go through
 * `updateProfile` (the /api/user/profile-update route), which moderates them
 * server-side (moderateText) before writing. The old assumption that a direct
 * client `supabase.update` was fine is WRONG: it bypassed moderation, and the
 * profiles BEFORE-UPDATE column guard (web migration 078) blocks client-side
 * writes to privileged columns anyway. `avatar_url` stays client-direct (it's a
 * URL, not free text, and isn't a guarded column).
 *
 * Usage:
 *   const r = await profileAPI.changeUsername(apiClient, "new_handle");
 *   const r2 = await profileAPI.updateProfile(apiClient, { display_name, bio });
 *   if (!r.ok) showError(r.error);
 */

import type { ApiClient, ApiResult } from "./http.js";

export interface ChangeUsernameResponse {
  success: true;
  username: string;
}

export interface UpdateProfileFields {
  display_name?: string;
  bio?: string;
  education_level?: string;
  study_goal?: string;
}

export interface UpdateProfileResponse {
  success: true;
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

  /**
   * Update the editable profile fields through the server. `display_name` and
   * `bio` are moderated server-side before persisting (they're public UGC); a
   * blocked value returns `ok:false` with the server's friendly error. Only the
   * keys you pass are written. Use this INSTEAD of a direct supabase.update on
   * `profiles` for these fields (username has its own changeUsername route).
   */
  updateProfile(
    client: ApiClient,
    fields: UpdateProfileFields,
  ): Promise<ApiResult<UpdateProfileResponse>> {
    return client.post<UpdateProfileResponse>("/api/user/profile-update", fields);
  },
} as const;
