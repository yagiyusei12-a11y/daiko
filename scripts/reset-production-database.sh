#!/usr/bin/env bash
# VPS 上の Daiko ルート（.env に DATABASE_URL がある場所）で実行する。
# 既存の .env / .env.deploy は不要（本スクリプトは VPS の clone 内だけで完結）。
#
# 使い方:
#   cd /path/to/daiko
#   DAIKO_CONFIRM_RESET_DB=yes ./scripts/reset-production-database.sh
#
# 任意: DAIKO_VPS_SERVICE=daiko-app（既定） DAIKO_SKIP_SYSTEMCTL=1（stop/start をしない）

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${DAIKO_CONFIRM_RESET_DB:-}" != "yes" ]]; then
  echo "中止: 本番 DB の public スキーマを削除します。続ける場合は DAIKO_CONFIRM_RESET_DB=yes を付けて再実行してください。" >&2
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  . ./.env
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "エラー: DATABASE_URL が未設定です。clone 直下の .env を確認してください。" >&2
  exit 1
fi

if [[ -f package-lock.json ]]; then
  echo "npm ci ..."
  npm ci
else
  echo "npm install ..."
  npm install
fi

SERVICE="${DAIKO_VPS_SERVICE:-daiko-app}"
SKIP_CT="${DAIKO_SKIP_SYSTEMCTL:-}"

if [[ "$SKIP_CT" != "1" ]] && command -v systemctl >/dev/null 2>&1; then
  echo "systemctl stop ${SERVICE} ..."
  sudo systemctl stop "$SERVICE" || true
fi

echo "prisma db execute (DROP public + CREATE) ..."
npx prisma db execute --file scripts/sql/reset-public-schema.sql --schema prisma/schema.prisma

echo "prisma migrate deploy ..."
npx prisma migrate deploy
npx prisma generate

echo "npm run db:seed ..."
npm run db:seed

echo "npm run build ..."
npm run build

if [[ "$SKIP_CT" != "1" ]] && command -v systemctl >/dev/null 2>&1; then
  echo "systemctl start ${SERVICE} ..."
  sudo systemctl start "$SERVICE"
  sleep 2
  curl -sS http://127.0.0.1:3001/health || true
  echo ""
fi

echo "完了: テナント・ユーザーは消えています。POST /api/v1/auth/register で新規テナントを作成してください。"
