import type { Prisma, Tenant } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "../db.js";
import { getStripe } from "./stripe-billing.js";

function metaTenantId(metadata: Stripe.Metadata | null | undefined): string | undefined {
  const id = metadata?.tenantId?.trim();
  return id || undefined;
}

async function tenantByStripeRefs(
  tenantIdFromMeta: string | undefined,
  customerId: string | null | undefined,
): Promise<Tenant | null> {
  if (tenantIdFromMeta) {
    return prisma.tenant.findUnique({ where: { id: tenantIdFromMeta } });
  }
  if (customerId) {
    return prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } });
  }
  return null;
}

function readUnixPeriodEnd(obj: Record<string, unknown>, label: string): number {
  const top = obj["current_period_end"];
  if (typeof top === "number") return top;
  const items = obj["items"] as { data?: Record<string, unknown>[] } | undefined;
  const itemEnd = items?.data?.[0]?.["current_period_end"];
  if (typeof itemEnd === "number") return itemEnd;
  throw new Error(`${label} has no current_period_end`);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as Record<string, unknown>;
  const direct = inv["subscription"];
  if (typeof direct === "string") return direct;
  if (direct && typeof direct === "object" && "id" in direct) {
    return String((direct as { id: string }).id);
  }
  const parent = inv["parent"] as Record<string, unknown> | undefined;
  const details = parent?.["subscription_details"] as Record<string, unknown> | undefined;
  const nested = details?.["subscription"];
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object" && "id" in nested) {
    return String((nested as { id: string }).id);
  }
  return null;
}

function invoiceLinePriceId(line: Stripe.InvoiceLineItem): string | null {
  const row = line as unknown as Record<string, unknown>;
  const price = row["price"];
  if (price && typeof price === "object" && "id" in price) {
    return String((price as { id: string }).id);
  }
  const pricing = row["pricing"] as Record<string, unknown> | undefined;
  const priceDetails = pricing?.["price_details"] as Record<string, unknown> | undefined;
  const pid = priceDetails?.["price"];
  if (typeof pid === "string") return pid;
  return null;
}

async function paidThroughFromStripeSubscription(subscriptionId: string): Promise<{
  paidThroughAt: Date;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
}> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const periodEnd = readUnixPeriodEnd(sub as unknown as Record<string, unknown>, `Subscription ${sub.id}`);
  const paidThroughAt = new Date(periodEnd * 1000);
  const priceId = sub.items.data[0]?.price?.id ?? null;
  return { paidThroughAt, stripeSubscriptionId: sub.id, stripePriceId: priceId };
}

async function activateTenantSubscription(
  tenantId: string,
  paidThroughAt: Date,
  stripeSubscriptionId: string,
  stripePriceId: string | null,
  stripeCustomerId: string | null | undefined,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        billingStatus: "ACTIVE",
        paidThroughAt,
        billingUpdatedAt: new Date(),
        ...(stripeCustomerId ? { stripeCustomerId } : {}),
      },
    });

    const existing = await tx.subscription.findFirst({
      where: { tenantId, stripeSubscriptionId },
      orderBy: { validFrom: "desc" },
    });

    if (existing) {
      await tx.subscription.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          validTo: paidThroughAt,
          stripePriceId: stripePriceId ?? existing.stripePriceId,
        },
      });
    } else {
      await tx.subscription.create({
        data: {
          tenantId,
          planTier: "STANDARD",
          source: "STRIPE",
          status: "ACTIVE",
          validFrom: new Date(),
          validTo: paidThroughAt,
          stripeSubscriptionId,
          stripePriceId,
        },
      });
    }
  });
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const tenantId = metaTenantId(session.metadata);
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const tenant = await tenantByStripeRefs(tenantId, customerId ?? null);
  if (!tenant) {
    throw new Error(`Tenant not found for checkout session ${session.id}`);
  }

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) {
    throw new Error(`Checkout session ${session.id} has no subscription`);
  }

  const { paidThroughAt, stripeSubscriptionId, stripePriceId } =
    await paidThroughFromStripeSubscription(subscriptionId);

  await activateTenantSubscription(
    tenant.id,
    paidThroughAt,
    stripeSubscriptionId,
    stripePriceId,
    customerId ?? tenant.stripeCustomerId,
  );
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const tenantId = metaTenantId(invoice.metadata);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const tenant = await tenantByStripeRefs(tenantId, customerId ?? null);
  if (!tenant) {
    throw new Error(`Tenant not found for invoice ${invoice.id}`);
  }

  const subscriptionId = invoiceSubscriptionId(invoice);

  let paidThroughAt: Date;
  let stripeSubscriptionId: string;
  let stripePriceId: string | null = null;

  if (subscriptionId) {
    const subInfo = await paidThroughFromStripeSubscription(subscriptionId);
    paidThroughAt = subInfo.paidThroughAt;
    stripeSubscriptionId = subInfo.stripeSubscriptionId;
    stripePriceId = subInfo.stripePriceId;
  } else if (invoice.lines?.data[0]?.period?.end) {
    paidThroughAt = new Date(invoice.lines.data[0].period.end * 1000);
    stripeSubscriptionId = `invoice_${invoice.id}`;
    stripePriceId = invoiceLinePriceId(invoice.lines.data[0]);
  } else {
    throw new Error(`Invoice ${invoice.id} has no subscription or period end`);
  }

  await activateTenantSubscription(
    tenant.id,
    paidThroughAt,
    stripeSubscriptionId,
    stripePriceId,
    customerId ?? tenant.stripeCustomerId,
  );
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const tenantId = metaTenantId(invoice.metadata);
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  const tenant = await tenantByStripeRefs(tenantId, customerId ?? null);
  if (!tenant) {
    throw new Error(`Tenant not found for failed invoice ${invoice.id}`);
  }

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { billingStatus: "PAST_DUE", billingUpdatedAt: new Date() },
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const tenantId = metaTenantId(subscription.metadata);
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const tenant = await tenantByStripeRefs(tenantId, customerId ?? null);
  if (!tenant) {
    throw new Error(`Tenant not found for deleted subscription ${subscription.id}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { billingStatus: "EXPIRED", billingUpdatedAt: new Date() },
    });

    await tx.subscription.updateMany({
      where: { tenantId: tenant.id, stripeSubscriptionId: subscription.id },
      data: { status: "EXPIRED" },
    });
  });
}

/** Stripe イベントを処理（冪等性は呼び出し元で event.id 単位に担保） */
export async function processStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      return;
    case "invoice.payment_succeeded":
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
      return;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      return;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return;
    default:
      return;
  }
}

export function stripeEventPayloadJson(event: Stripe.Event): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(event)) as Prisma.InputJsonValue;
}
