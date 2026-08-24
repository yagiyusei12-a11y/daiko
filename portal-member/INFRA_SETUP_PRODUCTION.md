# portal-member 本番構築マニュアル（Kagoya VPS / Ubuntu）

**対象**: すでに Node.js（Daiko Fastify）・静的ポータル（`/portal/`）が本番稼働中の VPS  
**目的**: `portal-member`（PHP 会員システム）を MySQL + PHP-FPM で動かし、HTTPS から利用可能にする  
**想定パス**: `~/daiko`（= `/home/ubuntu/daiko`）

## 本番アーキテクチャ（実態）

| レイヤ | 役割 |
|--------|------|
| **Docker Caddy**（80/443） | HTTPS 終端。`daiko.harunoyukoto.jp` を受ける |
| **ホスト Nginx**（**9080 のみ**） | `/portal-member/` を PHP-FPM へ。80 番は使わない |
| **PHP-FPM**（Unix ソケット） | `login.php` / `dashboard.php` / API 等 |
| **Node.js**（3001） | Daiko 本体・`/portal/` 静的配信など（Caddy から `host.docker.internal:3001`） |
| **MySQL**（3306） | `portal_member` DB（Daiko の PostgreSQL とは別） |

```text
Internet → Caddy (Docker :443)
            ├─ /portal-member* → host.docker.internal:9080 → Nginx → PHP-FPM
            └─ その他            → host.docker.internal:3001 → Node (Daiko)
```

> **注意**: ホストの Nginx を 80 番で起動しようとすると、Docker が 80/443 を使用中のため失敗します。portal-member 用 Nginx は **内部ポート 9080 専用**です。  
> Docker から `127.0.0.1:9080` だけでは届かないため、**`172.17.0.1:9080`**（docker0 ブリッジ）でも待ち受けます。

### 一括セットアップ（推奨）

手順 1〜5 をまとめて実行するスクリプト:

```bash
# ローカルからアップロード（CRLF 除去してから実行）
scp -i "鍵のパス" scripts/vps-setup-portal-member-infra.sh ubuntu@133.18.141.239:/tmp/
ssh -i "鍵のパス" ubuntu@133.18.141.239 \
  "sed -i 's/\r$//' /tmp/vps-setup-portal-member-infra.sh && bash /tmp/vps-setup-portal-member-infra.sh"
```

---

## 0. 事前確認

```bash
ls -la ~/daiko/portal-member/api/get_live_info.php
curl -sS http://127.0.0.1:3001/health

# HTTPS 手前が Caddy (Docker) か確認
docker ps --format '{{.Names}}' | grep -i caddy
cat ~/order/deploy/vps/Caddyfile
```

以降 **`DAIKO_ROOT=/home/ubuntu/daiko`**、`CADDY_FILE=/home/ubuntu/order/deploy/vps/Caddyfile` とします。

---

## 1. PHP-FPM のインストールと起動

### 1-1. パッケージのインストール

```bash
sudo apt update
sudo apt install -y \
  php-fpm php-cli php-mysql php-mbstring php-xml php-curl php-zip
```

### 1-2. サービスの起動・有効化

```bash
php -v   # 例: PHP 8.3.x

sudo systemctl enable php8.3-fpm
sudo systemctl start php8.3-fpm
sudo systemctl status php8.3-fpm --no-pager
```

（8.2 の場合は `php8.2-fpm` に読み替え）

### 1-3. PHP-FPM ソケットの確認

```bash
ls -la /run/php/
grep -E '^listen\s*=' /etc/php/8.3/fpm/pool.d/www.conf
```

Nginx の `fastcgi_pass` には **`unix:/run/php/php8.3-fpm.sock`** を指定します（実際のパスに合わせる）。

---

## 2. MySQL への流し込み

### 2-1. MySQL サーバー（未導入時のみ）

```bash
sudo apt install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql
```

Daiko 本体の **PostgreSQL には触れません**。

### 2-2. DB パスワード（`.portal-member-db-secret`）

本番では平文パスワードを **`~/daiko/.portal-member-db-secret`** に保存し、`config.php` 生成時に参照します（Git 管理外）。

```bash
openssl rand -base64 24 | tee ~/daiko/.portal-member-db-secret
chmod 600 ~/daiko/.portal-member-db-secret
```

| 項目 | 値 |
|------|-----|
| DB 名 | `portal_member` |
| DB ユーザー | `portal_user` |
| DB パスワード | `.portal-member-db-secret` の内容 |

### 2-3. マイグレーション（新規 install）

正式経路は **`001_init.sql`（歴史的 baseline）→ `php scripts/apply-portal-member-migrations.php`** です。生 SQL を 001→002→…→013 と連続実行する手順は、新規構築の正式手順ではありません。

```bash
cd ~/daiko
sudo mysql < portal-member/database/migrations/001_init.sql

sudo mysql -e "USE portal_member; SHOW TABLES;"
```

この時点の期待: `users`, `companies`, `prices`, `events`。002 以降（プレミアム・配車・レビュー等）は `config.php` 作成後に PHP applicator で適用します（後述 3-4）。

### 2-4. ユーザー作成と権限付与

パスワードに記号が含まれる場合に備え、PHP で SQL を生成する方法が安全です。

```bash
export DAIKO_ROOT=/home/ubuntu/daiko
export DB_PASS="$(tr -d '\n' < "${DAIKO_ROOT}/.portal-member-db-secret")"

php -r '
$pass = getenv("DB_PASS");
$sql = sprintf(
    "CREATE USER IF NOT EXISTS '\''portal_user'\''@'\''localhost'\'' IDENTIFIED BY %s;\n"
    . "ALTER USER '\''portal_user'\''@'\''localhost'\'' IDENTIFIED BY %s;\n"
    . "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON portal_member.* TO '\''portal_user'\''@'\''localhost'\'';\n"
    . "FLUSH PRIVILEGES;\n",
    var_export($pass, true),
    var_export($pass, true)
);
file_put_contents("/tmp/portal_member_grants.sql", $sql);
'
sudo mysql < /tmp/portal_member_grants.sql
rm -f /tmp/portal_member_grants.sql
```

接続テスト:

```bash
mysql -u portal_user -p"$(cat ~/daiko/.portal-member-db-secret)" portal_member \
  -e "SELECT COUNT(*) AS users FROM users;"
```

---

## 3. `config/config.php` の作成

### 3-1. シークレットから自動生成

```bash
export DAIKO_ROOT=/home/ubuntu/daiko
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
```

手動で編集する場合は `config.example.php` をコピーし、`db.password` だけ `.portal-member-db-secret` と同じ値にします。

### 3-2. パーミッション（www-data が `config.php` を読める）

PHP-FPM は **`www-data`** で動作します。`config.php` は **グループ `www-data`・モード `640`** とします。

```bash
chmod o+x /home/ubuntu
chmod -R o+rX /home/ubuntu/daiko/portal-member
chmod -R o+rX /home/ubuntu/daiko/data/3_enriched_csv

sudo chgrp www-data /home/ubuntu/daiko/portal-member/config/config.php
chmod 640 /home/ubuntu/daiko/portal-member/config/config.php
sudo chmod g+x /home/ubuntu/daiko/portal-member/config

sudo systemctl restart php8.3-fpm
```

### 3-3. DB 接続テスト

```bash
export DAIKO_ROOT=/home/ubuntu/daiko
php -r '
$c = require getenv("DAIKO_ROOT") . "/portal-member/config/config.php";
$d = $c["db"];
$dsn = "mysql:host={$d["host"]};port={$d["port"]};dbname={$d["database"]};charset={$d["charset"]}";
new PDO($dsn, $d["username"], $d["password"]);
echo "DB OK\n";
'
```

### 3-4. 002 以降のスキーマ（PHP applicator）

`config.php` の DB 接続が通ったあと、必ず実行します。

```bash
cd ~/daiko
php scripts/apply-portal-member-migrations.php
```

既存 DB への追加適用も同じコマンドです。applicator は未適用分だけ実行します。

---

## 4. Nginx（内部 9080）の設定

既存の **Docker Caddy 用サイト設定は変更しません**。portal-member 専用の Nginx サイトを **新規追加**します。

### 4-1. サイト設定ファイルの作成

`fastcgi_pass` のソケットは 1-3 で確認したパスに合わせてください。

```bash
DAIKO_ROOT=/home/ubuntu/daiko
PHP_SOCK=/run/php/php8.3-fpm.sock   # 環境に合わせて変更

sudo tee /etc/nginx/sites-available/portal-member-internal >/dev/null <<NGINX
# portal-member: PHP only on internal port (Caddy -> host.docker.internal:9080)
# host.docker.internal は 172.17.0.1 または 172.19.0.1 に解決されるため両方 listen する
server {
    listen 127.0.0.1:9080;
    listen 172.17.0.1:9080;
    listen 172.19.0.1:9080;
    listen [::1]:9080;
    server_name localhost;

    location ^~ /portal-member/ {
        alias ${DAIKO_ROOT}/portal-member/;
        index index.php login.php;

        location ~ \.php$ {
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME \$request_filename;
            fastcgi_index index.php;
            fastcgi_pass unix:${PHP_SOCK};
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

sudo ln -sf /etc/nginx/sites-available/portal-member-internal \
  /etc/nginx/sites-enabled/portal-member-internal
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
```

### 4-2. 起動とリロード

80 番は Docker が使用中のため、**9080 のみ**で起動します。

```bash
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx    # 初回。80 番エラーが出ても 9080 が listen していれば OK
sudo systemctl reload nginx
sudo ss -tlnp | grep 9080
```

### 4-3. ルーティング一覧

| パス | 処理 |
|------|------|
| `/portal-member/*` | Nginx:9080 → PHP-FPM |
| `/portal/` 他 | Caddy → Node:3001（既存） |
| `/app/` `/api/` 等 | Caddy → Node:3001（既存） |

### 4-4. 502 Bad Gateway になったとき

症状: `/portal-member/login.php` や `api/get_live_info.php` がすべて 502。静的の `/portal/` は 200。

よくある原因:

1. **PHP-FPM の `listen` が Unix ソケットではない**  
   Nginx は `unix:/run/php/php8.3-fpm.sock` を想定。`listen = 172.19.0.1:9000` などに変わっているとソケットが消え 502。  
   → `/etc/php/8.3/fpm/pool.d/www.conf` を `listen = /run/php/php8.3-fpm.sock` に戻し `sudo systemctl restart php8.3-fpm`

2. **Nginx が Docker ブリッジ IP で listen していない**  
   Caddy の `host.docker.internal` が `172.19.0.1` のとき、9080 が `127.0.0.1` / `172.17.0.1` だけだと connection refused。  
   → `listen 172.19.0.1:9080;` を追加して `sudo nginx -t && sudo systemctl reload nginx`

3. **`sites-enabled` に `.bak` が残っている**  
   server 名衝突で listen が無視される。バックアップは `/etc/nginx/backup/` へ移す。

確認コマンド:

```bash
ss -lntp | grep 9080
ls -la /run/php/php8.3-fpm.sock
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9080/portal-member/login.php
curl -sS -o /dev/null -w '%{http_code}\n' https://daiko.harunoyukoto.jp/portal-member/login.php
docker exec vps-caddy-1 wget -q -O - -S http://host.docker.internal:9080/portal-member/api/get_live_info.php 2>&1 | head
```

---

## 5. Caddy（Docker）への `handle` 追加

`~/order/deploy/vps/Caddyfile` の **`daiko.harunoyukoto.jp` ブロック内**、`reverse_proxy ...:3001` の **直前に** 次を追加します。

```caddyfile
daiko.harunoyukoto.jp {
	handle /portal-member* {
		reverse_proxy host.docker.internal:9080
	}
	reverse_proxy host.docker.internal:3001
}
```

反映:

```bash
sudo cp ~/order/deploy/vps/Caddyfile \
  ~/order/deploy/vps/Caddyfile.bak.$(date +%Y%m%d%H%M%S)

# 編集後
docker exec vps-caddy-1 caddy reload --config /etc/caddy/Caddyfile \
  || docker restart vps-caddy-1
```

> `handle /portal-member*` が無いと、HTTPS の `/portal-member/` は Node に流れ `{"error":"not found"}` になります。

---

## 6. 動作確認

### 6-1. ホスト Nginx（9080）経由

```bash
curl -sS http://127.0.0.1:9080/portal-member/api/get_live_info.php | head -c 200
echo
curl -sS -o /dev/null -w "login:%{http_code}\n" \
  http://127.0.0.1:9080/portal-member/login.php
```

### 6-2. Docker から 9080 へ（Caddy 経路の確認）

```bash
docker exec vps-caddy-1 wget -qO- \
  http://host.docker.internal:9080/portal-member/api/get_live_info.php | head -c 120
```

### 6-3. 本番 HTTPS

```bash
curl -sS https://daiko.harunoyukoto.jp/portal-member/api/get_live_info.php | head -c 200
curl -sS -o /dev/null -w "login:%{http_code}\n" \
  https://daiko.harunoyukoto.jp/portal-member/login.php
```

| URL | 期待 |
|-----|------|
| `.../portal-member/api/get_live_info.php` | `{"ok":true,...}` |
| `.../portal-member/login.php` | HTTP 200 |
| `.../portal/` | ポータル HTML（リアルタイム枠は会員登録後） |

---

## 7. よくあるトラブル

| 症状 | 原因と対処 |
|------|------------|
| HTTPS で `{"error":"not found"}` | Caddy に `handle /portal-member*` が無い → **手順 5** |
| HTTPS 502 | Nginx が `127.0.0.1:9080` のみ待受 → **`172.17.0.1:9080` を追加**（手順 4-1） |
| 500 Permission denied（config.php） | `www-data` が読めない → **chgrp www-data + chmod 640**（手順 3-2） |
| 502 / empty（PHP） | `fastcgi_pass` のソケット不一致 → **手順 1-3** |
| 500 DB エラー | `portal_user` / `.portal-member-db-secret` 不一致 → **手順 2・3** |
| Nginx が 80 番で起動失敗 | 正常（Docker が 80 使用）。**9080 が listen していれば OK** |

```bash
sudo tail -n 30 /var/log/nginx/error.log
sudo journalctl -u php8.3-fpm -n 30 --no-pager
docker logs vps-caddy-1 --tail 20
```

---

## 8. チェックリスト

- [ ] `php8.x-fpm` が active
- [ ] `/run/php/php8.x-fpm.sock` が存在
- [ ] `portal_member` DB と 4 テーブル
- [ ] `~/daiko/.portal-member-db-secret`（600）
- [ ] `config.php`（640, グループ `www-data`）
- [ ] Nginx が `127.0.0.1:9080` と `172.17.0.1:9080` で listen
- [ ] Caddyfile に `handle /portal-member*` → `:9080`
- [ ] HTTPS で API / login が 200

---

## 参考

| ファイル | 内容 |
|----------|------|
| `database/migrations/001_init.sql` | 歴史的 baseline |
| `../scripts/apply-portal-member-migrations.php` | 002 以降の正式適用 |
| `nginx_proxy.conf` | 旧来のコメント付き Nginx 例（本番は **9080 + Caddy** を優先） |
| `../scripts/vps-setup-portal-member-infra.sh` | 一括セットアップ |
| `../scripts/vps-finish-portal-member.sh` | 権限・Caddy 追記の仕上げ用 |

アプリ仕様: [README.md](./README.md)
