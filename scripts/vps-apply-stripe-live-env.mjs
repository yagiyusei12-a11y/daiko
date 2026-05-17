/**
 * VPS .env / web/.env の Stripe ライブ設定を上書き（引数は環境変数で渡す）。
 * 例: STRIPE_SECRET_KEY=sk_live_... node scripts/vps-apply-stripe-live-env.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const envPath = resolve(root, ".env");
const webEnvPath = resolve(root, "web/.env");

const keys = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY?.trim(),
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET?.trim(),
  DAIKO_STRIPE_PRICE_MONTHLY: process.env.DAIKO_STRIPE_PRICE_MONTHLY?.trim(),
  DAIKO_STRIPE_PRICE_YEARLY: process.env.DAIKO_STRIPE_PRICE_YEARLY?.trim(),
};

for (const [k, v] of Object.entries(keys)) {
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
  if (k === "STRIPE_SECRET_KEY" && !v.startsWith("sk_live_")) {
    console.error("STRIPE_SECRET_KEY must be sk_live_*");
    process.exit(1);
  }
}

function setEnvFile(path, entries) {
  let text = readFileSync(path, "utf8");
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}="${value}"`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
}

setEnvFile(envPath, keys);
setEnvFile(webEnvPath, {
  VITE_STRIPE_PRICE_MONTHLY: keys.DAIKO_STRIPE_PRICE_MONTHLY,
  VITE_STRIPE_PRICE_YEARLY: keys.DAIKO_STRIPE_PRICE_YEARLY,
});
console.log("Updated .env and web/.env for Stripe live mode");
