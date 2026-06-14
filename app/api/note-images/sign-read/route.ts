import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isS3Configured, presignNoteImageRead, keyOwnedBy } from "@/lib/s3";

/**
 * GET /api/note-images/sign-read?key=user-uploads/<uid>/<uuid>.<ext>
 *
 * Returns a short-lived presigned GET URL for an S3-hosted note photo. The
 * ownership check (lib/s3.keyOwnedBy) is the security boundary: the key must
 * match the strict shape AND its owner segment must equal the caller. A key
 * the caller doesn't own returns 404 (not 403) so we don't confirm existence.
 *
 * DORMANT until the S3 bucket + IAM keys are provisioned: returns 503 when the
 * pilot is not configured (see docs/specs/note-images-s3-pilot.md, Phase A).
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!isS3Configured()) {
    return NextResponse.json(
      { error: "Photo storage is not available right now." },
      { status: 503 },
    );
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!keyOwnedBy(key, auth.userId)) {
    // Wrong shape or not the caller's object — don't reveal which.
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    const url = await presignNoteImageRead(key);
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[note-images/sign-read]", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "Couldn't load the photo." }, { status: 500 });
  }
}
