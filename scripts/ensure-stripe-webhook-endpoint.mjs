/**
 * Stripe テストモードの Webhook エンドポイントを確保し、署名シークレットを .env に書き込む。
 * 既存エンドポイントがある場合は新規 secret は取得できないため、Dashboard で再作成が必要な旨を表示。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";

const WEBHOOK_URL = "https://daiko.harunoyukoto.jp/api/v1/billing/webhook";
const EVENTS = [
  "checkout.session.completed",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "customer.subscription.deleted",
];

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

function setEnvKey(envPath, key, value) {
  const line = `${key}="${value}"`;
  let envText = readFileSync(envPath, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  envText = re.test(envText) ? envText.replace(re, line) : `${envText.trimEnd()}\n${line}\n`;
  writeFileSync(envPath, envText.endsWith("\n") ? envText : `${envText}\n`);
}

async function main() {
  const root = resolve(process.cwd());
  const envPath = resolve(root, ".env");
  loadEnvFile(envPath);

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key?.startsWith("sk_test_")) {
    console.error("STRIPE_SECRET_KEY must be sk_test_*");
    process.exit(1);
  }

  if (process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    console.log("STRIPE_WEBHOOK_SECRET already set in .env — skipping create");
    return;
  }

  const stripe = new Stripe(key);
  const list = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = list.data.find((e) => e.url === WEBHOOK_URL && e.status !== "disabled");

  if (existing) {
    console.error(
      `Webhook endpoint already exists: ${existing.id} (${WEBHOOK_URL})`,
    );
    console.error(
      "Signing secret is only shown at creation. In Stripe Dashboard → Developers → Webhooks →",
      "select the endpoint → Reveal signing secret, then set STRIPE_WEBHOOK_SECRET in .env",
    );
    process.exit(2);
  }

  const endpoint = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: EVENTS,
    description: "Daiko billing (test)",
  });

  const secret = endpoint.secret;
  if (!secret) {
    console.error("Created endpoint but no secret returned:", endpoint.id);
    process.exit(1);
  }

  setEnvKey(envPath, "STRIPE_WEBHOOK_SECRET", secret);
  console.log(`Created webhook endpoint ${endpoint.id}`);
  console.log(`STRIPE_WEBHOOK_SECRET set (whsec_…${secret.slice(-6)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
