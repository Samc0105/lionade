/**
 * USD premium-cosmetic checkout. Sibling of /api/stripe/fang-purchase (one-time
 * Stripe Checkout, mode:"payment"), distinguished in the webhook by a
 * `purchase_kind: "premium_cosmetic"` metadata key so the existing Fang-IAP
 * path is provably untouched.
 *
 * GET  -> { available: string[] }  the premium ids that have a configured
 *         Stripe Price (so the shop can enable only the buyable items). Public:
 *         this is just "what is on sale," not sensitive.
 * POST { itemId } -> { url }  creates the Checkout Session. Fail-CLOSED: if the
 *         item has no configured Stripe Price the route returns "not yet
 *         available" and NEVER creates a session. The client sends only an
 *         itemId; price + grant are resolved server-side, never trusted.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe } from "@/lib/stripe";
import {
  getPremiumItem,
  getPremiumPriceId,
  getPurchasablePremiumIds,
  isPremiumItemId,
} from "@/lib/premium-items";
import { isFounderCapOpen } from "@/lib/cosmetic-grants";
import { SITE_URL } from "@/lib/site-config";
import { isDemoUser } from "@/lib/demo-guard";
import { demoBlockedResponse } from "@/lib/demo-guard-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ available: getPurchasablePremiumIds() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  const email = auth.email;

  // Shared demo account: no payments under the shared customer record.
  if (isDemoUser(userId)) return demoBlockedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const itemId = (body as { itemId?: unknown }).itemId;
  if (!isPremiumItemId(itemId)) {
    return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
  }

  const item = getPremiumItem(itemId)!;
  const priceId = getPremiumPriceId(itemId);
  if (!priceId) {
    // Dormant until Sam configures the Stripe Price. Clean fail-closed, never a
    // session, never a broken redirect — the UI shows "Coming soon" for this.
    return NextResponse.json({ error: "This item is not yet available" }, { status: 503 });
  }

  // Founder bundle: pre-check the cap at purchase time so we don't take money
  // for a sold-out badge. (The webhook still grants-anyway-and-logs if the cap
  // races closed after payment — money has changed hands by then.)
  if (item.grantKind === "founder_badge") {
    const open = await isFounderCapOpen(supabaseAdmin, item.id, item.cap ?? 0);
    if (!open) {
      return NextResponse.json({ error: "This founder badge is sold out" }, { status: 409 });
    }
  }

  // Look up / create the Stripe customer (mirrors fang-purchase).
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) {
    console.error("[stripe-usd-purchase] profile lookup", profileErr.message);
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
        // Fail closed BEFORE creating the session so the webhook can always
        // reconcile via stripe_customer_id / metadata.user_id.
        console.error("[stripe-usd-purchase] persist customer id", updateErr.message);
        return NextResponse.json({ error: "Account update failed, please retry" }, { status: 500 });
      }
    } catch (err) {
      console.error("[stripe-usd-purchase] stripe.customers.create", (err as Error).message);
      return NextResponse.json({ error: "Could not create customer" }, { status: 502 });
    }
  }

  try {
    const metadata = {
      user_id: userId,
      purchase_kind: "premium_cosmetic",
      item_id: item.id,
    };
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" },
      success_url: `${SITE_URL}/account?iap=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/shop?iap=canceled`,
    });

    if (!session.url) {
      console.error("[stripe-usd-purchase] session created without url", session.id);
      return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe-usd-purchase] sessions.create", (err as Error).message);
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
  }
}
