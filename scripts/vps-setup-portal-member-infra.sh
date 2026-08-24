#!/usr/bin/env bash
# portal-member 本番インフラ一括セットアップ（VPS 上で実行）
# 構成: Docker Caddy (443) -> host:9080 (Nginx) -> PHP-FPM; 詳細は portal-member/INFRA_SETUP_PRODUCTION.md
# アップロード後: sed -i 's/\r$//' /tmp/vps-setup-portal-member-infra.sh  （Windows 由来の CRLF 除去）
set -euo pipefail

DAIKO_ROOT="${DAIKO_ROOT:-/home/ubuntu/daiko}"
ORDER_VPS="${ORDER_VPS:-/home/ubuntu/order/deploy/vps}"
SECRET_FILE="${DAIKO_ROOT}/.portal-member-db-secret"
NGINX_SITE="/etc/nginx/sites-available/portal-member-internal"
CADDY_FILE="${ORDER_VPS}/Caddyfile"

log() { echo "[portal-member-setup] $*"; }

# --- 0. 事前確認 ---
test -f "${DAIKO_ROOT}/portal-member/api/get_live_info.php"
curl -sf http://127.0.0.1:3001/health >/dev/null
log "Daiko health OK"

# --- 1. PHP-FPM ---
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq \
  php-fpm php-cli php-mysql php-mbstring php-xml php-curl php-zip

PHP_VER="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')"
PHP_FPM_SERVICE="php${PHP_VER}-fpm"
sudo systemctl enable "${PHP_FPM_SERVICE}"
sudo systemctl start "${PHP_FPM_SERVICE}"
sudo systemctl is-active --quiet "${PHP_FPM_SERVICE}"

PHP_SOCK="$(ls /run/php/php"${PHP_VER}"-fpm.sock 2>/dev/null | head -1 || true)"
if [[ -z "${PHP_SOCK}" ]]; then
  PHP_SOCK="$(grep -E '^listen\s*=' "/etc/php/${PHP_VER}/fpm/pool.d/www.conf" | head -1 | awk -F= '{print $2}' | tr -d ' ')"
fi
if [[ -S "${PHP_SOCK}" ]]; then
  FASTCGI_PASS="unix:${PHP_SOCK}"
elif [[ -n "${PHP_SOCK}" ]]; then
  FASTCGI_PASS="${PHP_SOCK}"
else
  echo "PHP-FPM listen socket not found" >&2
  exit 1
fi
log "PHP ${PHP_VER} FPM active, fastcgi_pass=${FASTCGI_PASS}"

# --- 2. MySQL ---
if ! command -v mysql >/dev/null; then
  sudo apt-get install -y -qq mysql-server
fi
sudo systemctl enable mysql
sudo systemctl start mysql

if [[ ! -f "${SECRET_FILE}" ]]; then
  openssl rand -base64 24 > "${SECRET_FILE}"
  chmod 600 "${SECRET_FILE}"
fi
DB_PASS="$(tr -d '\n' < "${SECRET_FILE}")"

sudo mysql < "${DAIKO_ROOT}/portal-member/database/migrations/001_init.sql"
log "001_init.sql applied"

export DB_PASS
php <<'PHP'
<?php
$pass = getenv('DB_PASS');
$sql = sprintf(
    "CREATE USER IF NOT EXISTS 'portal_user'@'localhost' IDENTIFIED BY %s;\n"
    . "ALTER USER 'portal_user'@'localhost' IDENTIFIED BY %s;\n"
    . "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON portal_member.* TO 'portal_user'@'localhost';\n"
    . "FLUSH PRIVILEGES;\n",
    var_export($pass, true),
    var_export($pass, true)
);
file_put_contents('/tmp/portal_member_grants.sql', $sql);
PHP
sudo mysql < /tmp/portal_member_grants.sql
rm -f /tmp/portal_member_grants.sql
log "portal_user granted"

# --- 3. config.php ---
export DAIKO_ROOT
php <<'PHP'
<?php
$root = getenv('DAIKO_ROOT') ?: '/home/ubuntu/daiko';
$secret = $root . '/.portal-member-db-secret';
$example = $root . '/portal-member/config/config.example.php';
$target = $root . '/portal-member/config/config.php';
$pass = trim(file_get_contents($secret));
$text = file_get_contents($example);
$text = preg_replace(
    "/'password'\\s*=>\\s*'[^']*'/",
    "'password' => " . var_export($pass, true),
    $text,
    1
);
file_put_contents($target, $text);
PHP

chmod o+x /home/ubuntu
chmod -R o+rX "${DAIKO_ROOT}/portal-member"
chmod -R o+rX "${DAIKO_ROOT}/data/3_enriched_csv" 2>/dev/null || true
sudo chgrp www-data "${DAIKO_ROOT}/portal-member/config/config.php"
chmod 640 "${DAIKO_ROOT}/portal-member/config/config.php"
sudo chmod g+x "${DAIKO_ROOT}/portal-member/config"

export DAIKO_ROOT
php -r '
$c = require getenv("DAIKO_ROOT") . "/portal-member/config/config.php";
$d = $c["db"];
$dsn = "mysql:host={$d["host"]};port={$d["port"]};dbname={$d["database"]};charset={$d["charset"]}";
new PDO($dsn, $d["username"], $d["password"]);
echo "DB OK\n";
'
log "config.php OK"

php "${DAIKO_ROOT}/scripts/apply-portal-member-migrations.php"
log "portal-member migrations applied (001 + PHP applicator)"

# --- 4. Nginx（内部 9080。手前の HTTPS は Caddy）---
sudo apt-get install -y -qq nginx

sudo tee "${NGINX_SITE}" >/dev/null <<NGINX
# portal-member internal (Caddy -> host.docker.internal:9080)
# host.docker.internal は Docker ブリッジ IP（172.17.0.1 または 172.19.0.1）に解決されるため両方 listen する
server {
    listen 127.0.0.1:9080;
    listen 172.17.0.1:9080;
    listen 172.19.0.1:9080;
    listen [::1]:9080;
    server_name localhost;

    location ^~ /portal-member/ {
        alias ${DAIKO_ROOT}/portal-member/;
        index index.php login.php;

        location ~ \.php\$ {
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME \$request_filename;
            fastcgi_index index.php;
            fastcgi_pass ${FASTCGI_PASS};
            fastcgi_read_timeout 60s;
        }

        autoindex off;
        location ~ /\. {
            deny all;
        }
    }

    location ~ ^/portal-member/(config|database|includes)/ {
        deny all;
        return 404;
    }
}
NGINX

sudo ln -sf "${NGINX_SITE}" /etc/nginx/sites-enabled/portal-member-internal
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
# sites-enabled に .bak が残ると server 衝突で listen が無視される
sudo mkdir -p /etc/nginx/backup
sudo mv -f /etc/nginx/sites-enabled/*.bak* /etc/nginx/backup/ 2>/dev/null || true
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx 2>/dev/null || true
sudo systemctl reload nginx
log "nginx started on 127.0.0.1/172.17.0.1/172.19.0.1:9080 (for Docker Caddy host.docker.internal)"

# --- 5. Caddy: /portal-member -> nginx:9080（本番の HTTPS 手前は Docker Caddy）---
if [[ -f "${CADDY_FILE}" ]] && ! grep -q 'portal-member' "${CADDY_FILE}"; then
  BAK="${CADDY_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  cp "${CADDY_FILE}" "${BAK}"
  awk '
    /^daiko\.harunoyukoto\.jp \{/ {
      print
      print "\thandle /portal-member* {"
      print "\t\treverse_proxy host.docker.internal:9080"
      print "\t}"
      next
    }
    { print }
  ' "${BAK}" > /tmp/daiko-caddy-patched.txt
  cp /tmp/daiko-caddy-patched.txt "${CADDY_FILE}"
  docker exec vps-caddy-1 caddy reload --config /etc/caddy/Caddyfile 2>/dev/null \
    || docker restart vps-caddy-1
  log "Caddy updated for /portal-member"
elif [[ -f "${CADDY_FILE}" ]] && grep -q 'portal-member' "${CADDY_FILE}"; then
  log "Caddy already has portal-member route"
else
  log "WARN: Caddyfile not found at ${CADDY_FILE}; configure reverse_proxy :9080 manually"
fi

# --- 6. 動作確認 ---
curl -sf "http://127.0.0.1:9080/portal-member/api/get_live_info.php" | head -c 120
echo
curl -sf -o /dev/null -w "login_via_nginx:%{http_code}\n" \
  "http://127.0.0.1:9080/portal-member/login.php"

log "DONE"
