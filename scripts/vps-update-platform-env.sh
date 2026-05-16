#!/usr/bin/env bash
# VPS の ~/daiko/.env にプラットフォーム管理・SMTP 設定を追記（既存の同名行は除去）
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${HOME}/daiko/.env"
STAMP=$(date +%Y%m%d%H%M%S)
cp "$ENV_FILE" "${ENV_FILE}.bak.${STAMP}"
grep -v '^DAIKO_PLATFORM_ADMIN_EMAILS=' "$ENV_FILE" \
  | grep -v '^DAIKO_INQUIRY_NOTIFY_TO=' \
  | grep -v '^DAIKO_SMTP_' \
  | grep -v '^# --- platform admin' \
  > "${ENV_FILE}.tmp"
mv "${ENV_FILE}.tmp" "$ENV_FILE"
# 同ディレクトリの .vps-platform-env.snippet があればそれを使う（vps-apply-platform-env.ps1 が生成）
SNIPPET="$(dirname "$0")/.vps-platform-env.snippet"
if [ -f "$SNIPPET" ]; then
  echo "" >>"$ENV_FILE"
  echo "# --- platform admin & inquiry mail ---" >>"$ENV_FILE"
  sed 's/\xEF\xBB\xBF//g' "$SNIPPET" >>"$ENV_FILE"
else
  cat >>"$ENV_FILE" <<'EOF'

# --- platform admin & inquiry mail ---
DAIKO_PLATFORM_ADMIN_EMAILS="yagi@harunoyukoto.com"
DAIKO_INQUIRY_NOTIFY_TO="yagi@harunoyukoto.com"
DAIKO_SMTP_HOST="mail.harunoyukoto.com"
DAIKO_SMTP_PORT=465
DAIKO_SMTP_SECURE=1
DAIKO_SMTP_USER="yagi@harunoyukoto.com"
DAIKO_SMTP_PASS=""
DAIKO_SMTP_FROM="yagi@harunoyukoto.com"
EOF
fi
echo "updated $ENV_FILE (backup: ${ENV_FILE}.bak.${STAMP})"
sudo systemctl restart daiko-app
sleep 2
curl -sS http://127.0.0.1:3001/health
echo ""
