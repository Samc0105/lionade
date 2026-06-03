import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-server";
import { stripe, lookupPrice } from "@/lib/stripe";
import { FANG_PACKS, isFangPackId } from "@/lib/fang-packs";
import { isFounderCapOpen } from "@/lib/cosmetic-grants";
import { getFounderBadge } from "@/lib/shop-catalog";

// Stripe needs the RAW request body for signature verification. Do not parse
// JSON, do not clone, do not run anything in middleware that touches the body.
// Node runtime is required (Edge/Vercel-edge mangles the body).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "Webhook misconfigured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed", (err as Error).message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency: only mark an event as processed AFTER the handler succeeds.
  // The 'errored' status path lets Stripe (and us) re-attempt without
  // double-applying the work — the handlers themselves are written to be
  // safe to re-run (UPDATE-by-customer is naturally idempotent).
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("event_id, status")
    .eq("event_id", event.id)
    .maybeSingle();

  if (lookupErr) {
    console.error("[stripe-webhook] idempotency lookup", lookupErr.message);
    // Fail closed: return 500 so Stripe retries. The alternative (process
    // anyway) risks double-applying on a transient DB blip.
    return NextResponse.json({ error: "Idempotency check failed" }, { status: 500 });
  }

  if (existing?.status === "processed") {
    // Already done — short-circuit so Stripe stops retrying.
    return NextResponse.json({ received: true, duplicate: true });
  }
  // existing with status='errored' → fall through to retry the handler.

  try {
    await dispatchHandler(event);

    // Mark as processed (upsert handles both first-time insert and the
    // 'errored' → 'processed' transition on a retry that finally succeeded).
    const { error: upsertErr } = await supabaseAdmin
      .from("stripe_webhook_events")
      .upsert({
        event_id: event.id,
        status: "processed",
        error_message: null,
        processed_at: new Date().toISOString(),
      });
    if (upsertErr) {
      // The handler ran successfully but we couldn't record it. Returning
      // 500 makes Stripe retry; the handler is idempotent so the retry will
      // re-apply the same write and try to upsert again. Better than
      // silently 200-ing and risking infinite Stripe retries on the NEXT
      // event because the row is missing.
      console.error("[stripe-webhook] processed upsert", upsertErr.message);
      return NextResponse.json({ error: "Idempotency write failed" }, { status: 500 });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    // Record the failure for visibility + future retries. Note we upsert
    // 'errored' rather than skip — that way Sam can grep the table for
    // sticky failures and the next Stripe retry knows to re-process.
    const errorTail =
      err instanceof Error ? err.message.slice(0, 500) : "Unknown error".slice(0, 500);
    await supabaseAdmin
      .from("stripe_webhook_events")
      .upsert({
        event_id: event.id,
        status: "errored",
        error_message: errorTail,
        processed_at: new Date().toISOString(),
      });

    console.error(
      "[stripe-webhook] handler failed:",
      event.type,
      event.id,
      (err as Error).message,
    );
    // 500 makes Stripe retry per its exponential-backoff schedule (up to 3
    // days). Combined with the 'errored' status row above, Sam has both a
    // log signal (Vercel) and a queryable signal (stripe_webhook_events).
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

async function dispatchHandler(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "payment") {
        await handleFangIapPayment(session);
        return;
      }
      // Subscription mode: no-op — subscription.created fires too and carries
      // the canonical fields.
      return;
    }

    case "customer.subscription.created":
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription, true);
      return;

    case "customer.subscription.updated":
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription, false);
      return;

    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return;

    case "customer.subscription.trial_will_end":
      // Fires ~3 days before trial end. Our trial IS 3 days so this fires
      // immediately at creation — useful as an early-warning email hook
      // ("you'll be charged on {date} unless you cancel"). V1: log only so
      // Sam can see trial-ending events flow through; the Resend wire-in is
      // a follow-up ticket so we don't conflate webhook hardening with a
      // new outbound email surface.
      await handleTrialWillEnd(event.data.object as Stripe.Subscription);
      return;

    case "invoice.payment_succeeded":
      await handleInvoicePayment(event.data.object as Stripe.Invoice, "active");
      return;

    case "invoice.payment_failed":
      await handleInvoicePayment(event.data.object as Stripe.Invoice, "past_due");
      return;

    default:
      // Unknown events: no-op (handler success → 200 to Stripe).
      return;
  }
}

async function handleSubscriptionUpsert(sub: Stripe.Subscription, isCreate: boolean) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const lookup = lookupPrice(priceId);
  if (!lookup) {
    throw new Error(`unknown price id: ${priceId ?? "null"}`);
  }

  const status = normalizeStatus(sub.status);

  // In API 2026-02-25.clover, `current_period_end` lives on the subscription
  // ITEM, not the subscription root. Read it from the first item.
  const periodEndUnix = item?.current_period_end ?? null;
  const periodEnd = toIso(periodEndUnix);

  // Stripe has a dedicated `sub.cancel_at` for scheduled cancels (used when
  // the user cancels mid-cycle and we let them keep access until period end).
  // Prefer it; fall back to current_period_end only if cancel_at_period_end
  // is true and cancel_at wasn't populated for some reason.
  const cancelAt = sub.cancel_at
    ? toIso(sub.cancel_at)
    : sub.cancel_at_period_end
      ? periodEnd
      : null;

  const update = {
    stripe_subscription_id: sub.id,
    subscription_tier: lookup.tier,
    subscription_status: status,
    subscription_current_period_end: periodEnd,
    subscription_cancel_at: cancelAt,
    subscription_cycle: lookup.cycle,
    // Mirror to legacy `plan` so the existing usePlan() hook + every server
    // gate that reads profiles.plan keeps working with zero callsite churn.
    plan: lookup.tier,
  };

  // First: lookup by stripe_customer_id (the normal happy path).
  const { data: byCustomer, error: byCustomerErr } = await supabaseAdmin
    .from("profiles")
    .update(update)
    .eq("stripe_customer_id", customerId)
    .select("id");

  if (byCustomerErr) {
    console.error("[stripe-webhook] profiles update by customer", byCustomerErr.message);
    throw new Error("profiles update by customer failed");
  }

  if (byCustomer && byCustomer.length > 0) {
    // Tier is always 'pro' | 'platinum' here (lookupPrice returns null for
    // unknown prices and we throw above). All resolved tiers qualify for
    // the Founding Scholar consideration on initial subscription.
    if (isCreate) {
      const resolvedUserId = (byCustomer[0] as { id: string }).id;
      await tryGrantFoundingScholar(resolvedUserId, sub.id);
    }
    return;
  }

  // Fallback: HIGH-7 — the checkout route is supposed to persist
  // stripe_customer_id before completing checkout, but if a stale half-state
  // slipped through (or the webhook fires before that write commits), use
  // the subscription's metadata.user_id we set in checkout to reconcile.
  // Then ALSO write back the missing stripe_customer_id so future webhooks
  // hit the fast path.
  const metaUserId =
    typeof sub.metadata?.user_id === "string" && sub.metadata.user_id.length > 0
      ? sub.metadata.user_id
      : null;

  if (!metaUserId) {
    console.error(
      "[stripe-webhook] profiles update matched 0 rows and no metadata.user_id",
      customerId,
      sub.id,
    );
    throw new Error("profiles update matched 0 rows (no metadata fallback)");
  }

  const { data: byMeta, error: byMetaErr } = await supabaseAdmin
    .from("profiles")
    .update({ ...update, stripe_customer_id: customerId })
    .eq("id", metaUserId)
    .select("id");

  if (byMetaErr) {
    console.error("[stripe-webhook] profiles update by metadata", byMetaErr.message);
    throw new Error("profiles update by metadata failed");
  }

  if (!byMeta || byMeta.length === 0) {
    console.error(
      "[stripe-webhook] profiles update by metadata matched 0 rows",
      metaUserId,
      customerId,
    );
    throw new Error("profiles update by metadata matched 0 rows");
  }

  console.warn(
    "[stripe-webhook] recovered subscription via metadata.user_id",
    metaUserId,
    customerId,
  );

  if (isCreate) {
    await tryGrantFoundingScholar(metaUserId, sub.id);
  }
}

/**
 * Shop V2 — fire-and-forget Founding Scholar founder-badge grant on the
 * first 1000 paid Pro/Platinum subscriptions. Cap check uses the
 * `is_founder_cap_open(badge_id, cap)` RPC and is race-safe at the DB
 * level via a UNIQUE constraint on (badge_id, user_id) plus the cap RPC
 * locking the count row.
 *
 * Never throws. A grant failure does NOT break the subscription upsert —
 * the user has paid and their subscription_tier is already set. If the
 * badge insert is skipped or errors, that's a missed perk we can backfill
 * via the `founder_grants` table directly.
 */
async function tryGrantFoundingScholar(userId: string, subscriptionId: string) {
  const badge = getFounderBadge("badge_founding_scholar");
  if (!badge) {
    console.error("[stripe-webhook] founding-scholar catalog miss");
    return;
  }
  try {
    const open = await isFounderCapOpen(supabaseAdmin, badge.id, badge.cap);
    if (!open) {
      // Cap full or RPC errored — either way, do nothing. This is the
      // expected path for subscriber #1001 onward.
      return;
    }
    const { error: grantErr } = await supabaseAdmin.from("founder_grants").insert({
      user_id: userId,
      badge_id: badge.id,
      source: "stripe_subscription",
      reference_id: subscriptionId,
    });
    if (grantErr) {
      // 23505 = already owned (idempotent re-fire on Stripe retry). Anything
      // else is logged but not surfaced — see header rationale.
      if (grantErr.code !== "23505") {
        console.error(
          "[stripe-webhook] founding-scholar grant",
          grantErr.message,
        );
      }
    }
  } catch (err) {
    console.error(
      "[stripe-webhook] founding-scholar grant threw",
      err instanceof Error ? err.message : "unknown",
    );
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update({
      subscription_tier: "free",
      subscription_status: "canceled",
      stripe_subscription_id: null,
      subscription_cancel_at: null,
      subscription_cycle: null,
      plan: "free",
    })
    .eq("stripe_customer_id", customerId)
    .select("id");
  if (error) {
    console.error("[stripe-webhook] profiles deleted update", error.message);
    throw new Error("profiles deleted update failed");
  }
  if (!data || data.length === 0) {
    console.error("[stripe-webhook] subscription.deleted matched 0 rows", customerId);
    throw new Error("subscription.deleted matched 0 rows");
  }
}

async function handleInvoicePayment(
  invoice: Stripe.Invoice,
  nextStatus: "active" | "past_due",
) {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  if (!customerId) return;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update({ subscription_status: nextStatus })
    .eq("stripe_customer_id", customerId)
    .select("id");
  if (error) {
    console.error("[stripe-webhook] invoice status update", error.message);
    throw new Error("invoice status update failed");
  }
  if (!data || data.length === 0) {
    console.error("[stripe-webhook] invoice payment matched 0 rows", customerId);
    throw new Error("invoice payment matched 0 rows");
  }
}

async function handleFangIapPayment(session: Stripe.Checkout.Session) {
  const meta = session.metadata ?? {};
  const userId = typeof meta.user_id === "string" ? meta.user_id : null;
  const packId = typeof meta.pack_id === "string" ? meta.pack_id : null;
  const fangAmountStr = typeof meta.fang_amount === "string" ? meta.fang_amount : null;

  if (!userId || !packId || !fangAmountStr) {
    console.error("[stripe-webhook] fang IAP missing metadata", session.id, meta);
    throw new Error("fang IAP missing metadata");
  }

  if (!isFangPackId(packId)) {
    console.error("[stripe-webhook] fang IAP unknown pack id", session.id, packId);
    throw new Error("fang IAP unknown pack id");
  }

  const parsedFangs = Number(fangAmountStr);
  if (!Number.isInteger(parsedFangs) || parsedFangs <= 0) {
    console.error("[stripe-webhook] fang IAP bad fang_amount", session.id, fangAmountStr);
    throw new Error("fang IAP bad fang_amount");
  }

  // Defense against tampered metadata — server-trusted amount comes from
  // FANG_PACKS, not from the session metadata.
  const expectedFangs = FANG_PACKS[packId].fangs;
  if (parsedFangs !== expectedFangs) {
    console.error(
      "[stripe-webhook] fang IAP amount mismatch",
      session.id,
      "metadata=",
      parsedFangs,
      "expected=",
      expectedFangs,
    );
    throw new Error("fang IAP amount mismatch");
  }

  // p_source='iap' → routes to profiles.fangs_iap (Apple 3.1.5(b) compliance,
  // IAP fangs cannot be cashable in V2).
  const { error: creditErr } = await supabaseAdmin.rpc("update_user_coins", {
    p_user_id: userId,
    p_delta: expectedFangs,
    p_min_balance: 0,
    p_source: "iap",
  });
  if (creditErr) {
    console.error("[stripe-webhook] fang IAP credit", creditErr.message);
    throw new Error("fang IAP credit failed");
  }

  try {
    await supabaseAdmin.from("coin_transactions").insert({
      user_id: userId,
      amount: expectedFangs,
      type: "fang_iap_purchase",
      reference_id: session.id,
      description: `Fang IAP: ${FANG_PACKS[packId].display_name} (${expectedFangs.toLocaleString()} Fangs)`,
    });
  } catch (err) {
    console.warn("[stripe-webhook] fang IAP txn log (non-fatal):", (err as Error).message);
  }

  console.info("[stripe-webhook] fang IAP credited:", userId, packId, expectedFangs);
}

async function handleTrialWillEnd(sub: Stripe.Subscription) {
  // Resolve the user this trial belongs to so the log line is greppable.
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const metaUserId =
    typeof sub.metadata?.user_id === "string" && sub.metadata.user_id.length > 0
      ? sub.metadata.user_id
      : null;
  const trialEnd = toIso(sub.trial_end ?? null);
  console.info(
    "[stripe-webhook] trial ending for user:",
    metaUserId ?? "(no metadata.user_id)",
    "customer:",
    customerId,
    "subscription:",
    sub.id,
    "trial_end:",
    trialEnd ?? "(none)",
  );
  // V1: no email send. The Resend hook wires in a separate ticket.
}

function normalizeStatus(
  s: Stripe.Subscription.Status,
): "trialing" | "active" | "past_due" | "canceled" | "incomplete" {
  switch (s) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "incomplete":
      return s;
    case "incomplete_expired":
      return "incomplete";
    case "unpaid":
      return "past_due";
    case "paused":
      return "canceled";
    default:
      return "incomplete";
  }
}

function toIso(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}
