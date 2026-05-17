/**
 * Stripe テストモード用の月額・年額 Price を確保し、ID を stdout に出力する。
 * 使い方（VPS）: cd ~/daiko && node scripts/ensure-stripe-test-prices.mjs
 * 前提: .env の STRIPE_SECRET_KEY が sk_test_*
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";

const LOOKUP_MONTHLY = "daiko_standard_monthly_jpy";
const LOOKUP_YEARLY = "daiko_standard_yearly_jpy";

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

async function findByLookup(stripe, lookupKey) {
  const list = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  return list.data[0] ?? null;
}

async function ensurePrice(stripe, spec) {
  const existing = await findByLookup(stripe, spec.lookupKey);
  if (existing && !existing.livemode) {
    return existing;
  }
  return stripe.prices.create({
    currency: "jpy",
    unit_amount: spec.unitAmount,
    recurring: { interval: spec.interval },
    lookup_key: spec.lookupKey,
    product_data: { name: spec.productName },
  });
}

async function main() {
  const root = resolve(process.cwd());
  loadEnvFile(resolve(root, ".env"));
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key?.startsWith("sk_test_")) {
    console.error("STRIPE_SECRET_KEY must be sk_test_* for this script");
    process.exit(1);
  }
  const stripe = new Stripe(key);

  const monthly = await ensurePrice(stripe, {
    lookupKey: LOOKUP_MONTHLY,
    interval: "month",
    unitAmount: 4980,
    productName: "Daiko 月額プラン（テスト）",
  });
  const yearly = await ensurePrice(stripe, {
    lookupKey: LOOKUP_YEARLY,
    interval: "year",
    unitAmount: 49800,
    productName: "Daiko 年額プラン（テスト）",
  });

  console.log(`DAIKO_STRIPE_PRICE_MONTHLY=${monthly.id}`);
  console.log(`DAIKO_STRIPE_PRICE_YEARLY=${yearly.id}`);

  const envPath = resolve(root, ".env");
  let envText = readFileSync(envPath, "utf8");
  const lines = [
    `DAIKO_STRIPE_PRICE_MONTHLY="${monthly.id}"`,
    `DAIKO_STRIPE_PRICE_YEARLY="${yearly.id}"`,
  ];
  for (const line of lines) {
    const key = line.split("=")[0];
    const re = new RegExp(`^${key}=.*$`, "m");
    envText = re.test(envText) ? envText.replace(re, line) : `${envText.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envPath, envText.endsWith("\n") ? envText : `${envText}\n`);
  console.error("Updated .env with test-mode price IDs");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
