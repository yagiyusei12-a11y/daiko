#!/usr/bin/env bash
# VPS 上の daiko ルートで実行する想定。乗務記録簿 PDF 用に LibreOffice（soffice）を用意し、.env に LIBREOFFICE_SOFFICE を追記・更新する。
# パスワードなし sudo（apt）が無い場合は警告のみで終了（デプロイは続行できるように exit 0）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${DAIKO_ENV_FILE:-$ROOT/.env}"

log() { echo "[ensure-libreoffice] $*" >&2; }

resolve_soffice() {
  local p
  for p in /usr/bin/soffice /usr/lib/libreoffice/program/soffice; do
    if [[ -x "$p" ]]; then
      echo "$p"
      return 0
    fi
  done
  if command -v soffice >/dev/null 2>&1; then
    command -v soffice
    return 0
  fi
  return 1
}

if ! soffice_path="$(resolve_soffice)"; then
  log "soffice が見つからないため apt で libreoffice-calc を試みます（要 sudo）。"
  set +e
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  apt_st=$?
  if [[ $apt_st -ne 0 ]]; then
    log "WARN: apt-get update に失敗しました。手動で LibreOffice を入れてください。"
    exit 0
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libreoffice-calc
  apt_install_st=$?
  set -e
  if [[ $apt_install_st -ne 0 ]]; then
    log "WARN: libreoffice-calc のインストールに失敗しました。"
    exit 0
  fi
  if ! soffice_path="$(resolve_soffice)"; then
    log "WARN: インストール後も soffice が見つかりません。"
    exit 0
  fi
fi

log "soffice: $soffice_path"

if [[ ! -f "$ENV_FILE" ]]; then
  log "WARN: $ENV_FILE がありません。スキップします。"
  exit 0
fi

tmp="$(mktemp)"
(grep -v '^LIBREOFFICE_SOFFICE=' "$ENV_FILE" 2>/dev/null || true) >"$tmp"
mv "$tmp" "$ENV_FILE"
printf '%s\n' "LIBREOFFICE_SOFFICE=$soffice_path" >>"$ENV_FILE"
log "設定しました: LIBREOFFICE_SOFFICE=$soffice_path（$ENV_FILE）"
