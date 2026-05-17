import { NextRequest, NextResponse } from "next/server";

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function POST(req: NextRequest) {
  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const submitted = typeof body?.password === "string" ? body.password : "";

  const expected = process.env.BETA_GATE_PASSWORD;
  if (!expected || expected.trim().length === 0) {
    // Fail closed: with no configured gate password we refuse all
    // requests rather than accepting a hardcoded default credential.
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (!submitted || submitted.length > 200) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!timingSafeEquals(submitted, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
