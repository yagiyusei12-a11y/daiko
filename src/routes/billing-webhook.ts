import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import {
  getStripe,
  isStripeWebhookConfigured,
  stripeWebhookSecret,
} from "../lib/stripe-billing.js";
import { processStripeWebhookEvent, stripeEventPayloadJson } from "../lib/stripe-webhook-handlers.js";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Stripe Webhook 専用プラグイン（JWT・課金ガードなし）。
 * このスコープ内だけ `application/json` を Buffer で受け取り `req.rawBody` に保持する。
 */
export async function registerBillingWebhook(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body: Buffer, done) => {
      req.rawBody = body;
      try {
        const json = JSON.parse(body.toString("utf8")) as unknown;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post("/webhook", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isStripeWebhookConfigured()) {
      return reply.code(503).send({ error: "Stripe webhook is not configured" });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      return reply.code(400).send({ error: "Missing stripe-signature header" });
    }

    const rawBody = req.rawBody;
    if (!rawBody || rawBody.length === 0) {
      return reply.code(400).send({ error: "Missing request body" });
    }

    const stripe = getStripe();
    const secret = stripeWebhookSecret();
    if (!secret) {
      return reply.code(503).send({ error: "STRIPE_WEBHOOK_SECRET is not configured" });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      req.log.warn({ err }, "Stripe webhook signature verification failed");
      return reply.code(400).send({ error: "Invalid signature" });
    }

    const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
    if (existing) {
      return reply.send({ received: true });
    }

    try {
      await prisma.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
          payload: stripeEventPayloadJson(event),
          processedAt: null,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.send({ received: true });
      }
      throw err;
    }

    try {
      await processStripeWebhookEvent(event);
      await prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), error: null },
      });
      return reply.send({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err, eventId: event.id, type: event.type }, "Stripe webhook handler failed");
      await prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { error: message },
      });
      return reply.code(500).send({ error: "Webhook handler failed" });
    }
  });
}
