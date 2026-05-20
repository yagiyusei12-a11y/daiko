#!/usr/bin/env bash
set -euo pipefail

sudo chgrp www-data /home/ubuntu/daiko/portal-member/config/config.php
chmod 640 /home/ubuntu/daiko/portal-member/config/config.php
sudo chmod g+x /home/ubuntu/daiko/portal-member/config
sudo systemctl restart php8.3-fpm

CADDY_FILE=/home/ubuntu/order/deploy/vps/Caddyfile
if ! grep -q portal-member "${CADDY_FILE}"; then
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
  echo "Caddy patched"
else
  echo "Caddy already patched"
fi

echo "=== local nginx:9080 ==="
curl -sS http://127.0.0.1:9080/portal-member/api/get_live_info.php | head -c 200
echo
curl -sS -o /dev/null -w "login:%{http_code}\n" http://127.0.0.1:9080/portal-member/login.php

echo "=== https public ==="
curl -sS https://daiko.harunoyukoto.jp/portal-member/api/get_live_info.php | head -c 200
echo
curl -sS -o /dev/null -w "https_login:%{http_code}\n" https://daiko.harunoyukoto.jp/portal-member/login.php
