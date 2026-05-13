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
  /** 事業所名（帳票表記。法定事業者名を使用） */
  officeName: string;
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
@page { size: A4 portrait; margin: 8mm 10mm; }
@media print {
  .no-print { display: none !important; }
  body {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    background: #fff !important;
    padding: 0 !important;
  }
  .jommu-sheet {
    box-shadow: none !important;
    border-radius: 0 !important;
    border-color: #cbd5e1 !important;
  }
}
@media screen {
  body {
    background: linear-gradient(165deg, #f1f5f9 0%, #e2e8f0 50%, #f8fafc 100%);
    min-height: 100vh;
    padding: 14px 16px 24px;
  }
}
body {
  font-family: "MS PMincho","ＭＳ Ｐ明朝","MS P Gothic","MS PGothic","Yu Mincho","Yu Gothic","Meiryo",sans-serif;
  font-size: 10.5pt;
  color: #334155;
  margin: 0;
  box-sizing: border-box;
}
*, *::before, *::after { box-sizing: inherit; }
.toolbar { margin-bottom: 12px; }
.toolbar button {
  padding: 8px 18px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid #334155;
  border-radius: 4px;
  background: #1e293b;
  color: #f8fafc;
  box-shadow: 0 1px 2px rgba(15,23,42,.12);
}
.toolbar button:hover { background: #334155; }
.jommu-sheet {
  width: 100%;
  max-width: 186mm;
  margin: 0 auto 14px;
  page-break-after: always;
  break-after: page;
  padding: 10px 12px 12px;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(15,23,42,.06), 0 8px 24px rgba(15,23,42,.04);
}
.jommu-sheet:last-of-type { page-break-after: auto; break-after: auto; }
.jommu-retention {
  text-align: right;
  font-size: 8pt;
  margin-bottom: 4px;
  padding-right: 1px;
  color: #64748b;
  letter-spacing: 0.02em;
  line-height: 1.35;
}
.jommu-title {
  text-align: center;
  font-size: 15pt;
  font-weight: 600;
  margin: 0 0 10px;
  letter-spacing: 0.18em;
  text-indent: 0.18em;
  color: #0f172a;
  font-feature-settings: "palt";
  line-height: 1.25;
}
.jommu-meta {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-bottom: 0;
  border: 1px solid #64748b;
  border-bottom: none;
}
.jommu-meta td, .jommu-meta th {
  border: 1px solid #cbd5e1;
  padding: 8px 9px;
  vertical-align: middle;
  font-size: 9.5pt;
}
.jommu-meta .hdr {
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  font-weight: 600;
  text-align: center;
  color: #0f172a;
}
.jommu-meta .lbl {
  background: linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%);
  font-weight: 600;
  text-align: center;
  width: 7.5em;
  color: #1e293b;
  border-right-color: #94a3b8;
  vertical-align: middle;
  line-height: 1.45;
  padding: 8px 6px;
}
.jommu-meta .val { min-height: 2em; }
.jommu-meta .t-colon { padding: 0 2px; }
.jommu-meta .t-blank { letter-spacing: 0.1em; }
.jommu-meta .crew {
  font-size: 12pt;
  font-weight: 600;
  vertical-align: middle;
  line-height: 1.4;
  padding: 10px 10px;
  color: #0f172a;
}
.jommu-meta .office {
  font-size: 10.5pt;
  vertical-align: middle;
  line-height: 1.5;
  color: #0f172a;
  padding: 10px 10px;
}
.jommu-meta .time {
  font-size: 9.5pt;
  line-height: 1.55;
  padding: 9px 10px;
}
.jommu-meta .t-center { text-align: center; }
.jommu-main {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin-top: 0;
  border: 1px solid #64748b;
  border-top: 1px solid #94a3b8;
}
.jommu-main th, .jommu-main td {
  border: 1px solid #cbd5e1;
  padding: 5px 4px;
  vertical-align: middle;
  font-size: 8.5pt;
}
.jommu-main thead th {
  background: linear-gradient(180deg, #f8fafc 0%, #e8edf3 100%);
  font-weight: 600;
  text-align: center;
  line-height: 1.2;
  color: #0f172a;
  border-bottom-color: #94a3b8;
  padding: 7px 3px;
  vertical-align: middle;
  hyphens: none;
}
.jommu-main thead th .u-inline {
  font-size: 7pt;
  font-weight: 500;
  color: #64748b;
  white-space: nowrap;
}
.jommu-main thead th.th-compact { font-size: 7.8pt; padding: 6px 2px; }
.jommu-main .c-no { width: 2em; text-align: center; color: #64748b; font-weight: 600; }
.jommu-main .c-num { text-align: center; }
.jommu-main .u { font-size: 7pt; font-weight: normal; color: #64748b; }
.jommu-main tbody td { min-height: 1.4em; }
.jommu-main tbody tr:nth-child(even) td { background: #f8fafc; }
.jommu-main .col-daiko { text-align: center; font-weight: 600; color: #475569; }
.jommu-main .t-center { text-align: center; }
.jommu-main .num-with-unit { text-align: center; padding: 6px 5px; }
.jommu-main .nwu {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.15em;
  white-space: nowrap;
  max-width: 100%;
}
.jommu-main .nwu-val { font-variant-numeric: tabular-nums; }
.jommu-main .nwu-suf {
  font-size: 8pt;
  color: #64748b;
  font-weight: normal;
  flex-shrink: 0;
}
.jommu-footer {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0;
  border: 1px solid #64748b;
  border-top: 1px solid #94a3b8;
}
.jommu-footer td, .jommu-footer th {
  border: 1px solid #cbd5e1;
  padding: 8px 5px;
  font-size: 9pt;
  text-align: center;
  vertical-align: middle;
}
.jommu-footer .vm {
  background: linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%);
  font-weight: 600;
  width: 2.2em;
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 0.12em;
  padding: 8px 3px;
  color: #1e293b;
  border-right-color: #94a3b8;
}
.jommu-footer .fh {
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  font-weight: 600;
  color: #0f172a;
  line-height: 1.35;
  padding: 8px 4px;
  font-size: 8.5pt;
  white-space: normal;
  word-break: keep-all;
}
.jommu-footer .fh .u-inline {
  font-size: 7pt;
  font-weight: 500;
  color: #64748b;
  white-space: nowrap;
}
.jommu-footer .fd {
  text-align: center;
  min-height: 1.6em;
  padding: 9px 8px;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
}
.jommu-formno {
  text-align: right;
  font-size: 8.5pt;
  margin-top: 8px;
  padding-right: 2px;
  color: #94a3b8;
  letter-spacing: 0.06em;
}
`;

function renderJommuTripRows(model: JommuKirokuboModel): string {
  const rowCount = Math.max(10, model.trips.length);
  const partner = esc(model.partnerCrewName);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const t = model.trips[i];
    const dist = t ? esc(t.distanceKm) : "";
    const fare = t ? esc(t.fareYen) : "";
    const distSuf = t && String(t.distanceKm).trim() ? `<span class="nwu-suf">km</span>` : "";
    const fareSuf = t && String(t.fareYen).trim() ? `<span class="nwu-suf">円</span>` : "";
    rows.push(`<tr>
  <td class="c-no">${i + 1}</td>
  <td>${t ? esc(t.clientName) : ""}</td>
  <td>${t ? esc(t.charterVehicleNo) : ""}</td>
  <td>${t ? esc(t.origin) : ""}</td>
  <td class="t-center">${t ? esc(t.departedHm) : ""}</td>
  <td>${t ? esc(t.viaText) : ""}</td>
  <td>${t ? esc(t.destination) : ""}</td>
  <td class="t-center">${t ? esc(t.arrivedHm) : ""}</td>
  <td class="c-num num-with-unit"><span class="nwu"><span class="nwu-val">${dist}</span>${distSuf}</span></td>
  <td class="c-num num-with-unit"><span class="nwu"><span class="nwu-val">${fare}</span>${fareSuf}</span></td>
  <td class="col-daiko">代行</td>
  <td>${partner}</td>
</tr>`);
  }
  return rows.join("\n");
}

function renderJommuSheet(model: JommuKirokuboModel): string {
  const { yParts } = model;
  const rows = renderJommuTripRows(model);
  const office = esc(model.officeName);
  const crew = esc(model.crewName);

  return `<div class="jommu-sheet">
<div class="jommu-retention">〈保存期間：最後に記載した日から3年間〉</div>
<h1 class="jommu-title">乗務記録簿</h1>

<table class="jommu-meta">
  <colgroup><col style="width:6.5em"/><col style="width:47%"/><col style="width:47%"/></colgroup>
  <tr>
    <td class="lbl" rowspan="4">乗務員<br/>氏名</td>
    <td colspan="2" class="val crew">${crew}</td>
  </tr>
  <tr>
    <td class="hdr">乗務年月日</td>
    <td class="hdr">事業所名</td>
  </tr>
  <tr>
    <td class="val t-center">${esc(yParts.y)}　年　${esc(yParts.m)}　月　${esc(yParts.d)}　日</td>
    <td class="val office" rowspan="2">${office}</td>
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
      <th class="th-compact">客車の車両番号</th>
      <th>出庫場所</th>
      <th>開始時刻</th>
      <th>経由地</th>
      <th>到着場所</th>
      <th>到着時刻</th>
      <th>走行距離<span class="u-inline">（km）</span></th>
      <th>料金<span class="u-inline">（円）</span></th>
      <th class="th-compact">運転した車両</th>
      <th class="th-compact">同伴従事者氏名</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>

<table class="jommu-footer">
  <tr>
    <th class="vm" rowspan="2">メーター・距離等</th>
    <th class="fh">始業時<span class="u-inline">（km）</span></th>
    <th class="fh">終業時<span class="u-inline">（km）</span></th>
    <th class="fh">走行距離合計<span class="u-inline">（km）</span></th>
    <th class="fh">実車走行距離<span class="u-inline">（km）</span></th>
    <th class="fh">売上合計<span class="u-inline">（円）</span></th>
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
