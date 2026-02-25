"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-1.5 text-cream/40 hover:text-cream/70 text-sm font-syne transition-colors mb-4"
    >
      <span className="text-base leading-none">&larr;</span>
      <span>Back</span>
    </button>
  );
}
