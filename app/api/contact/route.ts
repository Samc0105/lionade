import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { SUPPORT_EMAIL } from "@/lib/site-config";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// Escape HTML to prevent injection in the outgoing email body
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Whitelist to prevent header/subject injection via the category field
const ALLOWED_CATEGORIES = new Set([
  "bug",
  "feature",
  "question",
  "general",
  "Bug Report",
  "Feature Request",
  "General Question",
  "General",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name ?? "").slice(0, 100);
    const email = String(body.email ?? "").slice(0, 254);
    const category = String(body.category ?? "");
    const subject = String(body.subject ?? "").slice(0, 200);
    const message = String(body.message ?? "").slice(0, 5000);

    if (!name || !email || !category || !subject || !message) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }
    if (!ALLOWED_CATEGORIES.has(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    // Basic email shape check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const resend = getResend();
    if (!resend || !process.env.EMAIL_FROM) {
      return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
    }

    // Escape every user-supplied string before interpolating into HTML
    const safe = {
      name: escapeHtml(name),
      email: escapeHtml(email),
      category: escapeHtml(category),
      subject: escapeHtml(subject),
      message: escapeHtml(message).replace(/\n/g, "<br />"),
    };

    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `[${category}] ${subject}`,
      html: `
        <h2>${safe.category}</h2>
        <p><strong>From:</strong> ${safe.name} (${safe.email})</p>
        <p><strong>Subject:</strong> ${safe.subject}</p>
        <hr />
        <p>${safe.message}</p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Contact] Error:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
