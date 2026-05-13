/** 乗務記録簿（印刷用 HTML）。A4 横向き・業務様式に沿った枠付きレイアウト。 */

import { PRINT_BUSINESS_BASE_CSS } from "./print-business-theme.js";

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
  /** 苦情・意見等備考（任意） */
  remarks: string;
};

export type JommuKirokuboModel = {
  businessDateYmd: string;
  yParts: { y: string; m: string; d: string };
  /** 受託者（運転者）氏名 */
  crewName: string;
  clockInHm: string | null;
  clockOutHm: string | null;
  /** 事業所名 */
  officeName: string;
  /** 自社車（随伴車）登録番号 */
  companyCarRegNo: string;
  /** 安全運転管理者（設定の法定情報） */
  safetyManagerName: string;
  trips: JommuTripRow[];
  odoStartKm: string | null;
  odoEndKm: string | null;
  totalOdoKm: string | null;
  actualDistanceKmSum: string;
  salesTotalYen: string;
};

function splitHm(hm: string | null): { h: string; m: string } {
  if (!hm || !String(hm).trim()) return { h: "", m: "" };
  const p = String(hm).trim().split(":");
  const h = (p[0] ?? "").trim();
  const m = (p[1] ?? "").trim().slice(0, 2);
  return { h, m };
}

function timeCells(hm: string | null): string {
  const { h, m } = splitHm(hm);
  const hb = h ? esc(h) : '<span class="jm-blank">　　</span>';
  const mb = m ? esc(m) : '<span class="jm-blank">　　</span>';
  return `<span class="jm-time-pair">${hb}<span class="jm-colon">：</span>${mb}</span>`;
}

function timeCellsInline(hm: string): string {
  return timeCells(hm.trim() ? hm : null);
}

const JOMMU_CSS = `${PRINT_BUSINESS_BASE_CSS}
@page { size: A4 landscape; margin: 8mm 10mm; }
.jm-doc {
  width: 277mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 2mm 0 0;
  color: var(--pd-ink);
  font-size: 8.5pt;
}
.jm-doc .jm-topline {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1mm;
}
.jm-doc .jm-retention {
  margin: 0;
  font-size: 7.5pt;
  color: var(--pd-muted);
  letter-spacing: 0.02em;
}
.jm-doc .jm-title {
  margin: 0 0 2mm;
  text-align: center;
  font-size: 16pt;
  font-weight: 700;
  letter-spacing: 0.35em;
  text-indent: 0.35em;
  color: var(--pd-ink);
}
.jm-doc table.jm-tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1.5px solid var(--pd-line-strong);
  margin: 0 0 2mm;
  background: var(--pd-paper);
}
.jm-doc .jm-tbl th,
.jm-doc .jm-tbl td {
  border: 1px solid var(--pd-line-strong);
  padding: 2px 4px;
  vertical-align: middle;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.jm-doc .jm-lbl {
  background: var(--pd-fill-label);
  font-weight: 600;
  text-align: center;
  color: var(--pd-ink);
  font-size: 8pt;
  line-height: 1.25;
}
.jm-doc .jm-val {
  background: #fff;
  min-height: 1.35em;
  color: var(--pd-ink);
}
.jm-doc .jm-meta-outer { margin-bottom: 2mm; }
.jm-doc .jm-meta-outer > tbody > tr > td {
  border: 1.5px solid var(--pd-line-strong);
  padding: 0;
  vertical-align: top;
  width: 33.33%;
}
.jm-doc .jm-box-inner {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.jm-doc .jm-box-inner td {
  border: 1px solid var(--pd-line-strong);
}
.jm-doc .jm-crew-line {
  font-size: 10pt;
  font-weight: 700;
  padding: 4px 6px !important;
}
.jm-doc .jm-sub2 {
  display: table;
  width: 100%;
  table-layout: fixed;
}
.jm-doc .jm-sub2 > div {
  display: table-cell;
  width: 50%;
  padding: 3px 4px;
  vertical-align: middle;
  font-size: 8pt;
}
.jm-doc .jm-sub2 > div:first-child {
  border-right: 1px solid var(--pd-line-strong);
}
.jm-doc .jm-ymd {
  text-align: center;
  font-variant-numeric: tabular-nums;
  padding: 4px !important;
  font-size: 9pt;
}
.jm-doc .jm-plate {
  padding: 4px 6px !important;
  font-size: 9pt;
}
.jm-doc .jm-office-block {
  padding: 4px 6px !important;
  min-height: 2.6em;
  font-size: 9pt;
}
.jm-doc .jm-mgr-inner {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.jm-doc .jm-mgr-inner td {
  border: 1px solid var(--pd-line-strong);
}
.jm-doc .jm-mgr-inner .jm-mgr-lbl {
  width: 38%;
}
.jm-doc .jm-mgr-inner .jm-mgr-val {
  padding: 3px 4px !important;
  font-size: 9pt;
}
.jm-doc .jm-in {
  width: 2.2rem;
  text-align: center;
  font-size: 7.5pt;
  font-weight: 700;
  background: var(--pd-fill-label);
  vertical-align: middle !important;
}
.jm-doc .jm-section-h {
  background: var(--pd-fill-label);
  font-weight: 700;
  text-align: center;
  font-size: 8.5pt;
  padding: 3px !important;
  letter-spacing: 0.15em;
}
.jm-doc .jm-work thead th {
  background: var(--pd-fill-label);
  font-weight: 600;
  text-align: center;
  font-size: 7.6pt;
  line-height: 1.25;
  padding: 4px 3px !important;
  color: var(--pd-ink);
}
.jm-doc .jm-work tbody td {
  font-size: 7.6pt;
  padding: 3px 4px !important;
  min-height: 1.45rem;
  vertical-align: middle;
}
.jm-doc .jm-no {
  width: 1.6em;
  text-align: center;
  font-weight: 600;
  color: var(--pd-muted);
  font-variant-numeric: tabular-nums;
  background: #fafafa;
}
.jm-doc .jm-c {
  text-align: center;
}
.jm-doc .jm-r {
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding: 2px 5px !important;
  white-space: nowrap;
  overflow-wrap: normal;
  word-break: normal;
}
.jm-doc .jm-unit {
  display: inline;
  font-size: 6.5pt;
  font-weight: 600;
  color: var(--pd-muted);
  margin-left: 3px;
}
.jm-doc .jm-daiko {
  text-align: center;
  font-weight: 600;
  font-size: 7.5pt;
}
.jm-doc .jm-foot-v {
  writing-mode: vertical-rl;
  text-orientation: upright;
  width: 2.6rem;
  min-width: 2.5rem;
  max-width: 2.75rem;
  letter-spacing: 0.06em;
  padding: 6px 4px !important;
  font-size: 7.8pt;
  line-height: 1.35;
}
.jm-doc .jm-foot thead th {
  background: var(--pd-fill-label);
  font-weight: 600;
  text-align: center;
  font-size: 7.6pt;
  padding: 5px 4px !important;
  line-height: 1.25;
}
.jm-doc .jm-foot tbody td {
  font-size: 9.5pt;
  font-weight: 600;
  text-align: right;
  padding: 6px 8px !important;
  font-variant-numeric: tabular-nums;
  min-width: 3.2rem;
  vertical-align: middle;
  overflow-wrap: normal;
  word-break: normal;
}
.jm-doc .jm-footnote {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  margin-top: 1mm;
  font-size: 7.5pt;
  color: var(--pd-muted);
}
.jm-doc .jm-fn-box {
  border: 1px solid var(--pd-line-strong);
  padding: 1px 8px;
  min-width: 2.2em;
  text-align: center;
  font-size: 8pt;
}
.jm-blank { letter-spacing: 0.06em; }
.jm-colon { padding: 0 1px; }
.jm-time-pair { white-space: nowrap; }
`;

function renderJommuTripRows(model: JommuKirokuboModel): string {
  const rowCount = Math.max(10, model.trips.length);
  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const t = model.trips[i];
    rows.push(`<tr>
  <td class="jm-no">${i + 1}</td>
  <td class="jm-val">${t ? esc(t.clientName) : ""}</td>
  <td class="jm-val">${t ? esc(t.charterVehicleNo) : ""}</td>
  <td class="jm-val">${t ? esc(t.origin) : ""}</td>
  <td class="jm-val jm-c">${t ? timeCellsInline(t.departedHm) : ""}</td>
  <td class="jm-val">${t ? esc(t.viaText) : ""}</td>
  <td class="jm-val">${t ? esc(t.destination) : ""}</td>
  <td class="jm-val jm-c">${t ? timeCellsInline(t.arrivedHm) : ""}</td>
  <td class="jm-val jm-r">${t && String(t.distanceKm).trim() ? `${esc(t.distanceKm)}<span class="jm-unit">km</span>` : `<span class="jm-unit">km</span>`}</td>
  <td class="jm-val jm-r">${t && String(t.fareYen).trim() ? `${esc(t.fareYen)}<span class="jm-unit">円</span>` : `<span class="jm-unit">円</span>`}</td>
  <td class="jm-val jm-daiko">代行</td>
  <td class="jm-val">${t ? esc(t.remarks) : ""}</td>
</tr>`);
  }
  return rows.join("\n");
}

function renderHeaderMeta(model: JommuKirokuboModel): string {
  const { yParts } = model;
  const crew = esc(model.crewName);
  const office = esc(model.officeName);
  const plate = esc(model.companyCarRegNo);
  const mgr = esc(model.safetyManagerName);

  return `<table class="jm-tbl jm-meta-outer" role="presentation">
<tbody><tr>
  <td>
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">受託者氏名</td></tr>
      <tr><td class="jm-val jm-crew-line">${crew}</td></tr>
      <tr><td class="jm-sub2"><div>始業時刻　${timeCells(model.clockInHm)}</div><div>終業時刻　${timeCells(model.clockOutHm)}</div></td></tr>
    </table>
  </td>
  <td>
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">乗務年月日</td></tr>
      <tr><td class="jm-val jm-ymd">${esc(yParts.y)}　年　${esc(yParts.m)}　月　${esc(yParts.d)}　日</td></tr>
      <tr><td class="jm-lbl">自社車　登録番号</td></tr>
      <tr><td class="jm-val jm-plate">${plate}</td></tr>
    </table>
  </td>
  <td>
    <table class="jm-box-inner">
      <tr><td class="jm-lbl">事業所名</td></tr>
      <tr><td class="jm-val jm-office-block">${office}</td></tr>
      <tr><td style="padding:0;border:none">
        <table class="jm-mgr-inner" role="presentation"><tr>
        <td class="jm-lbl jm-mgr-lbl">安全運転<br/>管理者</td>
        <td class="jm-val jm-mgr-val">${mgr}</td>
        <td class="jm-in">印</td>
        </tr></table>
      </td></tr>
    </table>
  </td>
</tr></tbody>
</table>`;
}

function renderJommuSheet(model: JommuKirokuboModel): string {
  const tripBody = renderJommuTripRows(model);

  return `<article class="pd-doc jm-doc">
<div class="jm-topline"><p class="jm-retention">〈保存期間：最後に記載した日から1年間〉</p></div>
<h1 class="jm-title">乗務記録簿</h1>
${renderHeaderMeta(model)}
<table class="jm-tbl jm-work">
  <colgroup>
    <col style="width:3%" />
    <col style="width:8.5%" />
    <col style="width:7.5%" />
    <col style="width:8.5%" />
    <col style="width:7%" />
    <col style="width:7.5%" />
    <col style="width:8.5%" />
    <col style="width:7%" />
    <col style="width:9%" />
    <col style="width:9%" />
    <col style="width:5.5%" />
    <col style="width:19%" />
  </colgroup>
  <thead>
    <tr><th class="jm-section-h" colspan="12">業務記録</th></tr>
    <tr>
      <th>　</th>
      <th>依頼者</th>
      <th>客車の<br/>車両番号</th>
      <th>依頼場所</th>
      <th>開始時刻</th>
      <th>経由地</th>
      <th>到着場所</th>
      <th>到着時刻</th>
      <th>走行距離</th>
      <th>料金</th>
      <th>同乗した<br/>車両</th>
      <th>苦情　意見等備考</th>
    </tr>
  </thead>
  <tbody>
${tripBody}
  </tbody>
</table>
<table class="jm-tbl jm-foot">
  <colgroup>
    <col style="width:11%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
    <col style="width:17.8%" />
  </colgroup>
  <thead>
    <tr>
      <th class="jm-lbl jm-foot-v" rowspan="2">メーター・距離等</th>
      <th>始業時<br/><span style="font-size:6.5pt;font-weight:500">（km）</span></th>
      <th>終業時<br/><span style="font-size:6.5pt;font-weight:500">（km）</span></th>
      <th>走行距離合計<br/><span style="font-size:6.5pt;font-weight:500">（km）</span></th>
      <th>実車走行距離<br/><span style="font-size:6.5pt;font-weight:500">（km）</span></th>
      <th>売上合計<br/><span style="font-size:6.5pt;font-weight:500">（円）</span></th>
    </tr>
  </thead>
  <tbody>
  <tr>
    <td>${model.odoStartKm != null ? esc(model.odoStartKm) : ""}</td>
    <td>${model.odoEndKm != null ? esc(model.odoEndKm) : ""}</td>
    <td>${model.totalOdoKm != null ? esc(model.totalOdoKm) : ""}</td>
    <td>${esc(model.actualDistanceKmSum)}</td>
    <td>${esc(model.salesTotalYen)}</td>
  </tr>
  </tbody>
</table>
<div class="jm-footnote">
  <span>様式番号　0000-0000</span>
  <span class="jm-fn-box">日</span>
</div>
</article>`;
}

function wrapHtml(title: string, innerBody: string): string {
  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>${JOMMU_CSS}</style>
</head><body class="pd-body">
${innerBody}
</body></html>`;
}

export function buildJommuKirokuboHtmlBundle(models: JommuKirokuboModel[], documentTitle: string): string {
  if (models.length === 0) {
    return wrapHtml(
      documentTitle,
      `<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
<p style="padding:12px 16px;margin:0 auto;max-width:277mm">条件に一致する日報がありません。</p>
<p class="pd-hint no-print">ブラウザの印刷ダイアログから PDF 保存できます。</p>`,
    );
  }

  const sheets = models.map(renderJommuSheet).join("\n");
  return wrapHtml(
    documentTitle,
    `<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${sheets}
<p class="pd-hint no-print">ブラウザの印刷ダイアログから PDF 保存できます。</p>`,
  );
}

export function buildJommuKirokuboHtml(model: JommuKirokuboModel): string {
  return buildJommuKirokuboHtmlBundle([model], `乗務記録簿 ${model.businessDateYmd}`);
}
