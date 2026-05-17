/**
 * 未処理の checkout.session.completed を DB に記録してハンドラを実行（Webhook 取りこぼし復旧用）。
 */
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  processStripeWebhookEvent,
  stripeEventPayloadJson,
} from "../dist/lib/stripe-webhook-handlers.js";

function loadEnvFile(path) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const prisma = new PrismaClient();

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env"));
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  const stripe = new Stripe(key);

  const events = await stripe.events.list({
    type: "checkout.session.completed",
    limit: 10,
  });

  let replayed = 0;
  for (const event of events.data) {
    const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
    if (existing?.processedAt) {
      console.log("skip processed", event.id);
      continue;
    }

    if (!existing) {
      await prisma.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
          payload: stripeEventPayloadJson(event),
          processedAt: null,
        },
      });
    }

    try {
      await processStripeWebhookEvent(event);
      await prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), error: null },
      });
      console.log("OK", event.id, event.created);
      replayed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { error: message },
      });
      console.error("FAIL", event.id, message);
    }
  }

  console.log("replayed:", replayed);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
