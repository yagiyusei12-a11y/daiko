#!/usr/bin/env bash
set -e
cd ~/daiko
set -a
# shellcheck disable=SC1091
source .env
set +a
key_prefix="${STRIPE_SECRET_KEY:0:12}"
echo "KEY_PREFIX=${key_prefix}..."
curl -sS -u "${STRIPE_SECRET_KEY}:" "https://api.stripe.com/v1/prices/price_1TY5nV1DqBB8GAlPKCTbhQVw" | node --input-type=module -e "
import { readFileSync } from 'fs';
const j = JSON.parse(readFileSync(0, 'utf8'));
if (j.error) { console.log('FAIL:', j.error.message); process.exit(1); }
console.log('OK price', j.id, 'livemode=' + j.livemode);
"
