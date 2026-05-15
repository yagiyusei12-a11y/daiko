import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { apiFetch } from "../api";
import { Err } from "../ui";
import {
  SAMPLE_ALCOHOL_ROWS,
  SAMPLE_COMPLAINT_ROWS,
  SAMPLE_DAILY_REPORT_ROWS,
  SAMPLE_EMPLOYEES,
  SAMPLE_INTRO,
  SAMPLE_SCHEDULE_ROWS,
  SAMPLE_SETTINGS_SNIPPETS,
  SAMPLE_TIMECARD_ROWS,
} from "../lib/demo-showcase-content";

const demoBookingSlug = (import.meta.env.VITE_DEMO_BOOKING_SLUG as string | undefined)?.trim();

function SampleBlock({ title, hint, children }: { title: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="settings-section-panel" style={{ marginBottom: 0 }}>
      <h2 className="settings-subtitle" style={{ marginTop: 0 }}>
        {title}
      </h2>
      {hint ? (
        <p className="settings-hint" style={{ marginTop: 0 }}>
          {hint}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export default function DemoShowcasePage(): JSX.Element {
  const nav = useNavigate();
  const { enterDemo } = useAuth();
  const [demoAvailable, setDemoAvailable] = useState<boolean | null>(null);
  const [demoErr, setDemoErr] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const loadDemoConfig = useCallback(async () => {
    const r = await apiFetch<{ available?: boolean }>("/auth/demo-config");
    if (!r.ok) {
      setDemoAvailable(false);
      return;
    }
    setDemoAvailable(Boolean(r.data.available));
  }, []);

  useEffect(() => {
    void loadDemoConfig();
  }, [loadDemoConfig]);

  async function onEnterDemo(): Promise<void> {
    setDemoErr(null);
    setDemoBusy(true);
    const er = await enterDemo();
    setDemoBusy(false);
    if (er) {
      setDemoErr(er);
      return;
    }
    nav("/", { replace: true });
  }

  return (
    <div className="auth-screen auth-screen--wide">
      <div className="card" style={{ maxWidth: "44rem", width: "100%" }}>
        <h1 className="card-title" style={{ marginTop: 0 }}>
          デモ・体験
        </h1>
        <p className="auth-lede" style={{ marginBottom: "1rem" }}>
          {SAMPLE_INTRO}
        </p>

        <section className="settings-section-panel" style={{ marginBottom: "1rem" }}>
          <h2 className="settings-subtitle" style={{ marginTop: 0 }}>
            試し方
          </h2>
          <ul className="settings-hint" style={{ margin: "0.35rem 0 0", paddingLeft: "1.2rem", lineHeight: 1.65 }}>
            <li>
              <strong>デモ専用データで触る（ログイン不要）</strong>
              ：下のボタンから、本番店舗とは分離したデモ用テナント（サンプルデータ入り）のスタッフ画面に入れます。操作内容はデモ用DBにのみ保存されます。
            </li>
            <li>
              <strong>自分の店舗で使う</strong>：<Link to="/login">ログイン</Link>
              （店舗ID・メール・パスワード）または
              <Link to="/register">新規テナント登録</Link>で空の店舗を作成してください。
            </li>
            <li>
              <strong>ネット予約だけ</strong>：店舗がゲスト予約を有効にしている場合、公開URL（例:{" "}
              <code>/app/book/店舗スラッグ</code>）から予約フォームを開けます。
              {demoBookingSlug ? (
                <>
                  {" "}
                  この環境用のリンク：{" "}
                  <Link to={`/book/${encodeURIComponent(demoBookingSlug)}`}>ゲスト予約を開く</Link>
                </>
              ) : (
                <>
                  {" "}
                  （ビルド時に <code>VITE_DEMO_BOOKING_SLUG</code> を設定すると、ここにデモ店の予約リンクが表示されます。）
                </>
              )}
            </li>
          </ul>
        </section>

        {demoAvailable === true ? (
          <section className="settings-section-panel" style={{ marginBottom: "1rem" }}>
            <h2 className="settings-subtitle" style={{ marginTop: 0 }}>
              デモに入る
            </h2>
            <p className="settings-hint" style={{ marginTop: 0 }}>
              パスワード不要で、あらかじめ用意したデモ用アカウントの権限でアプリが開きます。
            </p>
            <Err msg={demoErr} />
            <button type="button" className="settings-primary" disabled={demoBusy} onClick={() => void onEnterDemo()}>
              {demoBusy ? "接続中…" : "デモ画面に入る（ログイン不要）"}
            </button>
          </section>
        ) : demoAvailable === false ? (
          <p className="settings-hint" style={{ marginBottom: "1rem" }}>
            このサーバーでは「デモに入る」機能がオフです。運用側で{" "}
            <code>DAIKO_DEMO_TENANT_SLUG</code> と <code>DAIKO_DEMO_USER_EMAIL</code> を設定すると有効になります。
          </p>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <SampleBlock title="運行スケジュール（見本）" hint="担当列と時間軸（24時以降の表示）のイメージです。">
            <table className="dash-driver-table">
              <thead>
                <tr>
                  <th>列</th>
                  <th>開始目安</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_SCHEDULE_ROWS.map((r, i) => (
                  <tr key={i}>
                    <td>{r.lane}</td>
                    <td>{r.time}</td>
                    <td>{r.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SampleBlock>

          <SampleBlock title="日報・運行一覧（見本）">
            <table className="dash-driver-table">
              <thead>
                <tr>
                  <th>開始</th>
                  <th>依頼者</th>
                  <th>出発</th>
                  <th>到着</th>
                  <th>運賃</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_DAILY_REPORT_ROWS.map((r, i) => (
                  <tr key={i}>
                    <td>{r.start}</td>
                    <td>{r.client}</td>
                    <td>{r.from}</td>
                    <td>{r.to}</td>
                    <td>{r.fare}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SampleBlock>

          <SampleBlock title="タイムカード一覧（見本・28時間表記の例）">
            <table className="dash-driver-table">
              <thead>
                <tr>
                  <th>氏名</th>
                  <th>出勤</th>
                  <th>休憩出</th>
                  <th>休憩戻</th>
                  <th>退勤</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_TIMECARD_ROWS.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.in}</td>
                    <td>{r.breakOut}</td>
                    <td>{r.breakIn}</td>
                    <td>{r.out}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SampleBlock>

          <SampleBlock title="アルコール点検（見本）">
            <table className="dash-driver-table">
              <thead>
                <tr>
                  <th>日時</th>
                  <th>氏名</th>
                  <th>区分</th>
                  <th>酒気帯び</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_ALCOHOL_ROWS.map((r, i) => (
                  <tr key={i}>
                    <td>{r.when}</td>
                    <td>{r.name}</td>
                    <td>{r.phase}</td>
                    <td>{r.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SampleBlock>

          <SampleBlock title="苦情（見本）">
            <table className="dash-driver-table">
              <thead>
                <tr>
                  <th>受付日</th>
                  <th>経路</th>
                  <th>概要</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_COMPLAINT_ROWS.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td>
                    <td>{r.channel}</td>
                    <td>{r.summary}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SampleBlock>

          <SampleBlock title="従業員・権限（見本）">
            <table className="dash-driver-table">
              <thead>
                <tr>
                  <th>氏名</th>
                  <th>担当イメージ</th>
                  <th>メモ</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_EMPLOYEES.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.role}</td>
                    <td>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SampleBlock>

          <SampleBlock title="設定画面で触る項目（概要）">
            <ul style={{ margin: 0, paddingLeft: "1.1rem", lineHeight: 1.7 }}>
              {SAMPLE_SETTINGS_SNIPPETS.map((s, i) => (
                <li key={i}>
                  <strong>{s.title}</strong>：{s.body}
                </li>
              ))}
            </ul>
          </SampleBlock>
        </div>

        <div className="auth-footer-row" style={{ marginTop: "1.25rem" }}>
          <Link to="/login">ログインへ戻る</Link>
          <Link to="/register">新規テナント登録</Link>
        </div>
      </div>
    </div>
  );
}
