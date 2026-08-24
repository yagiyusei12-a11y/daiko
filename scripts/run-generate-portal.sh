#!/usr/bin/env bash
# ポータル静的HTML再生成（Cron / 手動実行用）
# 使い方: bash scripts/run-generate-portal.sh
# 並列起動防止: cron lock（このスクリプト）と generate_portal_html.py 本体 lock。
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_ROOT"

LOG_FILE="${DAIKO_PORTAL_GENERATE_LOG:-/var/log/daiko-portal-generate.log}"
CRON_LOCK="${APP_ROOT}/logs/portal-generate.cron.lock"
mkdir -p "${APP_ROOT}/logs"

if [[ -f "$APP_ROOT/.venv/bin/activate" ]]; then
  # shellcheck source=/dev/null
  source "$APP_ROOT/.venv/bin/activate"
fi

{
  echo "===== $(date -Iseconds) portal generate start ====="
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$CRON_LOCK"
    if ! flock -n 9; then
      echo "===== $(date -Iseconds) portal generate skip (already running) ====="
      exit 0
    fi
  fi
  python3 scripts/generate_portal_html.py
  echo "===== $(date -Iseconds) portal generate done ====="
} >>"$LOG_FILE" 2>&1
