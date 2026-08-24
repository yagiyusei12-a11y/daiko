# 運転代行ポータル：業者会員（PHP + MySQL）

全国ポータル（`/portal/`）の業者向け会員登録・管理画面のバックエンド土台です。

## セットアップ

### 1. MySQL マイグレーション（新規 install）

正式経路は次の 2 段です。`001_init.sql` は歴史的 baseline（`users` / `companies` / `prices` / `events`）です。002 以降は PHP applicator が適用します。

```bash
mysql -u root -p < portal-member/database/migrations/001_init.sql
cp portal-member/config/config.example.php portal-member/config/config.php
# DB 接続情報を編集
php scripts/apply-portal-member-migrations.php
```

既存 DB の追加マイグレーションも、生 SQL を 001→013 と連続実行するのではなく、同じ PHP applicator を使います。

### 2. 設定ファイル

`config.php` は上の手順で baseline の直後に用意します（applicator が参照します）。

### 3. Web サーバー

PHP 8.1+ と `pdo_mysql` が必要です。

- 開発例: `cd portal-member && php -S localhost:8080`
- **本番（Kagoya VPS）**: [INFRA_SETUP_PRODUCTION.md](./INFRA_SETUP_PRODUCTION.md)（Caddy + Nginx:9080 + PHP-FPM・MySQL）
- **一括セットアップ**: `scripts/vps-setup-portal-member-infra.sh`
- Nginx 設定例: [nginx_proxy.conf](./nginx_proxy.conf)

## 主なファイル

| ファイル | 説明 |
|---------|------|
| `register.php` | 認定番号・メール・パスワードで新規登録（CSV マージ） |
| `login.php` | ログイン |
| `dashboard.php` | マイページ（基本情報・料金・イベント・お迎え目安・こだわり・店舗用POP） |
| `pop.php` | 店舗用 A4 印刷POP（QR → 業者専用詳細ページ） |
| `api/get_live_info.php` | ポータル向けリアルタイム JSON（料金・営業中・お迎え・こだわり） |
| `logout.php` | ログアウト |

## 店舗用QR POP

マイページの「店舗用・印刷POP（A4）」から `pop.php` を開き、業者専用詳細ページへのQRコード付きPOPを印刷できます。掲載URLは `public/portal/portal-data.json` と突き合わせます（`generate_portal_html.py` 実行後に有効）。

VPS での自動再生成は [docs/vps-cron-setup.md](../docs/vps-cron-setup.md) を参照してください。

## 認定番号と CSV マージ

登録時に `data/3_enriched_csv/*.csv` を認定番号で検索し、電話・HP・評価などを `companies` に取り込みます。都道府県を併記すると精度が上がります。

## Daiko 本丸システムへの導線

ダッシュボードのプレミアムバナーから [Daiko 公式](https://daiko.harunoyukoto.jp/) / [無料トライアル](https://daiko.harunoyukoto.jp/app/register) へ誘導します。
