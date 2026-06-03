import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe, priceIdFor, type Tier, type Cycle } from "@/lib/stripe";
import { SITE_URL } from "@/lib/site-config";

export const runtime = "nodejs";

function isTier(v: unknown): v is Tier {
  return v === "pro" || v === "platinum";
}
function isCycle(v: unknown): v is Cycle {
  return v === "monthly" || v === "annual";
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const email = auth.email;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tier = (body as { tier?: unknown }).tier;
  const cycle = (body as { cycle?: unknown }).cycle;
  if (!isTier(tier) || !isCycle(cycle)) {
    return NextResponse.json({ error: "Invalid tier or cycle" }, { status: 400 });
  }

  const priceId = priceIdFor(tier, cycle);
  if (!priceId) {
    console.error("[stripe-checkout] missing price id env", tier, cycle);
    return NextResponse.json({ error: "Plan unavailable" }, { status: 500 });
  }

  // Look up / create the Stripe customer for this user.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) {
    console.error("[stripe-checkout] profile lookup", profileErr.message);
    return NextResponse.json({ error: "Account lookup failed" }, { status: 500 });
  }

  let customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
      if (updateErr) {
        // Fail closed BEFORE creating the Checkout Session. If we let the
        // checkout proceed, the webhook will fire with this customer id but
        // there's no `profiles.stripe_customer_id` row to match — silently
        // dropping the subscription. The user retries; on retry the Stripe
        // customer already exists (idempotent lookup happens on the next
        // POST via the profiles read above), so persist succeeds and
        // checkout proceeds.
        console.error("[stripe-checkout] persist customer id", updateErr.message);
        return NextResponse.json({ error: "Account update failed, please retry" }, { status: 500 });
      }
    } catch (err) {
      console.error("[stripe-checkout] stripe.customers.create", (err as Error).message);
      return NextResponse.json({ error: "Could not create customer" }, { status: 502 });
    }
  }

  // ALWAYS use the server-side site URL — never the request Origin header
  // (attacker-controlled, opens the success_url / cancel_url up to phishing
  // through our own Stripe Checkout redirect).
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 3,
        metadata: { user_id: userId, tier, cycle },
      },
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      success_url: `${SITE_URL}/account?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/pricing?upgrade=canceled`,
    });

    if (!session.url) {
      console.error("[stripe-checkout] session created without url", session.id);
      return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe-checkout] sessions.create", (err as Error).message);
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
  }
}
