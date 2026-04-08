export function cdnUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_CDN_URL}${path}`;
}
