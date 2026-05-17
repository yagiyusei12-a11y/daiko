#!/usr/bin/env bash
set -e
cd ~/daiko
MONTHLY="price_1TY6bz1DqBB8GAlPH7iIkVof"
YEARLY="price_1TY6c01DqBB8GAlPiSFZNwad"
mkdir -p web
touch web/.env
for line in "VITE_STRIPE_PRICE_MONTHLY=${MONTHLY}" "VITE_STRIPE_PRICE_YEARLY=${YEARLY}"; do
  key="${line%%=*}"
  if grep -q "^${key}=" web/.env 2>/dev/null; then
    sed -i "s|^${key}=.*|${line}|" web/.env
  else
    echo "${line}" >> web/.env
  fi
done
npm run build
sudo systemctl restart daiko-app
sleep 2
curl -sS http://127.0.0.1:3001/health
