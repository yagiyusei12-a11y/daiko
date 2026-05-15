#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 1. setup demo user ===" >&2
JSON_LINE=$(npx tsx scripts/setup-demo-env-user.ts 2>&1 | tee /dev/stderr | tail -n 1)
SLUG=$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.slug)" "$JSON_LINE")
EMAIL=$(node -e "const j=JSON.parse(process.argv[1]); console.log(j.email)" "$JSON_LINE")
echo "slug=$SLUG email=$EMAIL" >&2

ENV_FILE="${HOME}/daiko/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE" >&2
  exit 1
fi

echo "=== 2. update $ENV_FILE ===" >&2
TMP=$(mktemp)
grep -v '^DAIKO_DEMO_TENANT_SLUG=' "$ENV_FILE" | grep -v '^DAIKO_DEMO_USER_EMAIL=' >"$TMP" || true
{
  cat "$TMP"
  echo "DAIKO_DEMO_TENANT_SLUG=$SLUG"
  echo "DAIKO_DEMO_USER_EMAIL=$EMAIL"
} >"$ENV_FILE"
rm -f "$TMP"

echo "=== 3. restart daiko-app ===" >&2
sudo systemctl restart daiko-app
sleep 2

echo "=== 4. health ===" >&2
curl -sS http://127.0.0.1:3001/health
echo "" >&2

echo "=== 5. demo-config ===" >&2
curl -sS http://127.0.0.1:3001/api/v1/auth/demo-config
echo "" >&2

echo "=== done ===" >&2
