# 製品方針: 裏帳簿・集計・プラン別機能

## 裏帳簿（現金＋領収書なし等）

- **データは削除しない**。運行（TripLeg）は論理削除もしない。必要なら `archivedAt` のみ（名簿・紹介店マスタ側）。
- **集計（売上ダッシュ・給与プール等）は常に全件**を対象にする。公式提出用の数字だけを別ビューで出す場合は、アプリ層で `excludeFromOfficialPrint = false` の行のみ合算する API を分ける（内部用 KPI は全件）。
- **印刷・CSV「公式」エクスポート**では、クエリパラメータ `officialOnly=1` のとき `TripLeg.excludeFromOfficialPrint = false` のみを列挙する。内部用エクスポートは `officialOnly=0` で全件。

## TripLeg フラグ

| 列 | 意味 |
|----|------|
| `excludeFromOfficialPrint` | 帳票・税理士提出用 CSV/PDF から除外（データは残る） |
| `fareOverrideYen` | 料金版計算の代わりに手動運賃（特別料金）。null なら従来計算 |

## DailyReport 決済・領収書

| 列 | 意味 |
|----|------|
| `paymentCashYen` ほか | 日報単位の決済内訳（円） |
| `paymentCashNoReceiptYen` | 現金のうち領収書を発行しなかった金額（0〜`paymentCashYen`） |

## TenantSettings.featureFlags（JSON キー案）

既存の `PlanTier`（FREE / STANDARD / PREMIUM）をライト／スタンダード／プロに対応させ、次のキーで UI・API をガードする想定。

| キー | ライト | スタンダード | プロ |
|------|--------|--------------|------|
| `roster` | 可 | 可 | 可 |
| `dispatchBoard` | 不可 | 可 | 可 |
| `publicBooking` | 不可 | 不可 | 可 |
| `exportCsv` | 制限可 | 可 | 可 |

未設定キーは「許可」として扱い、段階的に `tenant-settings` から編集可能にする。

## 実装スコープ（コードベース）

次を実装しています（詳細はマイグレーションと各ルートを参照）。

- 顧客名簿（Customer）API・画面・印刷用 HTML
- 紹介元（ReferralSource）API・画面
- TripLeg: 顧客・紹介元・手動運賃・公式帳票除外
- DailyReport: 決済内訳（現金・領収書なし現金・カード・PayPay・売掛）
- 日報公式印刷 HTML（公式のみ／全件切替）・単票 CSV
- 期間一括 CSV・一括印刷 HTML
- 売掛（AccountsReceivableEntry）最小 CRUD
- 配車予約（DispatchReservation）一覧・作成・更新（ガント前段）
