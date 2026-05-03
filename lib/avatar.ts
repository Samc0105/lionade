/**
 * Resolve a user's avatar URL with a deterministic DiceBear fallback.
 *
 * Many users have null `avatar_url` — without a fallback, `<img src="">`
 * renders as a broken image. The fallback matches the URL the signup
 * trigger and `lib/auth.tsx` use, so a user's "default" avatar is stable
 * across leaderboards, social, navbar, and the dashboard.
 */
export function avatarFor(
  username: string | null | undefined,
  avatarUrl: string | null | undefined,
): string {
  if (avatarUrl) return avatarUrl;
  const seed = username && username.trim().length > 0 ? username : "user";
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}&backgroundColor=4A90D9`;
}
