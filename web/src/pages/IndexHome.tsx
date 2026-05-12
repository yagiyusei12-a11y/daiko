import { Card } from "../ui";

export default function IndexHome(): JSX.Element {
  return (
    <Card title="ホーム">
      <p style={{ margin: 0, fontSize: "0.95rem", lineHeight: 1.65 }}>
        Daiko を<strong>一から作り直す</strong>段階です。いまは<strong>テナント・ログイン・この画面</strong>だけが動いています。従業員・日報・帳票などの機能は、設計に合わせて順に追加してください。
      </p>
    </Card>
  );
}
