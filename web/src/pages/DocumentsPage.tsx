import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Tabs, type TabDef } from "../ui";

function PanelHint({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="settings-hint" style={{ marginTop: 0 }}>{children}</p>;
}

export default function DocumentsPage(): JSX.Element {
  const [tab, setTab] = useState("nippo");

  const tabItems: TabDef[] = [
    {
      id: "nippo",
      label: "日報",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>
            アプリ内の運行・売上の日報は「日報」メニューで作成・編集します。印刷が必要な場合は、各日報詳細からブラウザの印刷機能を利用してください。
          </PanelHint>
          <p style={{ marginTop: "0.75rem" }}>
            <Link to="/daily-reports">日報一覧へ</Link>
          </p>
        </div>
      ),
    },
    {
      id: "meibo",
      label: "従業員名簿",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>従事者の氏名・住所・免許情報などは「設定」で従業員を登録すると名簿用データとして利用できます。</PanelHint>
          <p style={{ marginTop: "0.75rem" }}>
            <Link to="/settings">設定（従業員・車両）へ</Link>
          </p>
        </div>
      ),
    },
    {
      id: "seiyaku",
      label: "誓約書",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>重症患者等の運送に関する誓約書の様式出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "nintei",
      label: "認定証",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>認定事項の記載イメージを出力する機能は、今後このタブから行える予定です。事業者情報は「設定」の事業者情報に入力してください。</PanelHint>
          <p style={{ marginTop: "0.75rem" }}>
            <Link to="/settings">設定へ</Link>
          </p>
        </div>
      ),
    },
    {
      id: "yakkan",
      label: "約款",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>標準自動車運送約款の届出様式イメージなどの出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "shido",
      label: "指導記録簿",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>指導記録の一覧様式の出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "kujo",
      label: "苦情処理簿",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>苦情処理の登録一覧様式の出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
    {
      id: "henko",
      label: "変更届出書",
      children: (
        <div className="settings-section-panel" style={{ marginTop: "0.75rem" }}>
          <PanelHint>変更届の記載例イメージの出力は、今後このタブから行える予定です。</PanelHint>
        </div>
      ),
    },
  ];

  return (
    <Card title="書類を作る">
      <p className="settings-hint" style={{ marginTop: 0 }}>
        帳票・様式は種類ごとのタブに分けています。出力・印刷の本体機能は順次追加します。
      </p>
      <Tabs items={tabItems} activeId={tab} onActiveChange={setTab} aria-label="書類の種類" />
    </Card>
  );
}
