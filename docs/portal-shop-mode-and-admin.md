# 飲食店モード & マスター管理

## 飲食店モード（`?mode=shop`）

市町村一覧ページの URL にクエリを付与:

```
https://daiko.harunoyukoto.jp/portal/shiga/nagahama/?mode=shop
```

- ヒーロー・フィルター・余分なナビを非表示
- **リアルタイム営業中**（緑枠）の業者のみ大きく表示
- 電話ボタンを極大化（`tel:` リンク）

QRコードや店頭タブレットのホーム画面 URL に利用できます。

## マスター管理（`portal-member/admin/`）

| 項目 | 内容 |
|------|------|
| URL | `/portal-member/admin/` |
| 認証 | `.env` の `PORTAL_ADMIN_USERNAME` / `PORTAL_ADMIN_PASSWORD` |

### 機能

- 全加盟業者の DataTables 一覧（検索・ソート）
- `is_premium` 手動 ON/OFF
- `is_suspended` 強制停止（ポータル掲載・API から除外）
- 保存後に `generate_portal_html.py` をバックグラウンド実行

### DB

```bash
mysql -u USER -p portal_member < portal-member/database/migrations/006_companies_suspended.sql
```
