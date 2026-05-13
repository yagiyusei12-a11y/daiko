#!/usr/bin/env bash
# VPS 上の daiko ルートで実行する想定。PDF 用ブラウザを用意し、.env に CHROMIUM_EXECUTABLE を追記・更新する。
# amd64 では Google Chrome stable を優先（Ubuntu の Snap 版 Chromium は systemd 配下の Node から失敗しやすい）。
# パスワードなし sudo（apt）が無い場合は警告のみで終了（デプロイは続行できるように exit 0）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DAIKO_ENV_FILE:-$ROOT/.env}"

log() { echo "[ensure-chromium] $*" >&2; }

have_google() {
  [[ -x /usr/bin/google-chrome-stable ]]
}

have_browser() {
  command -v chromium >/dev/null 2>&1 && return 0
  command -v chromium-browser >/dev/null 2>&1 && return 0
  [[ -x /usr/bin/chromium ]] && return 0
  [[ -x /usr/bin/chromium-browser ]] && return 0
  [[ -x /snap/bin/chromium ]] && return 0
  return 1
}

ARCH="$(uname -m)"

# --- Google Chrome（amd64 のみ。Puppeteer 用に最も安定しやすい）---
if [[ "$ARCH" == "x86_64" ]] && ! have_google; then
  log "Google Chrome stable を導入します（PDF 用。初回は数十〜百MB のダウンロードがあります）。"
  set +e
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  apt_st=$?
  if [[ $apt_st -ne 0 ]]; then
    log "WARN: apt-get update に失敗しました。Chromium のみ試みます。"
  else
    tmpdeb="$(mktemp /tmp/daiko-gc-XXXX.deb 2>/dev/null || mktemp)"
    if wget -qO "$tmpdeb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb; then
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$tmpdeb" || log "WARN: Google Chrome の apt インストールに失敗しました。"
    else
      log "WARN: Google Chrome .deb のダウンロードに失敗しました。"
    fi
    rm -f "$tmpdeb"
  fi
  set -e
fi

# --- Chromium 系（Chrome が入らない環境・ARM 向け）---
if ! have_google && ! have_browser; then
  log "Chromium が見つからないため apt でインストールを試みます（要 sudo）。初回は Snap 取得で数分かかることがあります。"
  set +e
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  apt_st=$?
  if [[ $apt_st -ne 0 ]]; then
    log "WARN: apt-get update に失敗しました。手動で Chromium を入れてください。"
    set -e
    exit 0
  fi
  if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y chromium-browser
  fi
  set -e
fi

CHROME_PATH=""
if have_google; then
  CHROME_PATH="/usr/bin/google-chrome-stable"
else
  for p in /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium; do
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
fi

if [[ -z "$CHROME_PATH" ]]; then
  log "WARN: 実行ファイルが見つかりません。apt で chromium または chromium-browser を入れ、CHROMIUM_EXECUTABLE を .env に手動設定してください。"
  exit 0
fi

# --- 日本語 PDF 用フォント（Linux ヘッドレスでは無いと日本語が□になる）---
log "日本語フォント（fonts-noto-cjk）を確保します…"
set +e
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y fonts-noto-cjk; then
  log "fonts-noto-cjk を確認しました。"
else
  log "WARN: fonts-noto-cjk を入れられませんでした。PDF の日本語が正しく出ないことがあります。"
fi
set -e

if [[ ! -f "$ENV_FILE" ]]; then
  log "WARN: $ENV_FILE がありません。スキップします。"
  exit 0
fi

tmp="$(mktemp)"
(grep -v '^CHROMIUM_EXECUTABLE=' "$ENV_FILE" 2>/dev/null || true) >"$tmp"
mv "$tmp" "$ENV_FILE"
printf '%s\n' "CHROMIUM_EXECUTABLE=$CHROME_PATH" >>"$ENV_FILE"
log "設定しました: CHROMIUM_EXECUTABLE=$CHROME_PATH（$ENV_FILE）"
