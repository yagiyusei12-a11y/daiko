#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== seed isolated demo tenant ===" >&2
JSON_LINE=$(npx tsx scripts/seed-demo-tenant.ts 2>&1 | tee /dev/stderr | tail -n 1)
SLUG=$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.slug)" "$JSON_LINE")
EMAIL=$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.email)" "$JSON_LINE")

ENV_FILE="${HOME}/daiko/.env"
TMP=$(mktemp)
grep -v '^DAIKO_DEMO_TENANT_SLUG=' "$ENV_FILE" | grep -v '^DAIKO_DEMO_USER_EMAIL=' >"$TMP" || true
{
  cat "$TMP"
  echo "DAIKO_DEMO_TENANT_SLUG=$SLUG"
  echo "DAIKO_DEMO_USER_EMAIL=$EMAIL"
} >"$ENV_FILE"
rm -f "$TMP"

echo "=== restart daiko-app ===" >&2
sudo systemctl restart daiko-app
sleep 2
curl -sS http://127.0.0.1:3001/health
echo ""
curl -sS http://127.0.0.1:3001/api/v1/auth/demo-config
echo ""
echo "=== done slug=$SLUG email=$EMAIL ===" >&2
