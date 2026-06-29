"use client";

import SegmentError from "@/components/SegmentError";

export default function SocialError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} label="social" />;
}
