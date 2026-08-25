# LINE Messaging API 連携（ポータル業者）

業者がマイページにログインせず、LINEトークから営業ステータス・お迎え目安を更新する機能です。

## 1. データベース

```bash
mysql -u USER -p portal_member < portal-member/database/migrations/005_companies_line.sql
```

## 2. 環境変数（`.env` または `portal-member/config/config.php`）

```env
LINE_CHANNEL_ACCESS_TOKEN="（長期アクセストークン）"
LINE_CHANNEL_SECRET="（チャネルシークレット）"
LINE_BOT_BASIC_ID="@your_bot_basic_id"
```

## 3. Webhook URL

LINE Developers Console → Messaging API → Webhook settings:

| 項目 | 値 |
|------|-----|
| Webhook URL | `https://daiko.harunoyukoto.jp/portal-member/api/line_webhook.php` |
| Use webhook | ON |

署名検証に `LINE_CHANNEL_SECRET` を使用します。

## 4. 業者の連携手順

1. マイページにログイン → **LINE連携**
2. 「連携コードを発行」→ 表示された `連携 XXXXXXXX` を公式LINEに送信
3. 以降、トークから操作:

| 送信テキスト | 動作 |
|-------------|------|
| `営業開始` | 本日営業中（`events.is_active = 1`） |
| `20分` / `30分` 等 | お迎え目安 + 営業中 |
| `終了` | 営業終了・待ち時間クリア |
| `ヘルプ` | コマンド一覧 |

更新成功時、ポータル HTML がバックグラウンドで再生成されます（緑枠の反映）。

## 5. Postback（リッチメニュー用）

データ例: `action=open` / `action=close` / `action=wait&minutes=20`

## 6. トラブルシュート

- **403 invalid_signature**: `LINE_CHANNEL_SECRET` の不一致
- **連携できない**: コードの有効期限（24時間）を確認
- **反映されない**: Cron のポータル再生成ログ、または Webhook 直後の `logs/portal-generate.log`
