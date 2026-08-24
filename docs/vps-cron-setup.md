# VPS：ポータルHTML自動再生成（Cron）設定手順

業者がマイページで情報を更新したあと、手動で `python scripts/generate_portal_html.py` を実行しなくても、定期的にポータル静的HTML（約2,000ページ以上）と `portal-data.json` を再生成するための手順です。

## 前提

| 項目 | 想定値 |
|------|--------|
| アプリ配置 | `/home/ubuntu/daiko` |
| 実行ユーザー | `ubuntu` |
| Node アプリ | `daiko-app`（`deploy-vps.ps1` でデプロイ） |
| ポータル出力先 | `/home/ubuntu/daiko/public/portal/` |
| MySQL | `portal_member`（`portal-member/config/config.php`） |

DB パスワードは crontab に書かず、次のいずれかだけを使います。

- `portal-member/config/config.php`（本番 PHP と同じ接続）
- プロジェクトルートの `.portal-member-db-secret`（permission **600**）を `config.php` 生成時に参照
- 必要な場合のみ `.env` の `PORTAL_DB_*`（パスワードはファイルに置き、crontab へは書かない）

## 1. Python 仮想環境の作成（初回のみ）

```bash
cd /home/ubuntu/daiko

sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install pandas pykakasi pymysql
deactivate
```

動作確認:

```bash
cd /home/ubuntu/daiko
source .venv/bin/activate
python3 scripts/generate_portal_html.py
deactivate
```

成功すると `public/portal/index.html` や `public/portal/sitemap.xml` の更新日時が変わります。生成中に 2 本目を起動しても、ロックによりスキップされます。

## 2. ログファイルの準備

```bash
sudo touch /var/log/daiko-portal-generate.log
sudo chown ubuntu:ubuntu /var/log/daiko-portal-generate.log
```

## 3. 実行スクリプト（リポジトリ同梱）

リポジトリに `scripts/run-generate-portal.sh` があります。実行権限を付与します。

```bash
chmod +x /home/ubuntu/daiko/scripts/run-generate-portal.sh
```

## 4. crontab 設定（コピペ用）

`ubuntu` ユーザーで編集:

```bash
crontab -e
```

### 推奨: 1時間ごと（会員更新の反映を早める）

```cron
0 * * * * /home/ubuntu/daiko/scripts/run-generate-portal.sh
```

### 補助: 毎日深夜3時（負荷の低い時間帯にフル再生成）

```cron
0 3 * * * /home/ubuntu/daiko/scripts/run-generate-portal.sh
```

ラッパーが MySQL に接続します。接続情報は `config.php` または `.env` から読みます。**crontab にパスワードを書かないでください。**

### 直接 Python を叩く場合（スクリプトを使わない例）

```cron
0 * * * * cd /home/ubuntu/daiko && /home/ubuntu/daiko/.venv/bin/python3 scripts/generate_portal_html.py >> /var/log/daiko-portal-generate.log 2>&1
```

## 5. プレミアム課金同期（入金 → is_premium → ポータル再生成）

請求システム連携の詳細は [portal-invoice-integration.md](./portal-invoice-integration.md) を参照してください。

有効化の前に、必ず dry-run で書き込みが 0 件であることを確認します。

```bash
cd /home/ubuntu/daiko
php scripts/sync_premium_status.php --dry-run
```

dry-run では portal / invoice の UPDATE と HTML 再生成を行いません。出力は `company_id`・課金状態・提案アクションのみです。

確認後、15分ごとの Cron:

```cron
*/15 * * * * cd /home/ubuntu/daiko && /usr/bin/php scripts/sync_premium_status.php >> /var/log/daiko-premium-sync.log 2>&1
```

```bash
sudo touch /var/log/daiko-premium-sync.log
sudo chown ubuntu:ubuntu /var/log/daiko-premium-sync.log
```

スクリプト自身が単一実行ロックを持ちます。入金が伝票固有マーカーで確認できたときだけ `is_premium` を ON にし、そのときだけ `generate_portal_html.py` を起動します（生成中の二重起動はロックで拒否します）。

## 6. MySQL 接続（portal-data.json マージ用）

`generate_portal_html.py` は次のいずれかで MySQL に接続します。

1. `portal-member/config/config.php` の `db` 設定（本番 PHP と同じ DB。推奨）
2. プロジェクトルートの `.env` に `PORTAL_DB_*` を設定（crontab には書かない）

シークレットファイルの例:

```bash
# 既にあれば再利用。新規なら:
# openssl rand -base64 24 > ~/daiko/.portal-member-db-secret
chmod 600 ~/daiko/.portal-member-db-secret
```

Cron は非対話シェルのため、**環境変数でパスワードを渡さず** `config.php` を正しく置いてください。

## 7. デプロイとの関係

`npm run deploy:vps`（`scripts/deploy-vps.ps1`）は Node アプリの pull / build / restart のみで、**ポータルHTMLの再生成は含みません**。

運用フロー:

1. コードを `git push` → `deploy-vps.ps1` でアプリ更新
2. Cron が毎時（または毎夜）ポータルHTMLを自動再生成
3. 業者マイページの「店舗用POP」は `portal-data.json` 経由で詳細URLを参照（再生成後にQRが有効）

初回デプロイ直後や大きな仕様変更時は、手動で1回実行してください。

```bash
bash /home/ubuntu/daiko/scripts/run-generate-portal.sh
```

## 8. 動作確認・トラブルシュート

```bash
# 直近ログ
tail -n 50 /var/log/daiko-portal-generate.log

# 手動実行
bash /home/ubuntu/daiko/scripts/run-generate-portal.sh

# 生成件数の目安（HTMLファイル数）
find /home/ubuntu/daiko/public/portal -name 'index.html' | wc -l
```

| 症状 | 対処 |
|------|------|
| `pymysql` エラー | `.venv` で `pip install pymysql` |
| MySQL 接続失敗 | `config.php` を確認。crontab にパスワードを書いていないこと |
| CSV なしで件数が少ない | `data/3_enriched_csv` がサーバーにあるか確認 |
| POPのQRが出ない | Cron 実行後に `public/portal/portal-data.json` の更新時刻を確認 |
| `already running` / skip | 別プロセスが生成中。完了を待って再実行 |

## 9. 関連ファイル

- `scripts/generate_portal_html.py` — 生成本体（生成ロック付き）
- `scripts/run-generate-portal.sh` — Cron 用ラッパー（cron lock + 生成本体 lock）
- `scripts/sync_premium_status.php` — プレミアム入金同期（`--dry-run` 可）
- `portal-member/pop.php` — 店舗用QR POP（`portal-data.json` 参照）
- `portal-member/includes/portal_urls.php` — 詳細ページURL解決
