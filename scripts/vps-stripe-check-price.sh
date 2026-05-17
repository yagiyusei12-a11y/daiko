#!/usr/bin/env bash
set -e
cd ~/daiko
set -a
# shellcheck disable=SC1091
source .env
set +a
for pid in price_1TY5nV1DqBB8GAlPKCTbhQVw price_1TY5nV1DqBB8GAlPwmVUqVTU; do
  echo "=== $pid ==="
  curl -sS -u "${STRIPE_SECRET_KEY}:" "https://api.stripe.com/v1/prices/${pid}" | node --input-type=module -e "
import { readFileSync } from 'fs';
const j = JSON.parse(readFileSync(0, 'utf8'));
if (j.error) console.log('ERROR:', j.error.message);
else console.log(j.id, 'livemode=' + j.livemode);
"
done
