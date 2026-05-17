#!/usr/bin/env bash
set -e
cd ~/daiko
set -a
# shellcheck disable=SC1091
source .env
set +a
price="${DAIKO_STRIPE_PRICE_MONTHLY}"
cust=$(curl -sS -u "${STRIPE_SECRET_KEY}:" -X POST https://api.stripe.com/v1/customers \
  -d "email=test-checkout@example.com" \
  -d "metadata[tenantId]=test" | node --input-type=module -e "
import { readFileSync } from 'fs';
const j = JSON.parse(readFileSync(0, 'utf8'));
if (j.error) { console.error(j.error.message); process.exit(1); }
console.log(j.id);
")
session=$(curl -sS -u "${STRIPE_SECRET_KEY}:" -X POST https://api.stripe.com/v1/checkout/sessions \
  -d "mode=subscription" \
  -d "customer=${cust}" \
  -d "line_items[0][price]=${price}" \
  -d "line_items[0][quantity]=1" \
  -d "success_url=https://example.com/success" \
  -d "cancel_url=https://example.com/cancel")
echo "$session" | node --input-type=module -e "
import { readFileSync } from 'fs';
const j = JSON.parse(readFileSync(0, 'utf8'));
if (j.error) { console.error('FAIL:', j.error.message); process.exit(1); }
console.log('OK session', j.id, 'url', j.url ? 'present' : 'missing');
"
