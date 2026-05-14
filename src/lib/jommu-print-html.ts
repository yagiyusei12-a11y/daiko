/**
 * 乗務記録簿: templates/jommu-print/record-book（セマンティック HTML + CSS）を埋めて PDF 用ドキュメントを組み立てる。
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { JommuKirokuboModel } from "./jommu-types.js";

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "jommu-print");

let cachedShellHtml: string | null = null;
let cachedRecordCss: string | null = null;
let cachedFontFaceBlock: string | null = null;

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/\r|\n/g, " ");
}

function roInput(value: string): string {
  return `<input type="text" class="field-input" readonly value="${escapeAttr(value)}" />`;
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

function tripRow(m: JommuKirokuboModel, index: number): string {
  const n = index + 1;
  const trip = m.trips[index];
  const companion =
    trip && m.accompanyingCrewName.trim() ? m.accompanyingCrewName.trim() : "";
  const empty = () =>
    `<tr><th scope="row">${n}</th>${Array.from({ length: 11 }, () => `<td>${roInput("")}</td>`).join("")}</tr>`;
  if (!trip) return empty();

  const driven = trip.charterVehicleNo.trim();
  const km = trip.distanceKm.trim() ? `${trip.distanceKm}km` : "";
  const yen = trip.fareYen.trim() ? `${trip.fareYen}円` : "";

  return `<tr>
    <th scope="row">${n}</th>
    <td>${roInput(trip.clientName)}</td>
    <td>${roInput(trip.charterVehicleNo)}</td>
    <td>${roInput(trip.origin)}</td>
    <td class="col-time">${roInput(trip.departedHm)}</td>
    <td>${roInput(trip.viaText)}</td>
    <td>${roInput(trip.destination)}</td>
    <td class="col-time">${roInput(trip.arrivedHm)}</td>
    <td class="col-km">${roInput(km)}</td>
    <td class="col-yen">${roInput(yen)}</td>
    <td>${roInput(driven)}</td>
    <td>${roInput(companion)}</td>
  </tr>`;
}

function meterVal(s: string): string {
  const t = s.trim();
  return t ? `${t}㎞` : "";
}

function buildMainHtml(m: JommuKirokuboModel): string {
  const y = m.yParts.y;
  const mo = m.yParts.m.replace(/^0+/, "") || m.yParts.m;
  const d = m.yParts.d.replace(/^0+/, "") || m.yParts.d;
  const cin = displayClockIn(m) ?? "";
  const cout = displayClockOut(m) ?? "";

  const rows: string[] = [];
  for (let i = 0; i < 10; i++) rows.push(tripRow(m, i));

  const o1 = m.odoStartKm?.trim() ?? "";
  const o2 = m.odoEndKm?.trim() ?? "";
  const o3 = m.totalOdoKm?.trim() ?? "";
  const o4 = m.actualDistanceKmSum.trim();

  return `
    <header class="sheet-header">
      <h1 class="sheet-title">乗 務 記 録 簿</h1>
      <p class="sheet-note">＜保存期間：最後に記載した日から２年間＞</p>
    </header>

    <section class="meta-block" aria-label="ヘッダー情報">
      <div class="meta-grid meta-grid--3">
        <div class="field">
          <label class="field-label" for="crew-name">乗務員氏名</label>
          <input class="field-input" id="crew-name" name="crewName" type="text" readonly value="${escapeAttr(m.crewName)}" />
        </div>
        <div class="field">
          <span class="field-label">業務年月日</span>
          <div class="meta-date" role="group" aria-label="業務年月日">
            <input class="field-input" name="businessYear" type="text" readonly value="${escapeAttr(y)}" aria-label="年" />
            <span class="unit">年</span>
            <input class="field-input" name="businessMonth" type="text" readonly value="${escapeAttr(mo)}" aria-label="月" />
            <span class="unit">月</span>
            <input class="field-input" name="businessDay" type="text" readonly value="${escapeAttr(d)}" aria-label="日" />
            <span class="unit">日</span>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="operator-name">事業者名</label>
          <input class="field-input" id="operator-name" name="operatorName" type="text" readonly value="${escapeAttr(m.operatorName)}" />
        </div>
      </div>

      <div class="meta-times meta-block">
        <div class="field">
          <label class="field-label" for="clock-in">始業時刻</label>
          <input class="field-input" id="clock-in" name="clockIn" type="text" readonly value="${escapeAttr(cin)}" />
        </div>
        <div class="field">
          <label class="field-label" for="clock-out">終業時刻</label>
          <input class="field-input" id="clock-out" name="clockOut" type="text" readonly value="${escapeAttr(cout)}" />
        </div>
      </div>

      <div class="meta-grid meta-grid--2">
        <div class="field">
          <label class="field-label" for="escort-vehicle">随伴車</label>
          <input class="field-input" id="escort-vehicle" name="escortVehicle" type="text" readonly value="${escapeAttr(m.escortVehicleLabel)}" />
        </div>
        <div class="field">
          <label class="field-label" for="vehicle-reg">登録番号</label>
          <input class="field-input" id="vehicle-reg" name="vehicleRegistration" type="text" readonly value="${escapeAttr(m.escortVehiclePlate)}" />
        </div>
        <div class="field" style="grid-column: 1 / -1">
          <label class="field-label" for="safety-manager">安全運転　管理者名</label>
          <input class="field-input" id="safety-manager" name="safetyManagerName" type="text" readonly value="${escapeAttr(m.safetyManagerName)}" />
        </div>
      </div>
    </section>

    <section class="meta-block" aria-label="乗務記録">
      <div class="table-scroll">
        <table class="record-table">
          <caption>乗務記録</caption>
          <thead>
            <tr>
              <th scope="col">No</th>
              <th scope="col">依頼者</th>
              <th scope="col">客車の車両番号</th>
              <th scope="col">依頼場所</th>
              <th scope="col">開始時刻</th>
              <th scope="col">経由地</th>
              <th scope="col">到着場所</th>
              <th scope="col">到着時刻</th>
              <th scope="col">走行距離<span class="nowrap">（km）</span></th>
              <th scope="col">料金<span class="nowrap">（円）</span></th>
              <th scope="col">運転した車両<span class="nowrap">（代行など）</span></th>
              <th scope="col">同伴乗務員名</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join("\n")}
          </tbody>
        </table>
      </div>
    </section>

    <section class="meter-section" aria-labelledby="meter-heading">
      <h2 id="meter-heading">メーター距離等</h2>
      <div class="meter-grid">
        <div class="meter-field field">
          <label class="field-label" for="odo-start">始業時（㎞）</label>
          <input class="field-input" id="odo-start" name="odoStartKm" type="text" readonly value="${escapeAttr(meterVal(o1))}" />
        </div>
        <div class="meter-field field">
          <label class="field-label" for="odo-end">終業時（㎞）</label>
          <input class="field-input" id="odo-end" name="odoEndKm" type="text" readonly value="${escapeAttr(meterVal(o2))}" />
        </div>
        <div class="meter-field field">
          <label class="field-label" for="odo-total">走行距離合計（㎞）</label>
          <input class="field-input" id="odo-total" name="odoTotalKm" type="text" readonly value="${escapeAttr(meterVal(o3))}" />
        </div>
        <div class="meter-field field">
          <label class="field-label" for="actual-km">実車走行距離（㎞）</label>
          <input class="field-input" id="actual-km" name="actualDistanceKm" type="text" readonly value="${escapeAttr(meterVal(o4))}" />
        </div>
        <div class="meter-field field">
          <label class="field-label" for="sales-total">売上合計（円）</label>
          <input class="field-input" id="sales-total" name="salesTotalYen" type="text" readonly value="${escapeAttr(m.salesTotalYen ? `${m.salesTotalYen}円` : "")}" />
        </div>
      </div>
    </section>
  `.trim();
}

async function loadShellHtml(): Promise<string> {
  if (cachedShellHtml) return cachedShellHtml;
  const p = path.join(TEMPLATE_DIR, "record-book.html");
  if (!existsSync(p)) {
    throw new Error(`乗務記録簿テンプレが見つかりません: ${p}（cwd=${process.cwd()}）`);
  }
  cachedShellHtml = await fs.readFile(p, "utf8");
  return cachedShellHtml;
}

async function loadRecordBookCss(): Promise<string> {
  if (cachedRecordCss) return cachedRecordCss;
  const p = path.join(TEMPLATE_DIR, "record-book.css");
  if (!existsSync(p)) {
    throw new Error(`乗務記録簿 CSS が見つかりません: ${p}`);
  }
  cachedRecordCss = await fs.readFile(p, "utf8");
  return cachedRecordCss;
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

/**
 * Puppeteer でそのまま setContent できる完全 HTML（A4 横印刷は record-book.css の @page に従う）。
 */
export async function buildJommuKirokuboSheetHtml(model: JommuKirokuboModel): Promise<string> {
  const [shell, fontFace, css] = await Promise.all([
    loadShellHtml(),
    loadFontFaceBlock(),
    loadRecordBookCss(),
  ]);
  const html = shell
    .replace("__JOMMU_FONT_FACE__", fontFace)
    .replace("__JOMMU_STYLES__", css)
    .replace("__JOMMU_MAIN__", buildMainHtml(model));
  if (html.includes("__JOMMU")) {
    throw new Error("jommu: テンプレの埋め込みが不完全です（プレースホルダが残りました）");
  }
  return html;
}
