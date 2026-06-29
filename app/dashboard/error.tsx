"use client";

import SegmentError from "@/components/SegmentError";

export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} label="dashboard" />;
}
