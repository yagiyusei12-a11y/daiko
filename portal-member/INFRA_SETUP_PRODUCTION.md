# portal-member 本番構築マニュアル（Kagoya VPS / Ubuntu）

**対象**: すでに Node.js（Daiko Fastify）・Nginx・静的ポータル（`/portal/`）が動いている本番サーバー  
**目的**: `portal-member`（PHP 会員システム）を MySQL と PHP-FPM 経由で完全稼働させる  
**想定パス**: アプリは `ubuntu` ユーザーの `~/daiko`（= `/home/ubuntu/daiko`）に clone 済み

> ローカルから VPS に入る例（鍵のパスは環境に合わせて変更）  
> `ssh -i "C:\path\to\your-key.pem" ubuntu@133.18.141.239`

以下は **VPS に SSH ログインしたあと**、上から順にコピペして進めてください。

---

## 0. 事前確認（1分）

```bash
# リポジトリがあるか
ls -la ~/daiko/portal-member/api/get_live_info.php

# Node（Daiko）は動いているか（本番はポート 3001）
curl -sS http://127.0.0.1:3001/health

# Nginx の設定ファイル名を確認（サイト名は環境で異なります）
ls -la /etc/nginx/sites-enabled/
```

以降、**`DAIKO_ROOT=/home/ubuntu/daiko`** として記載します。パスが違う場合は読み替えてください。

---

## 1. PHP-FPM のインストールと起動

### 1-1. パッケージのインストール

```bash
sudo apt update
sudo apt install -y \
  php-fpm \
  php-cli \
  php-mysql \
  php-mbstring \
  php-xml \
  php-curl \
  php-zip
```

Ubuntu 24.04 などでは `php-fpm` が **PHP 8.3** 系になることが多いです（8.2 の場合も手順は同じで、後述のパスだけ `8.2` に読み替え）。

### 1-2. サービスの起動・有効化

```bash
# インストールされた PHP のメジャーバージョンを確認
php -v

# 例: PHP 8.3 の場合
sudo systemctl enable php8.3-fpm
sudo systemctl start php8.3-fpm
sudo systemctl status php8.3-fpm --no-pager
```

PHP 8.2 の場合は `php8.2-fpm` に置き換えてください。

### 1-3. PHP-FPM のソケットパスを確認する

**方法A（おすすめ）— ソケットファイルの存在確認**

```bash
ls -la /run/php/
```

表示例:

```text
php8.3-fpm.sock -> /etc/alternatives/php-fpm.sock
php-fpm.sock
```

本マニュアルでは **`/run/php/php8.3-fpm.sock`** を使います（実際のファイル名に合わせて Nginx の `fastcgi_pass` を後で設定）。

**方法B — プール設定から読む**

```bash
# 8.3 の例
grep -E '^listen\s*=' /etc/php/8.3/fpm/pool.d/www.conf
```

`listen = /run/php/php8.3-fpm.sock` のように表示されます。

**方法C — 動作テスト**

```bash
echo '<?php phpinfo();' | sudo tee /tmp/phpinfo-test.php
sudo php-fpm8.3 -t 2>/dev/null || sudo php-fpm8.2 -t
```

---

## 2. MySQL（MariaDB）への流し込み

Ubuntu の `mysql-server` は多くの場合 **MariaDB** です。コマンドは `mysql` のまま使えます。

### 2-1. MySQL サーバーのインストール（未導入の場合のみ）

```bash
sudo apt install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql
sudo systemctl status mysql --no-pager
```

すでに PostgreSQL（Daiko 用）だけ入っていて MySQL が無い場合に実行してください。  
**Daiko 本体の PostgreSQL には触れません**（別 DB です）。

### 2-2. 本番用パスワードを決める

ターミナルでランダム文字列を生成（メモしておく）:

```bash
openssl rand -base64 24
```

以下、例として次のプレースホルダを使います（**必ず自分の値に置き換え**）:

| 項目 | 例（置き換える） |
|------|------------------|
| DB 名 | `portal_member` |
| DB ユーザー | `portal_user` |
| DB パスワード | `ここに openssl で出した文字列` |

### 2-3. root で DB・テーブルを作成（マイグレーション流し込み）

`001_init.sql` には `CREATE DATABASE` と `USE portal_member` が含まれているため、**初回は root（または sudo mysql）で流し込み**ます。

```bash
cd ~/daiko
sudo mysql < portal-member/database/migrations/001_init.sql
```

エラーなく終わったら確認:

```bash
sudo mysql -e "SHOW DATABASES LIKE 'portal_member';"
sudo mysql -e "USE portal_member; SHOW TABLES;"
```

期待されるテーブル: `users`, `companies`, `prices`, `events`

### 2-4. 本番用ユーザー作成と権限付与

MySQL に root で入る:

```bash
sudo mysql
```

**mysql プロンプト内**で以下を実行（パスワードは `YOUR_PORTAL_DB_PASSWORD` を 2-2 で決めた値に変更）:

```sql
CREATE USER IF NOT EXISTS 'portal_user'@'localhost' IDENTIFIED BY 'YOUR_PORTAL_DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_member.* TO 'portal_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

接続テスト:

```bash
mysql -u portal_user -p portal_member -e "SELECT COUNT(*) AS users FROM users;"
```

（初回は 0 件で正常です）

---

## 3. `config/config.php` の作成

### 3-1. コピーと編集

```bash
cd ~/daiko/portal-member
cp config/config.example.php config/config.php
nano config/config.php
```

**変更する箇所（`db` 配列）**:

```php
    'db' => [
        'host' => '127.0.0.1',
        'port' => 3306,
        'database' => 'portal_member',
        'username' => 'portal_user',
        'password' => 'YOUR_PORTAL_DB_PASSWORD',  // 2-2 で決めた値
        'charset' => 'utf8mb4',
    ],
```

`enriched_csv_dir` はデフォルトのままで問題ありません（`~/daiko/data/3_enriched_csv` を指します）。  
登録時の CSV マージに使います。

### 3-2. パーミッション（PHP-FPM が読めるように）

PHP-FPM は通常 **`www-data`** ユーザーで動きます。`ubuntu` のホーム配下にコードがあるため、読み取り権限を付けます。

```bash
# ホームに「通過だけ」許可（中身は見えないが daiko 配下へ辿れる）
chmod o+x /home/ubuntu

# portal-member と enriched CSV を www-data が読めるように
chmod -R o+rX /home/ubuntu/daiko/portal-member
chmod -R o+rX /home/ubuntu/daiko/data/3_enriched_csv

# config.php は他人に読まれないよう厳しめに
chmod 640 /home/ubuntu/daiko/portal-member/config/config.php
```

### 3-3. PHP から DB 接続テスト（任意）

```bash
php -r '
$c = require "/home/ubuntu/daiko/portal-member/config/config.php";
$d = $c["db"];
$dsn = "mysql:host={$d["host"]};port={$d["port"]};dbname={$d["database"]};charset={$d["charset"]}";
new PDO($dsn, $d["username"], $d["password"]);
echo "DB OK\n";
'
```

`DB OK` と出れば成功です。

---

## 4. Nginx 設定のマージと反映

### 4-1. 既存設定のバックアップ

```bash
# 有効なサイト設定を確認（ファイル名は環境により daiko / default など）
NGINX_SITE=$(ls /etc/nginx/sites-enabled/ | head -1)
echo "編集対象: /etc/nginx/sites-available/${NGINX_SITE}"

sudo cp "/etc/nginx/sites-available/${NGINX_SITE}" \
        "/etc/nginx/sites-available/${NGINX_SITE}.bak.$(date +%Y%m%d%H%M)"
```

手動で名前が分かっている場合:

```bash
sudo nano /etc/nginx/sites-available/daiko
# または
sudo nano /etc/nginx/sites-enabled/daiko
```

### 4-2. 挿入する location ブロック（コピペ用）

**重要**: 次のブロックは、既存の **`location / { ... proxy_pass ... }`（Node へ渡すブロック）より上** に置いてください。  
そうしないと `/portal-member/` が Node に取られて 404 になります。

`fastcgi_pass` のソケットは **1-3 で確認したパス**に合わせてください（以下は PHP 8.3 の例）。

```nginx
    # ----- portal-member（PHP-FPM）-----
    location ^~ /portal-member/ {
        alias /home/ubuntu/daiko/portal-member/;
        index index.php login.php;

        location ~ \.php$ {
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $request_filename;
            fastcgi_index index.php;

            fastcgi_pass unix:/run/php/php8.3-fpm.sock;
            fastcgi_read_timeout 60s;
        }

        autoindex off;
        location ~ /\. {
            deny all;
        }
    }

    # 機密ディレクトリ直アクセス拒否
    location ~ ^/portal-member/(config|database|includes)/ {
        deny all;
        return 404;
    }
    # ----- /portal-member -----
```

PHP 8.2 の場合:

```nginx
            fastcgi_pass unix:/run/php/php8.2-fpm.sock;
```

### 4-3. 既存設定との関係（確認ポイント）

| パス | 振り分け |
|------|----------|
| `/portal/` | 既存どおり（静的 HTML または alias） |
| `/portal-member/` | **今回追加** → PHP-FPM |
| `/` `/app/` `/api/` など | 既存どおり → Node（`127.0.0.1:3001` 等） |

Node の upstream 名やポートは **既存のまま変更しない**でください（本番 Daiko は **3001**）。

### 4-4. 構文チェックとリロード

```bash
sudo nginx -t
```

`syntax is ok` / `test is successful` と出たら:

```bash
sudo systemctl reload nginx
```

失敗した場合はバックアップから戻す:

```bash
sudo cp "/etc/nginx/sites-available/${NGINX_SITE}.bak."* \
        "/etc/nginx/sites-available/${NGINX_SITE}"
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. 動作確認（最終接続テスト）

### 5-1. VPS 上から

```bash
# 公開 API（JSON）
curl -sS http://127.0.0.1/portal-member/api/get_live_info.php | head -c 200
echo

# ログイン画面（HTML）
curl -sS -o /dev/null -w "login.php HTTP %{http_code}\n" \
  http://127.0.0.1/portal-member/login.php
```

期待:

- API: `{"ok":true,...}` または会員未登録時でも `ok:true` と空の `by_key`
- login.php: `HTTP 200`

### 5-2. ブラウザ（HTTPS）

| URL | 期待 |
|-----|------|
| https://daiko.harunoyukoto.jp/portal-member/login.php | ログイン画面 |
| https://daiko.harunoyukoto.jp/portal-member/api/get_live_info.php | JSON |
| https://daiko.harunoyukoto.jp/portal/ | ポータル（会員登録後、カードにリアルタイム枠） |

### 5-3. 会員登録のスモークテスト（任意）

1. https://daiko.harunoyukoto.jp/portal-member/register.php を開く  
2. `data/3_enriched_csv` に存在する **認定番号** と都道府県で登録  
3. https://daiko.harunoyukoto.jp/portal-member/dashboard.php で料金・イベントを保存  
4. `/portal/` を再読み込みし、該当業者カードに「本日営業中」等が出るか確認  

---

## 6. よくあるトラブル

| 症状 | 原因と対処 |
|------|------------|
| API が `{"error":"not found"}`（Node の JSON） | Nginx で `/portal-member/` が Node より下にある、または未設定 → **4-2 の location を `location /` より上に** |
| 502 Bad Gateway | `fastcgi_pass` のソケットパス不一致 → **1-3 で再確認** |
| 500 + `config missing` | `config/config.php` 未作成 → **手順 3** |
| 500 + DB エラー | ユーザー・パスワード・権限 → **手順 2-4** |
| ファイルが読めない | `www-data` が `~/daiko` を読めない → **手順 3-2 の chmod** |
| `register.php` で CSV マージ失敗 | `data/3_enriched_csv` の権限不足 → `chmod -R o+rX ~/daiko/data/3_enriched_csv` |

ログ確認:

```bash
sudo tail -n 50 /var/log/nginx/error.log
sudo journalctl -u php8.3-fpm -n 50 --no-pager
```

---

## 7. チェックリスト（完了の目安）

- [ ] `php8.x-fpm` が **active (running)**
- [ ] `/run/php/php8.x-fpm.sock` が存在
- [ ] DB `portal_member` と 4 テーブルが存在
- [ ] `portal_user` で `mysql -u portal_user -p portal_member` 接続できる
- [ ] `config/config.php` に本番パスワードを設定済み
- [ ] `sudo nginx -t` 成功 → `reload` 済み
- [ ] `curl` で `get_live_info.php` が JSON を返す
- [ ] ブラウザで `login.php` が 200

---

## 参考ファイル（リポジトリ内）

| ファイル | 内容 |
|----------|------|
| `portal-member/database/migrations/001_init.sql` | スキーマ定義 |
| `portal-member/nginx_proxy.conf` | Nginx 設定のコメント付き全文例 |
| `portal-member/config/config.example.php` | 設定の雛形 |

詳細なアプリ仕様は [README.md](./README.md) を参照してください。
