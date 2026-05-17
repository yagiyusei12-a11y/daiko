import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import {
  ensureStripeCustomerForTenant,
  getStripe,
  isAllowedStripePriceId,
  isStripeConfigured,
  stripeCheckoutCancelUrl,
  stripeCheckoutSuccessUrl,
} from "../lib/stripe-billing.js";
import { LicenseKeyError, redeemLicenseKeyForTenant } from "../lib/license-key.js";
import { evaluateTenantBillingAccess } from "../lib/tenant-billing.js";

/**
 * 課金手続き用 API（課金ガードの対象外）。
 * Step 3 で Stripe Checkout / Webhook を追加する。
 */
export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [authenticate] };

  app.get("/status", auth, async (req) => {
    const u = jwtUser(req);
    const tenant = await prisma.tenant.findUnique({
      where: { id: u.tenantId },
      select: {
        slug: true,
        billingStatus: true,
        trialEndsAt: true,
        paidThroughAt: true,
        stripeCustomerId: true,
        billingUpdatedAt: true,
      },
    });
    if (!tenant) {
      return {
        billingStatus: "EXPIRED",
        trialEndsAt: null,
        paidThroughAt: null,
        canAccessApp: false,
        stripeCustomerId: null,
      };
    }

    const access = evaluateTenantBillingAccess(
      {
        billingStatus: tenant.billingStatus,
        paidThroughAt: tenant.paidThroughAt,
        trialEndsAt: tenant.trialEndsAt,
      },
      { email: u.email, tenantSlug: tenant.slug },
    );

    return {
      billingStatus: tenant.billingStatus,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
      paidThroughAt: tenant.paidThroughAt?.toISOString() ?? null,
      billingUpdatedAt: tenant.billingUpdatedAt.toISOString(),
      canAccessApp: access.allowed,
      stripeCustomerId: tenant.stripeCustomerId,
      bypassReason: access.allowed ? access.reason : null,
    };
  });

  app.post("/checkout-session", auth, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isStripeConfigured()) {
      return reply.code(503).send({ error: "Stripe is not configured on this server" });
    }

    const priceId = String((req.body as { priceId?: unknown })?.priceId ?? "").trim();
    if (!priceId) {
      return reply.code(400).send({ error: "priceId is required" });
    }
    if (!isAllowedStripePriceId(priceId)) {
      return reply.code(400).send({ error: "Invalid priceId" });
    }

    const u = jwtUser(req);
    const tenant = await prisma.tenant.findUnique({
      where: { id: u.tenantId },
      select: { id: true, name: true, stripeCustomerId: true },
    });
    if (!tenant) {
      return reply.code(404).send({ error: "Tenant not found" });
    }

    try {
      const stripe = getStripe();
      let customerId = tenant.stripeCustomerId;
      if (!customerId) {
        customerId = await ensureStripeCustomerForTenant(
          tenant.id,
          u.email,
          tenant.name,
          null,
        );
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { stripeCustomerId: customerId, billingUpdatedAt: new Date() },
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: stripeCheckoutSuccessUrl(),
        cancel_url: stripeCheckoutCancelUrl(),
        metadata: { tenantId: tenant.id },
        subscription_data: {
          metadata: { tenantId: tenant.id },
        },
      });

      if (!session.url) {
        req.log.error({ sessionId: session.id }, "Stripe checkout session missing url");
        return reply.code(502).send({ error: "Failed to create checkout session" });
      }

      return { url: session.url, sessionId: session.id };
    } catch (err) {
      req.log.error({ err }, "Stripe checkout session failed");
      const stripeMsg =
        err && typeof err === "object" && "message" in err && typeof err.message === "string"
          ? err.message
          : null;
      return reply.code(502).send({
        error: stripeMsg ?? "Failed to create checkout session",
        code: "CHECKOUT_SESSION_FAILED",
      });
    }
  });

  app.post("/license/redeem", auth, async (req: FastifyRequest, reply: FastifyReply) => {
    const licenseKey = String((req.body as { licenseKey?: unknown })?.licenseKey ?? "").trim();
    if (!licenseKey) {
      return reply.code(400).send({ error: "licenseKey is required" });
    }

    const u = jwtUser(req);
    try {
      const result = await redeemLicenseKeyForTenant(u.tenantId, licenseKey);
      return {
        ok: true,
        billingStatus: result.billingStatus,
        paidThroughAt: result.paidThroughAt.toISOString(),
        validDays: result.validDays,
        canAccessApp: true,
      };
    } catch (err) {
      if (err instanceof LicenseKeyError) {
        return reply.code(400).send({ error: err.message });
      }
      req.log.error({ err }, "license key redeem failed");
      return reply.code(500).send({ error: "Failed to redeem license key" });
    }
  });
}
