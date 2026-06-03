import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site-config";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) {
    console.error("[stripe-portal] profile lookup", profileErr.message);
    return NextResponse.json({ error: "Account lookup failed" }, { status: 500 });
  }
  const customerId = profile?.stripe_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { error: "No active subscription on this account" },
      { status: 400 },
    );
  }

  // ALWAYS use the server-side site URL — never the request Origin header
  // (attacker-controlled, opens the return_url up to phishing through our
  // own Stripe Portal redirect).
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${SITE_URL}/account`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe-portal] sessions.create", (err as Error).message);
    return NextResponse.json({ error: "Portal unavailable" }, { status: 502 });
  }
}
