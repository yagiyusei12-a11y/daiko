# ポータルプレミアム × 自社請求システム連携

自社請求システム（sales_entry / sales_slip 系）とポータル会員 DB を連携し、プレミアム申込の自動起票・入金後の `is_premium` 自動更新・ポータル HTML 再生成を行います。

接続情報は `portal-member/config/config.php` のみに置き、この文書や crontab にはパスワードを書きません。

## 1. データベースマイグレーション

### ポータル会員 DB（`portal_member`）

新規 install の正式経路は `001_init.sql` のあと `php scripts/apply-portal-member-migrations.php` です。既存 DB への追加適用も applicator を使います。

### 請求システム DB

請求 DB へブリッジテーブルを作成します（接続情報は請求システムの通常手順に従う）。

```bash
mysql -u USER -p INVOICE_DB < portal-member/database/migrations/invoice_system/001_portal_premium_bridge.sql
```

`portal_premium_billings` の `sales_slip_id` には UNIQUE 制約がありません。同期処理は同一 `sales_slip_id` が複数行ある場合、どれか 1 件を選ばず skip します。

## 2. 設定（`portal-member/config/config.php`）

`config.example.php` の `invoice` セクションをコピーし、サーバー上の `config.php` だけに本番接続を書きます。Git には含めません。

```php
'invoice' => [
    'enabled' => true,
    'db' => [ /* 請求システム MySQL。パスワードは config.php のみ */ ],
    'paid_detection' => 'bridge_and_payment',
    'defaults' => [
        'monthly_amount_yen' => 3300,
        'product_name' => 'ポータルサイトプレミアム枠掲載料',
    ],
],
'project_root' => '/home/ubuntu/daiko',
'portal_python' => '/home/ubuntu/daiko/.venv/bin/python3',
```

`paid_detection`:

- `bridge_and_payment`（既定）: ブリッジが `paid`、または伝票固有根拠（下記）がある入金のみ自動 paid
- `bridge_only`: ブリッジテーブルの `billing_status` のみ。`pay_receipt` からの自動判定はしない

`defaults.fallback_customer_id` は得意先 INSERT 失敗時の顧客 ID フォールバック専用です。**入金マッチには使いません。**

## 3. フロー

| 段階 | 処理 |
|------|------|
| 申込 | ダッシュボード POST `premium_apply` → `sales_slip` + 明細 + `portal_premium_billings`。伝票 memo に `PORTAL_SLIP:{id}` を記録 |
| 入金前 | `companies.is_premium = 0`、`premium_billing_status = invoiced` |
| 入金検知 | Cron `php scripts/sync_premium_status.php` が伝票固有根拠のみで判定 |
| 有効化 | 一意な paid 根拠があるときだけ `is_premium = 1` → HTML 再生成 |
| 期限超過 / キャンセル | ブリッジに明確な `overdue` / `cancelled` があるときだけ OFF |
| 不確実 | ブリッジ欠落・DB エラー・曖昧マッチは **現状維持**（管理画面の手動 ON を不確かな情報で OFF にしない） |

## 4. Cron

有効化前に dry-run:

```bash
php scripts/sync_premium_status.php --dry-run
```

```cron
# プレミアム入金同期（15分ごと）— dry-run 確認後
*/15 * * * * cd /home/ubuntu/daiko && /usr/bin/php scripts/sync_premium_status.php >> /var/log/daiko-premium-sync.log 2>&1
```

crontab に DB パスワードを書かないこと。詳細は [vps-cron-setup.md](./vps-cron-setup.md)。

## 5. 入金検知（自動 paid に必要な根拠）

自動で `paid` / プレミアム ON にするには、次の **伝票固有** 根拠が必要です。

- `sales_slip.id` の status が設定上の paid
- 入金 memo の `PORTAL_SLIP:{sales_slip.id}`（数字の部分一致で別伝票に当たらないよう検証する）

次だけでは paid にしません。

- 得意先 ID 一致
- 発行日以降
- 金額一致 / 金額以上
- 共有の `fallback_customer_id`
- `PORTAL_PREMIUM` のような会社・用途レベルだけのマーカー

根拠が取れない場合は `UNMATCHED` / `SKIP` / `UNKNOWN` 相当で、自動プレミアム ON しません。

請求システムで入金登録するときは、入金 memo に `PORTAL_SLIP:123`（当該伝票 ID）を付けてください。

## 6. テーブル名が異なる場合

`invoice.tables` で `sales_slip` / `m_customer` 等の物理名を上書きしてください。

`m_customer` の INSERT 列が異なる環境では、請求システム側に `PORTAL-*` コードの得意先を手動登録できます。その ID を `defaults.fallback_customer_id` に指定しても、**入金の自動マッチには使いません。**
