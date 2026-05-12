import { useAuth } from "../auth";
import { Card } from "../ui";

export default function SettingsMenuPage(): JSX.Element {
  const { me } = useAuth();
  return (
    <Card title="設定">
      <dl style={{ margin: 0, fontSize: "0.9rem", display: "grid", gap: "0.5rem 1rem", gridTemplateColumns: "auto 1fr" }}>
        <dt style={{ color: "var(--color-muted)" }}>テナント</dt>
        <dd style={{ margin: 0 }}>{me?.tenant.name ?? "—"}（{me?.tenant.slug ?? "—"}）</dd>
        <dt style={{ color: "var(--color-muted)" }}>メール</dt>
        <dd style={{ margin: 0 }}>{me?.email ?? "—"}</dd>
      </dl>
      <p style={{ margin: "1rem 0 0", fontSize: "0.85rem", color: "var(--color-muted)" }}>
        詳細設定は今後ここに追加します。
      </p>
    </Card>
  );
}
