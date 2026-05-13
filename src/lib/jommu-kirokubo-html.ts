/** 乗務記録簿（印刷用 HTML）。日報データを法定様式に近いレイアウトで出力。 */

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
};

export type JommuKirokuboModel = {
  businessDateYmd: string;
  yParts: { y: string; m: string; d: string };
  crewName: string;
  clockInHm: string | null;
  clockOutHm: string | null;
  officeName: string;
  partnerCrewName: string;
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
  return `${hb}<span class="jm-colon">：</span>${mb}`;
}

const JOMMU_CSS = `${PRINT_BUSINESS_BASE_CSS}
.jm-doc .jm-meta { margin-top: 0; border-top: 2px solid var(--pd-accent); }
.jm-doc .jm-meta td { font-size: 9.5pt; }
.jm-doc .jm-crew-name {
  font-size: 12pt;
  font-weight: 700;
  color: var(--pd-ink);
  padding: 12px 14px;
  letter-spacing: 0.02em;
}
.jm-doc .jm-subhdr {
  background: var(--pd-fill);
  font-weight: 600;
  text-align: center;
  font-size: 9pt;
  color: var(--pd-ink);
  padding: 8px 10px;
}
.jm-doc .jm-date-val {
  text-align: center;
  font-size: 10pt;
  color: var(--pd-ink);
  font-variant-numeric: tabular-nums;
  padding: 9px 10px;
}
.jm-doc .jm-office {
  font-size: 10pt;
  color: var(--pd-ink);
  line-height: 1.5;
  padding: 10px 12px;
  vertical-align: middle;
}
.jm-doc .jm-time-row {
  font-size: 9.5pt;
  color: var(--pd-ink);
  padding: 9px 12px;
  line-height: 1.55;
}
.jm-blank { letter-spacing: 0.08em; }
.jm-colon { padding: 0 1px; }
.jm-trips { margin-top: -1px; border-top: none; }
.jm-trips thead th { font-size: 8.1pt; padding: 7px 3px; }
.jm-trips tbody td {
  font-size: 8.5pt;
  padding: 5px 5px;
  vertical-align: middle;
}
.jm-trips tbody tr:nth-child(even) td { background: #fafbfc; }
.jm-trips .jm-no {
  width: 1.85em;
  text-align: center;
  font-weight: 600;
  color: var(--pd-muted);
  font-variant-numeric: tabular-nums;
}
.jm-trips .jm-daiko {
  text-align: center;
  font-weight: 600;
  font-size: 8.5pt;
  color: var(--pd-muted);
}
.jm-trips .jm-numcell { text-align: right; font-variant-numeric: tabular-nums; padding-right: 8px; }
.jm-trips .jm-numcell .jm-suf {
  margin-left: 0.2em;
  font-size: 8pt;
  font-weight: 500;
  color: var(--pd-muted);
}
.jm-foot { margin-top: -1px; border-top: none; }
.jm-foot thead th { font-size: 8.2pt; padding: 8px 4px; line-height: 1.35; }
.jm-foot tbody td {
  font-size: 10pt;
  font-weight: 600;
  padding: 10px 8px;
  color: var(--pd-ink);
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
    const distSuf = t && String(t.distanceKm).trim() ? `<span class="jm-suf">km</span>` : "";
    const fareSuf = t && String(t.fareYen).trim() ? `<span class="jm-suf">円</span>` : "";
    rows.push(`<tr>
  <td class="jm-no">${i + 1}</td>
  <td>${t ? esc(t.clientName) : ""}</td>
  <td>${t ? esc(t.charterVehicleNo) : ""}</td>
  <td>${t ? esc(t.origin) : ""}</td>
  <td class="pd-center">${t ? esc(t.departedHm) : ""}</td>
  <td>${t ? esc(t.viaText) : ""}</td>
  <td>${t ? esc(t.destination) : ""}</td>
  <td class="pd-center">${t ? esc(t.arrivedHm) : ""}</td>
  <td class="jm-numcell">${dist}${distSuf}</td>
  <td class="jm-numcell">${fare}${fareSuf}</td>
  <td class="jm-daiko">代行</td>
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

  return `<article class="pd-doc jm-doc">
<header class="pd-doc-head">
  <p class="pd-retention">〈保存期間：最後に記載した日から3年間〉</p>
</header>
<div class="pd-title-wrap">
  <h1 class="pd-title">乗務記録簿</h1>
  <div class="pd-title-rule" aria-hidden="true"></div>
</div>

<table class="pd-table jm-meta">
  <colgroup><col style="width:6.25rem"/><col style="width:50%"/><col style="width:50%"/></colgroup>
  <tbody>
  <tr>
    <td class="pd-label-cell" rowspan="4">乗務員<br/>氏名</td>
    <td colspan="2" class="jm-crew-name">${crew}</td>
  </tr>
  <tr>
    <td class="jm-subhdr">乗務年月日</td>
    <td class="jm-subhdr">事業所名</td>
  </tr>
  <tr>
    <td class="jm-date-val">${esc(yParts.y)}　年　${esc(yParts.m)}　月　${esc(yParts.d)}　日</td>
    <td class="jm-office" rowspan="2">${office}</td>
  </tr>
  <tr>
    <td class="jm-time-row"><strong>始業</strong>　${timeCells(model.clockInHm)}　　<strong>終業</strong>　${timeCells(model.clockOutHm)}</td>
  </tr>
  </tbody>
</table>

<table class="pd-table jm-trips">
  <colgroup>
    <col style="width:2.2%"/><col style="width:9%"/><col style="width:8%"/><col style="width:9%"/><col style="width:6%"/>
    <col style="width:8%"/><col style="width:9%"/><col style="width:6%"/><col style="width:7.5%"/><col style="width:8%"/>
    <col style="width:5.5%"/><col style="width:12%"/>
  </colgroup>
  <thead>
    <tr>
      <th>No.</th>
      <th>依頼者</th>
      <th>客車の車両番号</th>
      <th>出庫場所</th>
      <th>開始時刻</th>
      <th>経由地</th>
      <th>到着場所</th>
      <th>到着時刻</th>
      <th>走行距離<span class="pd-unit">km</span></th>
      <th>料金<span class="pd-unit">円</span></th>
      <th>運転した車両</th>
      <th>同伴従事者氏名</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>

<table class="pd-table jm-foot">
  <thead>
    <tr>
      <th class="pd-label-cell pd-vertical" rowspan="2">メーター・距離等</th>
      <th>始業時<span class="pd-unit">km</span></th>
      <th>終業時<span class="pd-unit">km</span></th>
      <th>走行距離合計<span class="pd-unit">km</span></th>
      <th>実車走行距離<span class="pd-unit">km</span></th>
      <th>売上合計<span class="pd-unit">円</span></th>
    </tr>
  </thead>
  <tbody>
  <tr>
    <td class="pd-num">${model.odoStartKm != null ? esc(model.odoStartKm) : ""}</td>
    <td class="pd-num">${model.odoEndKm != null ? esc(model.odoEndKm) : ""}</td>
    <td class="pd-num">${model.totalOdoKm != null ? esc(model.totalOdoKm) : ""}</td>
    <td class="pd-num">${esc(model.actualDistanceKmSum)}</td>
    <td class="pd-num">${esc(model.salesTotalYen)}</td>
  </tr>
  </tbody>
</table>
<p class="pd-formno">様式番号　日　0000-0000</p>
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

/** 複数日報分を 1 つの HTML にまとめる（各日報が 1 枚の用紙相当）。 */
export function buildJommuKirokuboHtmlBundle(models: JommuKirokuboModel[], documentTitle: string): string {
  if (models.length === 0) {
    return wrapHtml(
      documentTitle,
      `<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
<p style="padding:12px 16px;margin:0 auto;max-width:190mm">条件に一致する日報がありません。</p>
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
