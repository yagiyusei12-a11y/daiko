# Daiko システム設計

代行業向けマルチテナント SaaS のアーキテクチャ概要です。実装の入口は [`src/index.ts`](../src/index.ts)、データモデルは [`prisma/schema.prisma`](../prisma/schema.prisma) を参照してください。

関連: [README.md](../README.md)（セットアップ・本番デプロイ）、[AGENTS.md](../AGENTS.md)（エージェント向け運用メモ）

---

## 1. 全体構成（デプロイ・境界）

**Daiko** は **order**（モバイル注文アプリ）とは別リポジトリ・別 PostgreSQL データベースです。本番は `daiko.harunoyukoto.jp`（VPS 上で Caddy → Node `:3001`）を想定しています。

```mermaid
flowchart TB
  subgraph Clients["クライアント"]
    Browser["ブラウザ"]
    LINE["LINE LIFF / Mini App"]
  end

  subgraph VPS["VPS（本番）"]
    Caddy["Caddy リバースプロキシ"]
    Node["daiko-app<br/>Fastify :3001"]
    PG[("PostgreSQL<br/>DB: daiko")]
    Chrome["Chromium / Chrome<br/>PDF 生成"]
    LO["LibreOffice<br/>一部書類"]
  end

  subgraph External["外部サービス"]
    Stripe["Stripe<br/>Checkout / Webhook"]
    Nominatim["OpenStreetMap Nominatim<br/>逆ジオコーディング"]
    LINEAPI["LINE Platform<br/>ID Token 検証"]
  end

  Browser -->|HTTPS| Caddy
  LINE -->|HTTPS + CORS| Caddy
  Caddy --> Node
  Node --> PG
  Node --> Chrome
  Node --> LO
  Node --> Stripe
  Node --> Nominatim
  Node --> LINEAPI
```

| レイヤ | パス | URL 例 | 役割 |
|--------|------|--------|------|
| LP | `public/lp/` | `/`, `/lp/*`, `/legal/*`, `/report` | マーケティング・問い合わせ導線・機能別ランディング |
| SPA | `web/` → `public/app/` | `/app/*` | テナント業務 UI（React） |
| API | `src/` | `/api/v1/*` | REST API（Fastify） |
| 静的画像 | `public/images/` | `/images/*` | OGP・LP 用画像など |
| DB | `prisma/` | — | スキーマ・マイグレーション |

単一 Node プロセスが LP・SPA・API を配信します（[`src/index.ts`](../src/index.ts)）。

---

## 2. アプリケーション層

```mermaid
flowchart LR
  subgraph Presentation["プレゼンテーション"]
    LP_HTML["LP HTML/CSS/JS"]
    React["React SPA<br/>React Router"]
  end

  subgraph API_Layer["API 層（Fastify）"]
    Static["静的配信"]
    Routes["src/routes/*"]
    AuthMW["src/auth/*"]
    Lib["src/lib/*"]
  end

  subgraph Data["データ"]
    PrismaClient["Prisma Client"]
    DB[("PostgreSQL")]
  end

  LP_HTML --> Static
  React -->|Bearer JWT| Routes
  Static --> Routes
  Routes --> AuthMW
  Routes --> Lib
  Lib --> PrismaClient
  PrismaClient --> DB
```

**ビルド**

- `npm run build` … `web` を Vite ビルド → `public/app/` に出力 → `tsc` で API をコンパイル
- 開発: ルートで `npm run dev`（API `:3001`）、UI は `cd web && npm run dev`（Vite が `/api` をプロキシ）

---

## 3. API モジュール

プレフィックスは原則 **`/api/v1`**。ルート登録は [`src/index.ts`](../src/index.ts) を参照。

| モジュール | プレフィックス | 主な責務 |
|------------|----------------|----------|
| `auth` | `/api/v1` | テナント登録、ログイン、refresh、`/me`、本人免許 |
| `billing` | `/api/v1/billing` | Stripe Checkout、課金状態 |
| `billing-webhook` | `/api/v1/billing` | Stripe Webhook |
| `settings` | `/api/v1/settings` | 店舗・料金表・車両・従業員・メニュー表示など |
| `attendance` | `/api/v1/attendance` | 勤怠・打刻 |
| `daily-reports` | `/api/v1` | 日報・乗務記録 |
| `trip-legs` | `/api/v1` | 運行一覧・運行明細 |
| `dashboard` | `/api/v1/dashboard` | ダッシュボード集計 |
| `dispatch` | `/api/v1/dispatch` | 配車・予約枠 |
| `documents` | `/api/v1` | 法定帳票・PDF |
| `complaints` | `/api/v1/complaints` | 苦情台帳 |
| `instruction-records` | `/api/v1/instruction-records` | 指導記録 |
| `liff-booking` | `/api/v1/liff` | LINE LIFF 予約 |
| `public-booking` | `/api/v1/public` | ゲスト Web 予約 |
| `employee-invite` | `/api/v1/public` | 従業員招待トークン |
| `public-inquiry` | `/api/v1/public` | LP 問い合わせ |
| `platform` | `/api/v1/platform` | 運営者（全テナント横断） |

```mermaid
flowchart TB
  V1["/api/v1"]

  V1 --> Auth["auth"]
  V1 --> Billing["billing + webhook"]
  V1 --> Settings["settings"]
  V1 --> Ops["daily-reports / trip-legs / dispatch / dashboard"]
  V1 --> Compliance["documents / complaints / instruction-records"]
  V1 --> Public["public / liff"]
  V1 --> Platform["platform"]
```

OpenAPI: 非本番または `OPENAPI_UI=1` で `/api/v1/docs`、定義 JSON は `/api/v1/openapi.json`。

---

## 4. 認証・マルチテナント・課金

```mermaid
sequenceDiagram
  participant U as ユーザー
  participant SPA as React /app
  participant API as Fastify
  participant DB as PostgreSQL
  participant Stripe as Stripe

  U->>SPA: login(slug, email, password)
  SPA->>API: POST /api/v1/auth/login
  API->>DB: User + Tenant 検証
  API-->>SPA: accessToken + refreshToken

  SPA->>API: GET /api/v1/me (Bearer)
  API-->>SPA: tenant, roles, billing, notices

  Note over SPA,API: 主要業務 API
  SPA->>API: 業務リクエスト
  API->>API: authenticate → requireTenantBilling
  API->>DB: tenantId でスコープ

  U->>SPA: 課金
  SPA->>API: POST /billing/checkout-session
  API->>Stripe: Checkout Session
  Stripe-->>U: 決済
  Stripe->>API: Webhook
  API->>DB: Subscription / paidThroughAt 更新
```

| 概念 | 実装 |
|------|------|
| テナント識別 | JWT の `tenantId`（[`src/auth/pre.ts`](../src/auth/pre.ts)） |
| データ分離 | クエリで `tenantId` を必ず付与 |
| 課金ゲート | [`authenticateAndBilling`](../src/auth/protected-pre.ts)（トライアル・Stripe・ライセンスキー） |
| ロール | `User` ↔ `Role`（owner / staff 等） |

---

## 5. フロントエンド（SPA）

ルート定義: [`web/src/App.tsx`](../web/src/App.tsx)。テナント UI は [`web/src/layout/Shell.tsx`](../web/src/layout/Shell.tsx) でラップ。

```mermaid
flowchart TB
  subgraph PublicRoutes["認証不要"]
    Login["/login"]
    Register["/register"]
    Book["/book/:slug"]
    Invite["/invite/:token"]
    Billing["/billing"]
  end

  subgraph TenantApp["Shell（テナント）"]
    Schedule["/ 今日の予定"]
    Dash["/dashboard"]
    DR["/daily-reports"]
    Trips["/daily-reports/trips"]
    Att["/attendance"]
    Doc["/documents"]
    Comp["/complaints"]
    Inst["/instruction-records"]
    Set["/settings"]
  end

  subgraph Platform["PlatformShell（運営）"]
    Inq["/platform/inquiries"]
    Ten["/platform/tenants"]
    Lic["/platform/licenses"]
    PSet["/platform/settings"]
  end

  Login --> TenantApp
  Register --> TenantApp
  TenantApp -->|canAccessApp=false| Billing
```

メニュー項目はロールと `staff-menu-visibility` 設定でフィルタされます。

---

## 6. ドメインデータ（Prisma）

`Tenant` を中心に、代行店のマスタ・日次運行・コンプライアンス・課金がぶら下がります。全モデルは [`prisma/schema.prisma`](../prisma/schema.prisma) を参照。

```mermaid
erDiagram
  Tenant ||--o| TenantSettings : has
  Tenant ||--o{ User : has
  Tenant ||--o{ Employee : has
  Tenant ||--o{ Vehicle : has
  Tenant ||--o{ TariffPlan : has
  Tenant ||--o{ DailyReport : has
  Tenant ||--o{ DispatchReservation : has
  Tenant ||--o{ Subscription : has

  DailyReport ||--o{ TripLeg : contains
  DailyReport ||--o{ TimePunch : has
  DailyReport ||--o{ AlcoholCheck : has

  Employee ||--o{ TimeCardPunch : has
  Employee ||--o{ ShiftApplication : has

  TripLeg }o--o| Customer : optional
  DispatchReservation }o--o| Customer : optional
```

| ドメイン塊 | 主なモデル | 用途 |
|------------|------------|------|
| 組織・課金 | `Tenant`, `Subscription`, `LicenseKey`, `StripeWebhookEvent` | SaaS 契約・トライアル |
| マスタ | `Employee`, `Vehicle`, `TariffPlan*`, `Customer`, `ReferralSource` | 店舗設定・料金表 |
| 運行 | `DailyReport`, `TripLeg`, `DispatchReservation`, `AccountsReceivableEntry` | 日次業務・配車・売掛 |
| 勤怠 | `TimePunch`, `TimeCardPunch`, `ShiftApplication`, `ConfirmedShiftDay` | 出退勤・シフト |
| コンプライアンス | `DocumentTemplate`, `ComplaintLedger`, `InstructionRecord`, `GuidanceSession`, `LegalRegisterStub` | 法定・社内帳票 |
| 運営 | `PlatformSetting`, `MarketingInquiry`, `MarketingInquiryReply` | LP 問い合わせ・全テナント管理 |

---

## 7. 主要ビジネスフロー

### 7.1 テナントの一日

```mermaid
flowchart LR
  A["配車・予約<br/>dispatch / public"] --> B["今日の予定"]
  B --> C["日報・運行<br/>daily-reports / trip-legs"]
  C --> D["料金計算<br/>src/lib/*"]
  C --> E["乗務記録 PDF<br/>Chromium"]
  F["勤怠<br/>attendance"] --> C
  G["帳票<br/>documents"] --> E
```

### 7.2 外部連携

| 連携 | 用途 | 主なコード |
|------|------|------------|
| Stripe | Checkout・Webhook・課金状態 | `src/routes/billing.ts`, `billing-webhook.ts`, `src/lib/stripe-billing.ts` |
| LINE | LIFF 予約（ID Token） | `src/routes/liff-booking.ts`, `src/lib/line-id-token.ts` |
| Chromium | HTML → PDF（帳票・乗務記録） | `src/lib/html-to-pdf.ts`, `templates/jommu-print/` |
| LibreOffice | 一部ドキュメント変換 | `scripts/ensure-libreoffice-env.sh` |
| Nominatim | 座標 → 地名（キャッシュ付き） | `src/lib/reverse-geocode-cache.ts` |

PDF 未設定時は関連 API が **503** を返します（`CHROMIUM_EXECUTABLE`）。詳細は [README.md](../README.md) の「書類の PDF 出力」を参照。

---

## 8. ディレクトリ構造

```
daiko/
├── web/                 # React + Vite（業務 SPA ソース）
├── src/
│   ├── index.ts         # エントリ・ルート登録・静的配信
│   ├── routes/          # HTTP ハンドラ（ドメイン別）
│   ├── lib/             # 料金・PDF・印刷 HTML・Stripe 等
│   └── auth/            # JWT・課金 preHandler
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts          # 帳票テンプレ等
├── public/
│   ├── lp/              # マーケティング LP
│   ├── app/             # Vite ビルド成果物
│   └── images/
├── templates/           # 乗務記録など印刷用 HTML
├── scripts/             # deploy-vps, Stripe 運用, Chromium/LibreOffice 設定
└── docs/                # 本ドキュメントほか
```

---

## 9. デプロイ

```mermaid
flowchart LR
  Dev["ローカル<br/>npm run dev"] --> Push["git push main"]
  Push --> GH["GitHub Actions<br/>.github/workflows/deploy-main.yml"]
  Push --> PS["npm run deploy:vps<br/>scripts/deploy-vps.ps1"]
  PS --> VPS["VPS: git pull"]
  VPS --> M["prisma migrate deploy"]
  VPS --> S["db:seed"]
  VPS --> B["npm run build"]
  VPS --> R["systemctl restart daiko-app"]
```

リモート手順の詳細・環境変数は [README.md](../README.md) の「本番（VPS）」を参照。

---

## 10. order との関係

| 項目 | Daiko | order |
|------|-------|-------|
| リポジトリ | 本リポジトリ | 別 clone |
| DB | `daiko` 推奨 | order 用 DB |
| ドメイン例 | `daiko.harunoyukoto.jp` | order 側ホスト |
| 連携 | コード・DB 共有なし（同一 VPS に並置可能） | — |

---

## 更新方針

ルート追加・大きなドメイン変更時は、本ファイルの該当セクション（§3 API、§5 SPA、§6 データ）をあわせて更新してください。
