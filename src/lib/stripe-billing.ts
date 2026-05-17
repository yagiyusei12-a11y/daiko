import Stripe from "stripe";

const DEFAULT_SUCCESS_URL =
  "https://daiko.harunoyukoto.jp/app/billing?session_id={CHECKOUT_SESSION_ID}";
const DEFAULT_CANCEL_URL = "https://daiko.harunoyukoto.jp/app/billing";

let stripeClient: Stripe | null = null;

export function stripeSecretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}

export function isStripeConfigured(): boolean {
  return Boolean(stripeSecretKey());
}

export function stripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || null;
}

export function isStripeWebhookConfigured(): boolean {
  return Boolean(stripeWebhookSecret() && stripeSecretKey());
}

export function getStripe(): Stripe {
  const key = stripeSecretKey();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export function stripeCheckoutSuccessUrl(): string {
  return process.env.DAIKO_STRIPE_CHECKOUT_SUCCESS_URL?.trim() || DEFAULT_SUCCESS_URL;
}

export function stripeCheckoutCancelUrl(): string {
  return process.env.DAIKO_STRIPE_CHECKOUT_CANCEL_URL?.trim() || DEFAULT_CANCEL_URL;
}

/** 許可する Price ID（環境変数で指定） */
export function allowedStripePriceIds(): Set<string> {
  const ids = [
    process.env.DAIKO_STRIPE_PRICE_MONTHLY?.trim(),
    process.env.DAIKO_STRIPE_PRICE_YEARLY?.trim(),
  ].filter((id): id is string => Boolean(id));
  return new Set(ids);
}

export function isAllowedStripePriceId(priceId: string): boolean {
  const allowed = allowedStripePriceIds();
  return allowed.size > 0 && allowed.has(priceId);
}

export async function ensureStripeCustomerForTenant(
  tenantId: string,
  email: string,
  tenantName: string,
  existingCustomerId: string | null,
): Promise<string> {
  if (existingCustomerId) return existingCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email,
    name: tenantName,
    metadata: { tenantId },
  });
  return customer.id;
}
