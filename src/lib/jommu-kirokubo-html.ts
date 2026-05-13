/** 乗務記録簿（印刷用 HTML）。様式は運行記録の一般的レイアウトに準拠。 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type JommuTripRow = {
  clientName: string;
  charterVehicleNo: string;
  origin: string;
  departedHm: string;
  viaText: string;
  destination: string;
  arrivedHm: string;
  distanceKm: string;
  fareYen: string;
  /** その運行で運転した車両（随伴車の表示） */
  vehicleDriven: string;
};

export type JommuKirokuboModel = {
  businessDateYmd: string;
  /** 年・月・日（表示用。和暦は未対応） */
  yParts: { y: string; m: string; d: string };
  crewName: string;
  clockInHm: string | null;
  clockOutHm: string | null;
  escortVehicleNo: string;
  operatorName: string;
  safetyManagerStampName: string;
  trips: JommuTripRow[];
  odoStartKm: string | null;
  odoEndKm: string | null;
  totalOdoKm: string | null;
  actualDistanceKmSum: string;
  salesTotalYen: string;
};

const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
@media print { .no-print { display: none !important; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
body { font-family: "MS Gothic","Yu Gothic","Noto Sans JP",sans-serif; font-size: 11px; color: #000; margin: 0; padding: 12px; max-width: 900px; margin-inline: auto; }
h1 { font-size: 14px; margin: 0 0 8px; text-align: center; letter-spacing: 0.05em; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #000; padding: 4px 5px; vertical-align: middle; }
th { background: #f3f3f3; font-weight: 600; text-align: center; }
.meta { margin-bottom: 8px; }
.meta td { width: 33%; }
.num { text-align: center; width: 1.8rem; }
.t-right { text-align: right; }
.t-center { text-align: center; }
.footer-m td { font-size: 10px; }
.note { font-size: 9px; color: #333; margin-top: 6px; }
.toolbar { margin-bottom: 10px; }
.toolbar button { padding: 6px 12px; font-size: 12px; cursor: pointer; }
`;

export function buildJommuKirokuboHtml(model: JommuKirokuboModel): string {
  const { yParts } = model;
  const rowCount = Math.max(10, model.trips.length);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const t = model.trips[i];
    rows.push(`<tr>
  <td class="num">${i + 1}</td>
  <td>${t ? esc(t.clientName) : ""}</td>
  <td>${t ? esc(t.charterVehicleNo) : ""}</td>
  <td>${t ? esc(t.origin) : ""}</td>
  <td class="t-center">${t ? esc(t.departedHm) : ""}</td>
  <td>${t ? esc(t.viaText) : ""}</td>
  <td>${t ? esc(t.destination) : ""}</td>
  <td class="t-center">${t ? esc(t.arrivedHm) : ""}</td>
  <td class="t-right">${t ? esc(t.distanceKm) : ""}</td>
  <td class="t-right">${t ? esc(t.fareYen) : ""}</td>
  <td>${t ? esc(t.vehicleDriven) : ""}</td>
</tr>`);
  }

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<title>乗務記録簿 ${esc(model.businessDateYmd)}</title>
<style>${PRINT_CSS}</style>
</head><body>
<div class="toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
<h1>乗務記録簿</h1>
<table class="meta">
  <tr>
    <td rowspan="2"><strong>乗務員氏名</strong><br/>${esc(model.crewName)}</td>
    <td><strong>実施年月日</strong><br/>${esc(yParts.y)} 年 ${esc(yParts.m)} 月 ${esc(yParts.d)} 日</td>
    <td rowspan="2"><strong>事業者名</strong><br/>${esc(model.operatorName)}</td>
  </tr>
  <tr>
    <td><strong>随伴車 車両番号</strong><br/>${esc(model.escortVehicleNo)}</td>
  </tr>
  <tr>
    <td><strong>始業時刻</strong>　${model.clockInHm ? esc(model.clockInHm) : "＿　：＿＿"}</td>
    <td><strong>終業時刻</strong>　${model.clockOutHm ? esc(model.clockOutHm) : "＿　：＿＿"}</td>
    <td class="t-center"><strong>安全運転管理者印</strong><br/><br/>${esc(model.safetyManagerStampName)}</td>
  </tr>
</table>

<table>
  <thead>
    <tr>
      <th class="num">No</th>
      <th>依頼者</th>
      <th>客車<br/>車両番号</th>
      <th>依頼場所</th>
      <th>開始時刻</th>
      <th>経由地</th>
      <th>到着場所</th>
      <th>到着時刻</th>
      <th>走行距離<br/>（km）</th>
      <th>料金<br/>（円）</th>
      <th>運転した車両</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join("\n")}
  </tbody>
</table>

<p class="note"><strong>メーター・距離等</strong>（始業・終業の ODO は、乗務員の出勤以降・退勤以前に記録された該当随伴車の ODO ログから算出）</p>
<table class="footer-m">
  <tr>
    <th>始業時（km）</th>
    <th>終業時（km）</th>
    <th>走行距離合計（km）</th>
    <th>実車走行距離（km）</th>
    <th>売上合計（円）</th>
  </tr>
  <tr>
    <td class="t-right">${model.odoStartKm != null ? esc(model.odoStartKm) : ""}</td>
    <td class="t-right">${model.odoEndKm != null ? esc(model.odoEndKm) : ""}</td>
    <td class="t-right">${model.totalOdoKm != null ? esc(model.totalOdoKm) : ""}</td>
    <td class="t-right">${esc(model.actualDistanceKmSum)}</td>
    <td class="t-right">${esc(model.salesTotalYen)}</td>
  </tr>
</table>
<p class="note no-print">ブラウザの印刷ダイアログから PDF 保存できます。</p>
</body></html>`;
}
