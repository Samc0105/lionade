export function cdnUrl(path: string): string {
  // Illustrations (achievement/rank/streak/subject art) ship in the repo's
  // public/ and were never uploaded to the CDN bucket, so routing them through
  // NEXT_PUBLIC_CDN_URL 403s (CloudFront returns 403 for a missing object).
  // Serve them same-origin from Vercel's public/ instead — reliable for
  // repo-bundled assets and free of the CDN-sync gap. (If they're ever synced
  // to the bucket, drop this special-case.)
  if (path.startsWith("/illustrations/")) return path;
  return `${process.env.NEXT_PUBLIC_CDN_URL}${path}`;
}
