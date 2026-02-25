import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(req: NextRequest) {
  try {
    const { name, email, category, subject, message } = await req.json();

    if (!name || !email || !category || !subject || !message) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    const resend = getResend();
    if (!resend || !process.env.EMAIL_FROM) {
      return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
    }

    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: "support@getlionade.com",
      replyTo: email,
      subject: `[${category}] ${subject}`,
      html: `
        <h2>${category}</h2>
        <p><strong>From:</strong> ${name} (${email})</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <hr />
        <p>${message.replace(/\n/g, "<br />")}</p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Contact] Error:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
