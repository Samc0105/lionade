import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

function getWelcomeHtml(email: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#04080F;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#04080F;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:linear-gradient(135deg,#0d1528,#0a1020);border:1px solid rgba(74,144,217,0.15);border-radius:16px;padding:48px 36px;">
        <tr><td align="center" style="padding-bottom:28px;">
          <h1 style="margin:0;font-size:36px;letter-spacing:0.08em;color:#EEF4FF;font-family:'Bebas Neue',Impact,sans-serif;">
            LIONADE
          </h1>
          <div style="width:40px;height:3px;background:linear-gradient(90deg,#4A90D9,#6AABF0);border-radius:2px;margin:12px auto 0;"></div>
        </td></tr>

        <tr><td style="color:#EEF4FF;font-size:18px;font-weight:600;padding-bottom:8px;">
          Welcome to the waitlist! 👋
        </td></tr>

        <tr><td style="color:rgba(238,244,255,0.65);font-size:14px;line-height:1.7;padding-bottom:24px;">
          Thanks for signing up. <strong style="color:#EEF4FF;">Lionade</strong> is the study rewards platform for students who grind — daily quizzes, 1v1 duels, and real payouts for your knowledge.
        </td></tr>

        <tr><td style="color:rgba(238,244,255,0.65);font-size:14px;line-height:1.7;padding-bottom:24px;">
          <strong style="color:#4A90D9;">What happens next:</strong>
          <ul style="margin:8px 0 0;padding-left:20px;">
            <li style="margin-bottom:6px;">You'll get <strong style="color:#EEF4FF;">early access</strong> before public launch.</li>
            <li style="margin-bottom:6px;">We'll send updates on new features and launch dates.</li>
            <li>Early members get a <strong style="color:#FFD700;">bonus coin drop</strong> on day one.</li>
          </ul>
        </td></tr>

        <tr><td style="color:rgba(238,244,255,0.65);font-size:14px;line-height:1.7;padding-bottom:24px;">
          <strong style="color:#4A90D9;">Want priority access?</strong><br/>
          Share Lionade with friends and follow us on socials to move up the list.
        </td></tr>

        <tr><td style="padding:24px 0;border-top:1px solid rgba(74,144,217,0.1);">
          <p style="margin:0 0 4px;color:rgba(238,244,255,0.3);font-size:11px;">
            This is an automated message — please do not reply directly.
          </p>
          <p style="margin:0 0 4px;color:rgba(238,244,255,0.3);font-size:11px;">
            If you didn't sign up for Lionade, you can safely ignore this email.
          </p>
          <p style="margin:12px 0 0;color:rgba(238,244,255,0.2);font-size:11px;">
            Lionade &bull; all rights reserved
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    // Insert into Supabase (service role bypasses RLS)
    const { error: dbError } = await supabaseAdmin
      .from("waitlist")
      .insert({
        email,
        source: typeof body.source === "string" ? body.source : null,
        referrer: typeof body.referrer === "string" ? body.referrer : null,
      });

    if (dbError) {
      // Unique constraint violation — already on waitlist
      if (dbError.code === "23505") {
        return NextResponse.json(
          { error: "You're already on the waitlist! We'll be in touch soon." },
          { status: 409 }
        );
      }
      console.error("Waitlist DB error:", dbError.message);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      );
    }

    // Send welcome email via Resend (skip if key not configured)
    const resend = getResend();
    if (resend && process.env.EMAIL_FROM) {
      const { error: emailError } = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: email,
        replyTo: "lionade@gmail.com",
        subject: "Welcome to Lionade 👋",
        html: getWelcomeHtml(email),
      });

      if (emailError) {
        console.error("Resend email error:", emailError);
      }
    }

    return NextResponse.json(
      { message: "You're on the waitlist! Check your email." },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
