import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";
import { FANG_PACKS, fangPackPriceId, isFangPackId } from "@/lib/fang-packs";
import { SITE_URL } from "@/lib/site-config";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const email = auth.email;

  // Shared demo account: same rationale as /api/stripe/checkout — no
  // payments under the shared customer record.
  if (isDemoUser(userId)) return demoBlockedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const packId = (body as { packId?: unknown }).packId;
  if (!isFangPackId(packId)) {
    return NextResponse.json({ error: "Invalid pack id" }, { status: 400 });
  }

  const pack = FANG_PACKS[packId];
  const priceId = fangPackPriceId(packId);
  if (!priceId) {
    console.error("[stripe-fang-purchase] missing price id env", packId);
    return NextResponse.json({ error: "Pack unavailable" }, { status: 500 });
  }

  // Look up / create the Stripe customer for this user (mirrors checkout route).
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) {
    console.error("[stripe-fang-purchase] profile lookup", profileErr.message);
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
        // Fail closed BEFORE creating the Checkout Session so the webhook can
        // always reconcile via stripe_customer_id (metadata.user_id fallback
        // covers the rare half-state).
        console.error("[stripe-fang-purchase] persist customer id", updateErr.message);
        return NextResponse.json({ error: "Account update failed, please retry" }, { status: 500 });
      }
    } catch (err) {
      console.error("[stripe-fang-purchase] stripe.customers.create", (err as Error).message);
      return NextResponse.json({ error: "Could not create customer" }, { status: 502 });
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        user_id: userId,
        pack_id: packId,
        fang_amount: String(pack.fangs),
      },
      payment_intent_data: {
        metadata: {
          user_id: userId,
          pack_id: packId,
          fang_amount: String(pack.fangs),
        },
      },
      // Off by default (see /api/stripe/checkout). Flip STRIPE_AUTOMATIC_TAX=true
      // once Stripe Tax is configured.
      automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" },
      success_url: `${SITE_URL}/account?iap=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/shop?iap=canceled`,
    });

    if (!session.url) {
      console.error("[stripe-fang-purchase] session created without url", session.id);
      return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe-fang-purchase] sessions.create", (err as Error).message);
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
  }
}
