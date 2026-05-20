# 運転代行ポータル：業者会員（PHP + MySQL）

全国ポータル（`/portal/`）の業者向け会員登録・管理画面のバックエンド土台です。

## セットアップ

### 1. MySQL マイグレーション

```bash
mysql -u root -p < portal-member/database/migrations/001_init.sql
```

### 2. 設定ファイル

```bash
cp portal-member/config/config.example.php portal-member/config/config.php
# DB 接続情報・enriched_csv_dir を編集
```

### 3. Web サーバー

PHP 8.1+ と `pdo_mysql` が必要です。

- 開発例: `cd portal-member && php -S localhost:8080`
- 本番: nginx で `portal-member/` を PHP-FPM に渡す（例: `/portal-member/`）

## 主なファイル

| ファイル | 説明 |
|---------|------|
| `register.php` | 認定番号・メール・パスワードで新規登録（CSV マージ） |
| `login.php` | ログイン |
| `dashboard.php` | マイページ（基本情報・料金・イベント） |
| `logout.php` | ログアウト |

## 認定番号と CSV マージ

登録時に `data/3_enriched_csv/*.csv` を認定番号で検索し、電話・HP・評価などを `companies` に取り込みます。都道府県を併記すると精度が上がります。

## Daiko 本丸システムへの導線

ダッシュボードのプレミアムバナーから [Daiko 公式](https://daiko.harunoyukoto.jp/) / [無料トライアル](https://daiko.harunoyukoto.jp/app/register) へ誘導します。
