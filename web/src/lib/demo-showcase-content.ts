/**
 * デモ画面の見本表用データ（実DBとは無関係。画面イメージの補足用）
 */
export const SAMPLE_INTRO =
  "下の表は画面イメージ用の架空例です。実データで操作するには「デモに入る」か、ログイン・新規テナント登録を利用してください。";

export const SAMPLE_SCHEDULE_ROWS: { lane: string; time: string; label: string }[] = [
  { lane: "未予定", time: "21:45", label: "○○様 長浜駅北口→自宅" },
  { lane: "山田", time: "22:15", label: "△△様 居酒屋街→○○町" },
  { lane: "佐藤", time: "25:30", label: "□□様 病院送迎（翌1:30相当）" },
];

export const SAMPLE_DAILY_REPORT_ROWS: { start: string; client: string; from: string; to: string; fare: string }[] = [
  { start: "5/14 23:10", client: "鈴木一郎", from: "JR長浜駅", to: "木之本町", fare: "¥4,800" },
  { start: "5/15 0:20", client: "株式会社サンプル", from: "本社", to: "ホテル○○", fare: "¥6,200" },
];

export const SAMPLE_TIMECARD_ROWS: { name: string; in: string; breakOut: string; breakIn: string; out: string }[] = [
  { name: "山田 太郎", in: "18:05", breakOut: "22:10", breakIn: "22:40", out: "27:15" },
  { name: "佐藤 花子", in: "17:50", breakOut: "—", breakIn: "—", out: "26:00" },
];

export const SAMPLE_ALCOHOL_ROWS: { when: string; name: string; phase: string; result: string }[] = [
  { when: "2026/05/14 18:10", name: "山田 太郎", phase: "出勤", result: "なし" },
  { when: "2026/05/14 26:05", name: "山田 太郎", phase: "退勤", result: "なし" },
];

export const SAMPLE_COMPLAINT_ROWS: { date: string; channel: string; summary: string; status: string }[] = [
  { date: "2026-05-12", channel: "電話", summary: "迎えが5分遅れたとの申し出（事実確認中）", status: "対応中" },
  { date: "2026-05-10", channel: "メール", summary: "料金表示と請求の相違", status: "完了" },
];

export const SAMPLE_EMPLOYEES: { name: string; role: string; note: string }[] = [
  { name: "八木 祐成", role: "管理者・オーナー", note: "★ はオーナー権限のイメージ" },
  { name: "中川 直樹", role: "客車", note: "シフト・タイムカードの例" },
  { name: "冨村 昴也", role: "随伴", note: "同伴乗務の記録例" },
];

export const SAMPLE_SETTINGS_SNIPPETS: { title: string; body: string }[] = [
  { title: "基本情報", body: "営業時間・日付変更時間（28時など）・支払方法（候補）・ネット予約の終了時刻などをまとめて設定します。" },
  { title: "ネット予約", body: "ゲスト向けURL・所要時間オプション・空き枠の出し方（確定シフト／同時上限）を設定します。" },
  { title: "賃金", body: "従業員ごとに時給／歩合と客車・随伴の単価を登録し、給料タブの集計に使います。" },
];
