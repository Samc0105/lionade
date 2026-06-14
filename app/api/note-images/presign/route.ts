import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isS3Configured, presignNoteImageUpload, extForContentType } from "@/lib/s3";

/**
 * POST /api/note-images/presign — mint a presigned S3 POST for a note-image
 * upload (the iOS note-photo flow). The client uploads bytes straight to S3;
 * the bytes never transit our server.
 *
 * Body: { contentType: "image/jpeg" | "image/png" | "image/webp" }
 * Returns: { url, fields, token }  — POST the form to `url` with `fields` + the
 * file, then embed `![photo](<token>)` in class_notes.body.
 *
 * The object key is derived server-side from the JWT userId, so a client can
 * never upload outside its own `user-uploads/<userId>/` prefix. Size + type are
 * enforced by the presigned POST policy (see lib/s3.ts).
 *
 * DORMANT until the S3 bucket + IAM keys are provisioned: returns 503 when the
 * pilot is not configured (see docs/specs/note-images-s3-pilot.md, Phase A).
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  if (!isS3Configured()) {
    return NextResponse.json(
      { error: "Photo upload is not available right now." },
      { status: 503 },
    );
  }

  let body: { contentType?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const contentType = typeof body.contentType === "string" ? body.contentType : "";
  if (!extForContentType(contentType)) {
    return NextResponse.json(
      { error: "Unsupported image type. Use JPG, PNG, or WebP." },
      { status: 400 },
    );
  }

  try {
    const result = await presignNoteImageUpload(auth.userId, contentType);
    if (!result) {
      return NextResponse.json({ error: "Unsupported image type." }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[note-images/presign]", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "Couldn't prepare the upload." }, { status: 500 });
  }
}
