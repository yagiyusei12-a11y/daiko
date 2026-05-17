#!/usr/bin/env bash
set -euo pipefail
cd ~/daiko
set -a
# shellcheck disable=SC1091
source .env
set +a
echo "KEY_PREFIX=${STRIPE_SECRET_KEY:0:12}..."
curl -sS -u "${STRIPE_SECRET_KEY}:" \
  'https://api.stripe.com/v1/prices?limit=20&active=true' \
  | node -e "
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const d = JSON.parse(Buffer.concat(chunks).toString());
  for (const p of d.data || []) {
    console.log([p.id, 'livemode=' + p.livemode, p.nickname || '', p.unit_amount].join(' '));
  }
});
"
