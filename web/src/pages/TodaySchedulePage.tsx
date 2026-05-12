import { Card } from "../ui";

function formatTodayJa(d: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

/** 本日のスケジュール（API 連携前のプレースホルダ） */
export default function TodaySchedulePage(): JSX.Element {
  const now = new Date();

  return (
    <Card title="本日のスケジュール">
      <p style={{ margin: "0 0 1rem", fontSize: "0.95rem", color: "var(--color-muted)" }}>{formatTodayJa(now)}</p>
      <div
        style={{
          border: "1px dashed var(--color-border)",
          borderRadius: "var(--radius-md)",
          padding: "1.5rem 1rem",
          textAlign: "center",
          fontSize: "0.9rem",
          color: "var(--color-muted)",
          background: "var(--color-surface)",
        }}
      >
        登録された予定はありません。
        <br />
        <span style={{ fontSize: "0.82rem" }}>（今後、予定データと連携します）</span>
      </div>
    </Card>
  );
}
