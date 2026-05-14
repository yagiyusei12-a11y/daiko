/**
 * 乗務記録簿: templates/jommu-print（背景 SVG + セマンティックな HTML）から PDF 用ドキュメントを組み立てる。
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { JommuKirokuboModel } from "./jommu-types.js";

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "jommu-print");

let cachedBaseHtml: string | null = null;
let cachedFontFaceBlock: string | null = null;
let cachedBgDataUrl: string | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayClockIn(m: JommuKirokuboModel): string | null {
  if (m.clockInHm?.trim()) return m.clockInHm;
  const first = m.trips[0]?.departedHm?.trim();
  return first || null;
}

function displayClockOut(m: JommuKirokuboModel): string | null {
  if (m.clockOutHm?.trim()) return m.clockOutHm;
  const last = m.trips.length ? m.trips[m.trips.length - 1]?.arrivedHm?.trim() : "";
  return last || null;
}

function td(text: string, ...classes: string[]): string {
  const cls = classes.filter(Boolean).join(" ");
  const attr = cls ? ` class="${cls}"` : "";
  const body = text ? escapeHtml(text) : "";
  return `<td${attr}>${body}</td>`;
}

function tripRow(model: JommuKirokuboModel, index: number): string {
  const trip = model.trips[index];
  const companion =
    trip && model.accompanyingCrewName.trim() ? model.accompanyingCrewName.trim() : "";
  if (!trip) {
    return `<tr>
      <td class="idx jmu-c">${index + 1}</td>
      ${td("")}
      ${td("")}
      ${td("")}
      ${td("", "jmu-c")}
      ${td("")}
      ${td("")}
      ${td("", "jmu-c")}
      ${td("", "jmu-c")}
      ${td("", "jmu-r")}
      ${td("", "jmu-r")}
      ${td("")}
      ${td("")}
    </tr>`;
  }
  return `<tr>
    <td class="idx jmu-c">${index + 1}</td>
    ${td(trip.clientName)}
    ${td(trip.charterVehicleNo)}
    ${td(trip.origin)}
    ${td(trip.departedHm, "jmu-c")}
    ${td(trip.viaText)}
    ${td(trip.destination)}
    ${td(trip.arrivedHm, "jmu-c")}
    ${td(trip.distanceKm ? `${trip.distanceKm}km` : "", "jmu-c")}
    ${td(trip.fareYen ? `${trip.fareYen}円` : "", "jmu-r")}
    ${td(trip.charterVehicleNo)}
    ${td(companion)}
  </tr>`;
}

function buildJommuMainHtml(m: JommuKirokuboModel): string {
  const y = m.yParts.y;
  const mo = m.yParts.m.replace(/^0+/, "") || m.yParts.m;
  const d = m.yParts.d.replace(/^0+/, "") || m.yParts.d;
  const cin = displayClockIn(m);
  const cout = displayClockOut(m);
  const cinDisp = cin ? escapeHtml(cin) : "";
  const coutDisp = cout ? escapeHtml(cout) : "";

  const rows: string[] = [];
  for (let i = 0; i < 10; i++) rows.push(tripRow(m, i));

  const o1 = m.odoStartKm?.trim() ?? "";
  const o2 = m.odoEndKm?.trim() ?? "";
  const o3 = m.totalOdoKm?.trim() ?? "";
  const o4 = m.actualDistanceKmSum.trim();
  const u = (s: string) => (s ? `${escapeHtml(s)}㎞` : "—");

  return `
<div class="jmu-title">乗 務 記 録 簿</div>
<div class="jmu-kigen">＜保存期間：最後に記載した日から２年間＞</div>
<div class="jmu-meta">
  <div style="display:flex;flex-wrap:wrap;gap:10px 28px;align-items:baseline;">
    <div style="display:flex;gap:8px;align-items:baseline;">
      <label>乗務員氏名</label>
      <span>${escapeHtml(m.crewName)}</span>
    </div>
    <div style="display:flex;gap:4px;align-items:baseline;">
      <label>業務年月日</label>
      <span>${escapeHtml(y)}</span><span>年</span>
      <span>${escapeHtml(mo)}</span><span>月</span>
      <span>${escapeHtml(d)}</span><span>日</span>
    </div>
    <div style="display:flex;gap:8px;align-items:baseline;min-width:12em;">
      <label>事業者名</label>
      <span>${escapeHtml(m.operatorName)}</span>
    </div>
  </div>
  <div class="jmu-meta-row2">
    <label>随伴車</label>
    <div class="v">${escapeHtml(m.escortVehicleLabel)}</div>
    <label>登録番号</label>
    <div class="v">${escapeHtml(m.escortVehiclePlate)}</div>
    <label>安全運転管理者名</label>
    <div class="v">${escapeHtml(m.safetyManagerName)}</div>
  </div>
  <div class="jmu-clock-row">
    <span><strong>始業時刻</strong>　${cinDisp}</span>
    <span><strong>終業時刻</strong>　${coutDisp}</span>
  </div>
</div>
<div class="jmu-tbl-wrap">
  <table class="jmu-tbl">
    <colgroup>
      <col style="width:36px" />
      <col style="width:118px" />
      <col style="width:162px" />
      <col style="width:102px" />
      <col style="width:96px" />
      <col style="width:124px" />
      <col style="width:110px" />
      <col style="width:76px" />
      <col style="width:80px" />
      <col style="width:88px" />
      <col style="width:86px" />
      <col style="width:128px" />
    </colgroup>
    <thead>
      <tr>
        <th></th>
        <th>依頼者</th>
        <th>客車の<br/>車両番号</th>
        <th>依頼場所</th>
        <th>開始時刻</th>
        <th>経由地</th>
        <th>到着場所</th>
        <th>到着時刻</th>
        <th>走行距離</th>
        <th>料金</th>
        <th>運転した<br/>車両</th>
        <th>同伴<br/>乗務員名</th>
      </tr>
    </thead>
    <tbody>
      ${rows.join("\n")}
    </tbody>
  </table>
</div>
<div class="jmu-foot">
  <span class="lab"><strong>メーター距離等</strong></span>
  <span class="lab">始業時</span><span class="val">${u(o1)}</span>
  <span class="lab">終業時</span><span class="val">${u(o2)}</span>
  <span class="lab">走行距離合計</span><span class="val">${u(o3)}</span>
  <span class="lab">実車走行距離</span><span class="val">${u(o4)}</span>
  <span class="lab">売上合計</span><span class="val">${escapeHtml(m.salesTotalYen)}円</span>
</div>
`.trim();
}

async function loadBaseHtml(): Promise<string> {
  if (cachedBaseHtml) return cachedBaseHtml;
  const p = path.join(TEMPLATE_DIR, "sheet.html");
  if (!existsSync(p)) {
    throw new Error(`乗務記録簿テンプレが見つかりません: ${p}（cwd=${process.cwd()}）`);
  }
  cachedBaseHtml = await fs.readFile(p, "utf8");
  return cachedBaseHtml;
}

async function loadFontFaceBlock(): Promise<string> {
  if (cachedFontFaceBlock) return cachedFontFaceBlock;
  const fonts: { file: string; family: string }[] = [
    { file: "DejaVuSerif_69.woff", family: "DejaVuSerif_69" },
    { file: "NotoSansCJKjp-Regular_64.woff", family: "NotoSansCJKjp-Regular_64" },
    { file: "NotoSansCJKjp-Regular_64_1.woff", family: "NotoSansCJKjp-Regular_64_1" },
  ];
  const parts: string[] = [];
  for (const { file, family } of fonts) {
    const fp = path.join(TEMPLATE_DIR, "fonts", file);
    if (!existsSync(fp)) {
      throw new Error("jommu: 乗務記録簿テンプレのフォントが欠けています。再デプロイを試してください。");
    }
    const buf = await fs.readFile(fp);
    const url = `data:font/woff;base64,${buf.toString("base64")}`;
    parts.push(`@font-face{font-family:${family};src:url("${url}") format("woff");}`);
  }
  cachedFontFaceBlock = parts.join("\n");
  return cachedFontFaceBlock;
}

async function loadBgDataUrl(): Promise<string> {
  if (cachedBgDataUrl) return cachedBgDataUrl;
  const p = path.join(TEMPLATE_DIR, "bg.svg");
  if (!existsSync(p)) {
    throw new Error("jommu: 乗務記録簿テンプレの背景 SVG が欠けています。再デプロイを試してください。");
  }
  const svg = await fs.readFile(p, "utf8");
  cachedBgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return cachedBgDataUrl;
}

function injectPrintPageSize(html: string): string {
  const inj = "<style>@page{size:1286px 909px;margin:0;}</style>";
  if (html.includes("</head>")) return html.replace("</head>", `${inj}</head>`);
  return `${inj}${html}`;
}

/**
 * Puppeteer でそのまま setContent できる完全 HTML（1286×909 の 1 ページ）。
 */
export async function buildJommuKirokuboSheetHtml(model: JommuKirokuboModel): Promise<string> {
  const [base, fontFace, bg] = await Promise.all([loadBaseHtml(), loadFontFaceBlock(), loadBgDataUrl()]);
  let html = base
    .replace("__JOMMU_FONT_FACE__", fontFace)
    .replace("__JOMMU_BG__", bg)
    .replace("__JOMMU_MAIN__", buildJommuMainHtml(model));
  if (html.includes("__JOMMU")) {
    throw new Error("jommu: テンプレの埋め込みが不完全です（プレースホルダが残りました）");
  }
  return injectPrintPageSize(html);
}
