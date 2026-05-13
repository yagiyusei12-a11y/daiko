# Daiko（代行業向け SaaS 基盤）

**order（モバイル注文アプリ）とは別の Git リポジトリ**です。ローカルでは多くの場合、`order` の clone と **同じ親フォルダ**に並べます（例: `…/order/order` が order、`…/order/daiko` が本プロジェクト）。

別 `package.json` / 別 Prisma スキーマ / 別ポート。本番では **PostgreSQL の別データベース**（例: `daiko`）を推奨します。

## 初回セットアップ（Git）

```bash
cd daiko
git init   # 未初期化の場合
git remote add origin <daiko 用のリモート URL>
git push -u origin main
```

履歴を `order` モノレポから切り出したい場合は `git filter-repo` 等で別途行ってください。このディレクトリを新規リポジトリとして運用する前提です。

## 機能スコープ（いま動いているもの）

アプリを**一から作り直す**段階のため、**API は認証のみ**（`register` / `login` / `refresh` / `me`）、**Web は登録・ログイン・ホーム**のみです。

- マルチテナント・認証: `POST /api/v1/auth/register` でテナント＋`TenantSettings`＋`Subscription`＋`owner`/`staff` ロール＋オーナーユーザー、`login` / `refresh` / `me`（JWT + リフレッシュトークン）
- **Prisma スキーマとマイグレーション**は従来どおり（従業員・日報・帳票テンプレ用テーブルなど）。**REST ルートは未登録**のため、DB の業務テーブルは API からは触れません。機能を足すときにルートと UI を追加してください。
- `npm run db:seed` は **帳票用 `DocumentTemplate` 等**のシードのみ（従来どおり）。

## ブラウザ UI（SPA）

- `web/` を Vite でビルドし、成果物は `public/app/` に出力されます。
- 本番・開発サーバとも `http://<host>:3001/app/` がエントリ（`/` と `/web` は `/app/` へリダイレクト）。
- `npm run build` は **先に web をビルド**してから `tsc` で API サーバをコンパイルします。

## ローカル開発

```bash
cd daiko
cp .env.example .env
# DATABASE_URL を PostgreSQL の daiko DB に向ける
npx prisma migrate deploy
npm run db:seed
npm run dev
# API: http://localhost:3001/health
# UI 開発: 別ターミナルで cd web && npm run dev（Vite が /api を 3001 にプロキシ）
```

## API プレフィックス

`POST /api/v1/auth/register` … 初回テナント＋オーナー  
`POST /api/v1/auth/login` … `{ slug, email, password }`  
`Authorization: Bearer <accessToken>` で以降の API。

## 本番（VPS）

- DNS: `daiko.harunoyukoto.jp` → VPS
- Caddy: order 側の [deploy/vps/Caddyfile](../order/deploy/vps/Caddyfile) にホスト追加済み（`127.0.0.1:3001` 想定）。ローカルで order と `daiko` を同じ親に並べている場合の相対パスです。
- systemd: `deploy/daiko-app.service` を `/etc/systemd/system/` に配置（`WorkingDirectory` は **daiko 専用 clone のルート**、例: `/home/ubuntu/daiko`）
- 初回のみ VPS 上で `git clone <daiko-remote> ~/daiko` のあと、order の clone から `bash ~/order/deploy/vps/install-daiko-systemd.sh ~/daiko`（VPS で order が `~/order` の場合）
- 既存で `~/order/daiko` にあった場合: **pull でサブフォルダが消える前に** `.env` のバックアップ、`mv ~/order/daiko ~/daiko` などで専用 clone に移し、systemd の `WorkingDirectory` / `EnvironmentFile` を合わせる
- デプロイ: `scripts/deploy-vps.ps1`（`.env.deploy` に `DAIKO_VPS_*`）。リモートでは `migrate deploy` のあと **`npm run db:seed`** で帳票テンプレ（9 種＋酒気スタブ）を投入する（**アプリ API は認証のみ**でもシードは従来どおり実行されます）。

### 書類の PDF 出力（サーバー側 Chromium）

書類タブの「PDFで保存」は API が **ヘッドレス Chromium** で HTML を PDF 化します。VPS では次を一度設定してください。

1. **Chromium をインストール**（Ubuntu の例。ディストリビューションに合わせてパッージ名は読み替えてください）

   ```bash
   sudo apt-get update && sudo apt-get install -y chromium-browser
   # または: sudo apt-get install -y chromium
   ```

2. 実行ファイルのパスを確認する（例: `/usr/bin/chromium-browser` または `/usr/bin/chromium`）。

3. **環境変数 `CHROMIUM_EXECUTABLE`** にその絶対パスを設定する。`daiko-app` の systemd ユニットが `EnvironmentFile=` で読む **VPS 上の `.env`**（または `Environment=CHROMIUM_EXECUTABLE=...`）に 1 行追加し、`sudo systemctl daemon-reload && sudo systemctl restart daiko-app` する。

   **`npm run deploy:vps` のたびに** リポジトリの `scripts/ensure-chromium-env.sh` が自動実行され、Chromium が無ければ apt で入れ、`.env` の `CHROMIUM_EXECUTABLE` を更新します（パスワードなし `sudo` が使えない VPS では手順 1〜3を手動で行ってください）。**初回のみ** Ubuntu の `chromium` / `chromium-browser` が Snap を引く場合があり、そのときはデプロイが数分長引くことがあります（2 回目以降は既に入っているため短いです）。

4. （任意）生成がタイムアウトする場合は **`DAIKO_PDF_TIMEOUT_MS`**（ミリ秒、既定 120000）を `.env` に追加する。

未設定のとき PDF 系エンドポイントは **503** を返し、従来どおりの「ブラウザで開いて印刷」（HTML）は利用できます。

### 本番 DB を白紙にする（テナント・業務データをすべて消す）

**同じ VPS・同じドメイン・同じ `.env`（`DATABASE_URL`）・同じデプロイ手順のまま**、アプリの DB だけを初期状態に戻す手順です。`.env.deploy` を作り直す必要はありません（ローカルからの `npm run deploy:vps` も従来どおり）。

1. **（推奨）バックアップ**  
   例: `pg_dump` で `daiko` DBのダンプを取得する（戻したくなったとき用）。

2. **VPS に SSH** し、Daiko の clone ルート（`WorkingDirectory` と同じ、例: `/home/ubuntu/daiko`）へ移動する。

3. **リセットスクリプトを実行**（clone 内の **既存 `.env`** から `DATABASE_URL` を読みます）:

   ```bash
   cd ~/daiko   # 実際のパスに合わせる
   chmod +x scripts/reset-production-database.sh   # 初回のみ可
   DAIKO_CONFIRM_RESET_DB=yes ./scripts/reset-production-database.sh
   ```

   内容: `daiko-app` を停止 → `npm ci` → `public` スキーマを DROP/CREATE → `prisma migrate deploy` → `db:seed` → `npm run build` → サービス再起動相当（`systemctl start`）まで実行します。

4. **初回テナントの再登録**  
   すべてのテナント・ユーザーが消えているため、[`POST /api/v1/auth/register`](README.md)（またはアプリの登録画面）で **slug / メール / パスワードから作り直す**。

**注意**

- **取り消し不可**です。`_prisma_migrations` も消えるため、スクリプト内で `migrate deploy` が全マイグレーションを最初から適用し直します。
- `DATABASE_URL` の DB ユーザーに **`public` の DROP/CREATE 権限**が必要です。権限不足のときは DB 管理者（例: `postgres`）で同等の SQL を実行してください。
- systemd を触りたくない場合（検証のみなど）は `DAIKO_SKIP_SYSTEMCTL=1 DAIKO_CONFIRM_RESET_DB=yes ./scripts/reset-production-database.sh` とし、その後手動で `sudo systemctl restart daiko-app` してください。

- **GitHub Actions（`main` マージ後の自動デプロイ）**: リポジトリに `.github/workflows/deploy-main.yml` がある。`main` への `push` のたびに VPS へ SSH し、上記と同じリモート手順（`git pull` → `npm ci` → migrate → seed → build → `systemctl restart`）を実行する。利用するには GitHub の **Repository secrets** を設定する（下記）。

### GitHub Actions での自動デプロイ

1. GitHub → リポジトリ → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. 次を設定する（必須はホストと鍵）。

| Secret 名 | 内容 |
|-----------|------|
| `DAIKO_VPS_HOST` | VPS のホスト名または IP（例: `133.18.141.239`） |
| `DAIKO_VPS_SSH_KEY` | デプロイ用 **秘密鍵の全文**（PEM。ローカルの `DAIKO_VPS_KEY` が指すファイルの中身と同じもの） |
| `DAIKO_VPS_USER` | （任意）SSH ユーザー。未設定時は `ubuntu` |
| `DAIKO_VPS_PATH` | （任意）VPS 上の clone ルート。**絶対パス推奨**（例: `/home/ubuntu/daiko`）。未設定時はリモートの `$HOME/daiko` |
| `DAIKO_VPS_SERVICE` | （任意）systemd ユニット名。未設定時は `daiko-app` |

3. VPS 側で、その鍵の **公開鍵** が `authorized_keys` に入っていること、`git pull` できる deploy ユーザーであること、`sudo systemctl restart daiko-app` が **パスワードなし**で通ること（既存の手動デプロイと同じ前提）。

**ローカルの `npm run deploy:vps` との違い**: CI は GitHub 上の `main` が既に進んだあとで動くため **`git push` は行わない**（マージが push を済ませている想定）。リモートの pull / migrate / build / restart のみ行う。

**`DAIKO_VPS_HOST` と `DAIKO_VPS_SSH_KEY` が未設定のとき**: デプロイ job は **スキップ**され、ワークフローは失敗しません（ローカル `npm run deploy:vps` のみの運用で通知が届かないようにするため）。GitHub から自動デプロイしたい場合は上表の Secrets を設定してください。

## 事業日（スキーマ）

`TenantSettings.businessDayRollHour` や `Tenant.timezone` は DB に残っています。日報・打刻などの API を再実装するときに利用してください。
