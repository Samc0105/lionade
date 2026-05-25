import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-server";
import { renderEmail, templates } from "@/lib/emails";
import { absoluteUrl } from "@/lib/site-config";

function getResend() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM;
  if (!apiKey || !emailFrom) {
    console.error("[waitlist] missing RESEND_API_KEY or EMAIL_FROM");
  }

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

    // Send welcome email via Resend — uses lib/emails skeleton (Phase 1)
    const resend = getResend();
    if (!resend) {
      console.warn("[waitlist] RESEND_API_KEY is not set — skipping welcome email for:", email);
    } else if (!process.env.EMAIL_FROM) {
      console.warn("[waitlist] EMAIL_FROM is not set — skipping welcome email for:", email);
    } else {
      const { subject, html, text } = renderEmail(templates.waitlistConfirmation, {
        // No display_name yet at waitlist stage — slot defaults to "friend"
        ctaUrl: absoluteUrl("/"),
        ctaLabel: "Visit Lionade",
      });
      const { data: emailData, error: emailError } = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: email,
        replyTo: "support@getlionade.com",
        subject,
        html,
        text,
      });

      if (emailError) {
        console.error("[waitlist] Resend email failed:", JSON.stringify(emailError));
      } else {
        console.log("[waitlist] Welcome email sent:", emailData?.id, "to:", email);
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
