/** 乗務記録簿（印刷用 HTML）。Excel 様式（zyoumukiroku）に準拠したレイアウト。 */

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
};

export type JommuKirokuboModel = {
  businessDateYmd: string;
  yParts: { y: string; m: string; d: string };
  crewName: string;
  clockInHm: string | null;
  clockOutHm: string | null;
  /** 免許証通し番号（登録の免許番号を流用。未登録は空欄） */
  licenseSerialNo: string;
  /** 事業所名（帳票表記。法定事業者名を使用） */
  officeName: string;
  safetyManagerStampName: string;
  /** 同伴従事者（ペア乗務員）。未設定は空欄 */
  partnerCrewName: string;
  trips: JommuTripRow[];
  odoStartKm: string | null;
  odoEndKm: string | null;
  totalOdoKm: string | null;
  actualDistanceKmSum: string;
  salesTotalYen: string;
};

/** 「HH:MM」→ 表示用の時・分（空は全角スペース風） */
function splitHm(hm: string | null): { h: string; m: string } {
  if (!hm || !String(hm).trim()) return { h: "", m: "" };
  const p = String(hm).trim().split(":");
  const h = (p[0] ?? "").trim();
  const m = (p[1] ?? "").trim().slice(0, 2);
  return { h, m };
}

function timeCells(hm: string | null): string {
  const { h, m } = splitHm(hm);
  const hb = h ? esc(h) : '<span class="t-blank">　　</span>';
  const mb = m ? esc(m) : '<span class="t-blank">　　</span>';
  return `${hb}<span class="t-colon">：</span>${mb}`;
}

const PRINT_CSS = `
@page { size: A4; margin: 10mm; }
@media print {
  .no-print { display: none !important; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
body {
  font-family: "MS P Gothic","MS PGothic","Yu Gothic","Meiryo",sans-serif;
  font-size: 10.5pt;
  color: #000;
  margin: 0;
  padding: 8px 10px;
}
.toolbar { margin-bottom: 8px; }
.toolbar button { padding: 6px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.jommu-sheet {
  max-width: 190mm;
  margin: 0 auto 12px;
  page-break-after: always;
  break-after: page;
  padding: 6px 8px 8px;
  box-sizing: border-box;
}
.jommu-sheet:last-of-type { page-break-after: auto; break-after: auto; }
.jommu-retention {
  text-align: right;
  font-size: 9pt;
  margin-bottom: 2px;
  padding-right: 2px;
}
.jommu-title {
  text-align: center;
  font-size: 16pt;
  font-weight: bold;
  margin: 2px 0 8px;
  letter-spacing: 0.25em;
}
.jommu-meta {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-bottom: 0;
  border: 2px solid #000;
  border-bottom: none;
}
.jommu-meta td, .jommu-meta th {
  border: 1px solid #000;
  padding: 4px 5px;
  vertical-align: middle;
  font-size: 9.5pt;
}
.jommu-meta .hdr { background: #f4e3d0; font-weight: bold; text-align: center; }
.jommu-meta .lbl { background: #f4e3d0; font-weight: bold; text-align: center; width: 7.5em; }
.jommu-meta .val { min-height: 2.2em; }
.jommu-meta .t-colon { padding: 0 2px; }
.jommu-meta .t-blank { letter-spacing: 0.1em; }
.jommu-meta .time-row td { vertical-align: middle; }
.jommu-meta .crew { font-size: 11pt; min-height: 3.2em; vertical-align: top; }
.jommu-meta .office { font-size: 11pt; vertical-align: top; }
.jommu-meta .office .safety { margin-top: 10px; font-size: 9pt; }
.jommu-meta .hdr-i { background: #f4e3d0; font-weight: bold; text-align: center; margin: -3px -3px 4px; padding: 3px; border-bottom: 1px solid #000; }
.jommu-meta .time { font-size: 9.5pt; }
.jommu-meta .t-center { text-align: center; }
.jommu-meta .safety-box { position: relative; min-height: 4.5em; }
.jommu-meta .safety-inkan {
  float: right;
  width: 2.4em;
  height: 2.4em;
  border: 1px solid #000;
  border-radius: 50%;
  text-align: center;
  line-height: 2.2em;
  font-size: 8pt;
  margin-left: 6px;
}
.jommu-main {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-top: 0;
  border: 2px solid #000;
  border-top: 1px solid #000;
}
.jommu-main th, .jommu-main td {
  border: 1px solid #000;
  padding: 3px 2px;
  vertical-align: middle;
  font-size: 8.5pt;
}
.jommu-main thead th {
  background: #f4e3d0;
  font-weight: bold;
  text-align: center;
  line-height: 1.25;
}
.jommu-main .c-no { width: 2em; text-align: center; }
.jommu-main .c-num { text-align: right; }
.jommu-main .u { font-size: 7.5pt; font-weight: normal; }
.jommu-main tbody td { min-height: 1.35em; }
.jommu-main .col-daiko { text-align: center; }
.jommu-main .t-center { text-align: center; }
.jommu-footer {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0;
  border: 2px solid #000;
  border-top: 1px solid #000;
}
.jommu-footer td, .jommu-footer th {
  border: 1px solid #000;
  padding: 4px 3px;
  font-size: 9pt;
  text-align: center;
  vertical-align: middle;
}
.jommu-footer .vm {
  background: #f4e3d0;
  font-weight: bold;
  width: 2.2em;
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 0.12em;
  padding: 6px 2px;
}
.jommu-footer .fh { background: #f4e3d0; font-weight: bold; }
.jommu-footer .fd { text-align: right; min-height: 1.5em; }
.jommu-formno {
  text-align: right;
  font-size: 9pt;
  margin-top: 4px;
  padding-right: 2px;
}
`;

function renderJommuTripRows(model: JommuKirokuboModel): string {
  const rowCount = Math.max(10, model.trips.length);
  const partner = esc(model.partnerCrewName);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const t = model.trips[i];
    rows.push(`<tr>
  <td class="c-no">${i + 1}</td>
  <td>${t ? esc(t.clientName) : ""}</td>
  <td>${t ? esc(t.charterVehicleNo) : ""}</td>
  <td>${t ? esc(t.origin) : ""}</td>
  <td class="t-center">${t ? esc(t.departedHm) : ""}</td>
  <td>${t ? esc(t.viaText) : ""}</td>
  <td>${t ? esc(t.destination) : ""}</td>
  <td class="t-center">${t ? esc(t.arrivedHm) : ""}</td>
  <td class="c-num">${t ? esc(t.distanceKm) : ""}</td>
  <td class="c-num">${t ? esc(t.fareYen) : ""}</td>
  <td class="col-daiko">代行</td>
  <td>${partner}</td>
</tr>`);
  }
  return rows.join("\n");
}

function renderJommuSheet(model: JommuKirokuboModel): string {
  const { yParts } = model;
  const rows = renderJommuTripRows(model);
  const lic = esc(model.licenseSerialNo);
  const office = esc(model.officeName);
  const crew = esc(model.crewName);
  const safety = esc(model.safetyManagerStampName);

  return `<div class="jommu-sheet">
<div class="jommu-retention">〈保存期間：最後に記載した日から3年間〉</div>
<h1 class="jommu-title">乗務記録簿</h1>

<table class="jommu-meta">
  <colgroup><col style="width:6.5em"/><col style="width:47%"/><col style="width:47%"/></colgroup>
  <tr>
    <td class="lbl" rowspan="5">乗務員<br/>氏名</td>
    <td colspan="2" class="val crew">${crew}</td>
  </tr>
  <tr>
    <td class="hdr">乗務年月日</td>
    <td class="hdr">事業所名</td>
  </tr>
  <tr>
    <td class="val t-center">${esc(yParts.y)}　年　${esc(yParts.m)}　月　${esc(yParts.d)}　日</td>
    <td class="val office" rowspan="3">${office}<div class="safety"><span class="safety-inkan">印</span>　<strong>安全運転</strong><br/><strong>管理者</strong><br/><span style="font-weight:normal">${safety}</span></div></td>
  </tr>
  <tr>
    <td class="val"><div class="hdr-i">免許証　通し番号</div>${lic}</td>
  </tr>
  <tr>
    <td class="val time"><strong>始業</strong>　${timeCells(model.clockInHm)}　　<strong>終業</strong>　${timeCells(model.clockOutHm)}</td>
  </tr>
</table>

<table class="jommu-main">
  <thead>
    <tr>
      <th class="c-no">No.</th>
      <th>依頼者</th>
      <th>客車の<br/>車両番号</th>
      <th>出庫場所</th>
      <th>開始<br/>時刻</th>
      <th>経由地</th>
      <th>到着場所</th>
      <th>到着<br/>時刻</th>
      <th>走行距離<br/><span class="u">（km）</span></th>
      <th>料金<br/><span class="u">（円）</span></th>
      <th>運転した<br/>車両</th>
      <th>同伴<br/>従事者氏名</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>

<table class="jommu-footer">
  <tr>
    <th class="vm" rowspan="2">メーター・距離等</th>
    <th class="fh">始業時<br/><span class="u">（km）</span></th>
    <th class="fh">終業時<br/><span class="u">（km）</span></th>
    <th class="fh">走行距離合計<br/><span class="u">（km）</span></th>
    <th class="fh">実車走行距離<br/><span class="u">（km）</span></th>
    <th class="fh">売上合計<br/><span class="u">（円）</span></th>
  </tr>
  <tr>
    <td class="fd">${model.odoStartKm != null ? esc(model.odoStartKm) : ""}</td>
    <td class="fd">${model.odoEndKm != null ? esc(model.odoEndKm) : ""}</td>
    <td class="fd">${model.totalOdoKm != null ? esc(model.totalOdoKm) : ""}</td>
    <td class="fd">${esc(model.actualDistanceKmSum)}</td>
    <td class="fd">${esc(model.salesTotalYen)}</td>
  </tr>
</table>
<div class="jommu-formno">日　0000-0000</div>
</div>`;
}

/** 複数日報分を 1 つの HTML にまとめる（各日報が 1 枚の用紙相当）。 */
export function buildJommuKirokuboHtmlBundle(models: JommuKirokuboModel[], documentTitle: string): string {
  if (models.length === 0) {
    return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<title>${esc(documentTitle)}</title>
<style>${PRINT_CSS}</style>
</head><body>
<div class="toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
<p style="padding:8px">条件に一致する日報がありません。</p>
<p class="no-print" style="text-align:center;font-size:10px;color:#444">ブラウザの印刷ダイアログから PDF 保存できます。</p>
</body></html>`;
  }

  const sheets = models.map(renderJommuSheet).join("\n");
  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<title>${esc(documentTitle)}</title>
<style>${PRINT_CSS}</style>
</head><body>
<div class="toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${sheets}
<p class="no-print" style="text-align:center;font-size:10px;color:#444;margin-top:8px">ブラウザの印刷ダイアログから PDF 保存できます。</p>
</body></html>`;
}

export function buildJommuKirokuboHtml(model: JommuKirokuboModel): string {
  return buildJommuKirokuboHtmlBundle([model], `乗務記録簿 ${model.businessDateYmd}`);
}
