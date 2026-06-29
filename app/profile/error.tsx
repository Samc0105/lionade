"use client";

import SegmentError from "@/components/SegmentError";

export default function ProfileError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} label="profile" />;
}
