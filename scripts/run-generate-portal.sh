#!/usr/bin/env bash
# ポータル静的HTML再生成（Cron / 手動実行用）
# 使い方: bash scripts/run-generate-portal.sh
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_ROOT"

LOG_FILE="${DAIKO_PORTAL_GENERATE_LOG:-/var/log/daiko-portal-generate.log}"

if [[ -f "$APP_ROOT/.venv/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "$APP_ROOT/.venv/bin/activate"
fi

{
  echo "===== $(date -Iseconds) portal generate start ====="
  python3 scripts/generate_portal_html.py
  echo "===== $(date -Iseconds) portal generate done ====="
} >>"$LOG_FILE" 2>&1
