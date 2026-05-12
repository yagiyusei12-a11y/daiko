# Agent 向けメモ（Daiko）

## 責務の範囲

機能変更やバグ修正では、**ローカルでビルド・検証できる状態にするだけで終わらない**。変更が本番方針に沿う場合は、**本番への反映まで**をエージェントの責務とする。

## 本番デプロイ（VPS）

- 手順の詳細は [README.md](./README.md) の「本番（VPS）」。
- ローカル（開発機）から実行するスクリプト: **`npm run deploy:vps`**（[`scripts/deploy-vps.ps1`](./scripts/deploy-vps.ps1)）。
- 事前条件（不足していればデプロイは実行できない）:
  - 変更は **`main` にコミット済み**、`deploy-vps.ps1` は **`git push origin main`** を行う。
  - **`.env.deploy`** に `DAIKO_VPS_HOST` / `DAIKO_VPS_KEY`（および必要なら `DAIKO_VPS_USER`, `DAIKO_VPS_PATH`, `DAIKO_VPS_SERVICE`）。ベースは [`.env.deploy.example`](./.env.deploy.example)（存在すれば）。
  - リモートでは `git pull` → `npm ci` → `prisma migrate deploy` → `db:seed` → `build` → **`systemctl restart daiko-app`** まで一続き。

## 実行時の判断

- **デフォルト**: ユーザーが「本番に出さない」「デプロイしない」と明示しない限り、コード変更を伴う作業の終わりに **コミット → `npm run deploy:vps`** まで行う（追加で「デプロイして」と言わなくてよい）。**マイグレーションや API/UI の変更後にデプロイを忘れてタスク完了にしない。**
- デプロイに必要な認証情報がワークスペースに無い場合は、**実行できないことを明示**し、ユーザーに `.env.deploy` の用意または手動デプロイを依頼する。
- デプロイを実行した場合は、成功・失敗とログの要点を報告する。

## 参照

- API/UI ビルド: ルートで `npm run build`（web を含む）。
- ヘルス: デプロイ後 `http://127.0.0.1:3001/health`（VPS 上。スクリプト内でも確認）。
