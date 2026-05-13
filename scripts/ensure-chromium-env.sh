#!/usr/bin/env bash
# VPS 上の daiko ルートで実行する想定。Chromium が無ければ apt で入れ、.env に CHROMIUM_EXECUTABLE を追記・更新する。
# パスワードなし sudo（apt）が無い場合は警告のみで終了（デプロイは続行できるように exit 0）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DAIKO_ENV_FILE:-$ROOT/.env}"

log() { echo "[ensure-chromium] $*" >&2; }

have_browser() {
  command -v chromium >/dev/null 2>&1 && return 0
  command -v chromium-browser >/dev/null 2>&1 && return 0
  [[ -x /usr/bin/chromium ]] && return 0
  [[ -x /usr/bin/chromium-browser ]] && return 0
  return 1
}

if ! have_browser; then
  log "Chromium が見つからないため apt でインストールを試みます（要 sudo）…"
  set +e
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  apt_st=$?
  if [[ $apt_st -ne 0 ]]; then
    log "WARN: apt-get update に失敗しました。手動で Chromium を入れてください。"
    set -e
    exit 0
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium-browser
  if [[ $? -ne 0 ]]; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium
  fi
  set -e
fi

CHROME_PATH=""
for p in /usr/bin/chromium /usr/bin/chromium-browser; do
  if [[ -x "$p" ]]; then
    CHROME_PATH="$p"
    break
  fi
done
if [[ -z "$CHROME_PATH" ]] && command -v chromium >/dev/null 2>&1; then
  CHROME_PATH="$(command -v chromium)"
fi
if [[ -z "$CHROME_PATH" ]] && command -v chromium-browser >/dev/null 2>&1; then
  CHROME_PATH="$(command -v chromium-browser)"
fi

if [[ -z "$CHROME_PATH" ]]; then
  log "WARN: 実行ファイルが見つかりません。apt で chromium-browser または chromium を入れ、CHROMIUM_EXECUTABLE を .env に手動設定してください。"
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  log "WARN: $ENV_FILE がありません。スキップします。"
  exit 0
fi

tmp="$(mktemp)"
(grep -v '^CHROMIUM_EXECUTABLE=' "$ENV_FILE" 2>/dev/null || true) >"$tmp"
mv "$tmp" "$ENV_FILE"
printf '%s\n' "CHROMIUM_EXECUTABLE=$CHROME_PATH" >>"$ENV_FILE"
log "設定しました: CHROMIUM_EXECUTABLE=$CHROME_PATH（$ENV_FILE）"
