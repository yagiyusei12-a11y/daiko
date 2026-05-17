/**
 * 乗務記録簿: record-book.css + フォント base64 を組み合わせて
 * Puppeteer に渡す完全 HTML（A4 横）を組み立てる。
 *
 * レイアウトは元帳票画像に合わせた table-based 設計:
 *  - ヘッダー情報: 左ボックス(57.5%) + ギャップ(7.5%) + 右ボックス(35%)
 *  - 乗務記録: 12 列 table (No/依頼者/客車/依頼場所/開始/経由/到着場所/到着時刻/距離/料金/車両/同伴)
 *  - メーター距離等: 10 セル table
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { JommuKirokuboModel, JommuTripRow } from "./jommu-types.js";

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "jommu-print");

let cachedCss: string | null = null;
let cachedFontFaceBlock: string | null = null;

/** HTML テキストエスケープ */
function e(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function displayClockIn(m: JommuKirokuboModel): string {
  if (m.clockInHm?.trim()) return m.clockInHm.trim();
  return m.trips[0]?.departedHm?.trim() ?? "";
}

function displayClockOut(m: JommuKirokuboModel): string {
  if (m.clockOutHm?.trim()) return m.clockOutHm.trim();
  const last = m.trips[m.trips.length - 1];
  return last?.arrivedHm?.trim() ?? "";
}

/** 空なら単位だけ（小さいグレー）、値があれば値＋単位 */
function kmCell(v: string): string {
  const t = v.trim();
  return t ? `${e(t)}㎞` : `<span style="color:#999;font-size:6.5pt">㎞</span>`;
}
function yenCell(v: string): string {
  const t = v.trim();
  return t ? `${e(t)}円` : `<span style="color:#999;font-size:6.5pt">円</span>`;
}
function meterKm(v: string): string {
  const t = (v ?? "").trim();
  return t ? `${e(t)}㎞` : "㎞";
}

/** 依頼者〜料金のいずれかに帳票として載せる内容があるか（運転車両・同伴列の表示可否） */
function rowShowsVehicleAndCompanion(trip: JommuTripRow): boolean {
  if (
    trip.clientName.trim() ||
    trip.charterVehicleNo.trim() ||
    trip.origin.trim() ||
    trip.viaText.trim() ||
    trip.destination.trim()
  ) {
    return true;
  }
  if (trip.departedHm.trim()) return true;
  if (trip.arrivedHm.trim()) return true;
  const fareNum = Number(String(trip.fareYen).replace(/,/g, "").trim());
  if (Number.isFinite(fareNum) && fareNum !== 0) return true;
  const distRaw = String(trip.distanceKm).replace(/,/g, "").trim();
  if (distRaw) {
    const d = parseFloat(distRaw);
    if (Number.isFinite(d) && d > 0) return true;
  }
  return false;
}

function buildRecordRow(m: JommuKirokuboModel, i: number): string {
  const n = i + 1;
  const trip = m.trips[i];
  const companion = e((trip?.accompanyingCrewName ?? m.accompanyingCrewName).trim());

  if (!trip) {
    return `<tr>
      <th class="no">${n}</th>
      <td></td><td></td><td></td>
      <td class="tc">：</td>
      <td></td><td></td>
      <td class="tc">：</td>
      <td class="tr">${kmCell("")}</td>
      <td class="tr">${yenCell("")}</td>
      <td class="tc"></td>
      <td></td>
    </tr>`;
  }

  const showLast = rowShowsVehicleAndCompanion(trip);
  const vehicleTd = showLast ? `<td class="tc">代行</td>` : `<td class="tc"></td>`;
  const companionTd = showLast ? `<td>${companion}</td>` : `<td></td>`;

  return `<tr>
    <th class="no">${n}</th>
    <td>${e(trip.clientName)}</td>
    <td>${e(trip.charterVehicleNo)}</td>
    <td>${e(trip.origin)}</td>
    <td class="tc">${e(trip.departedHm) || "："}</td>
    <td>${e(trip.viaText)}</td>
    <td>${e(trip.destination)}</td>
    <td class="tc">${e(trip.arrivedHm) || "："}</td>
    <td class="tr">${kmCell(trip.distanceKm)}</td>
    <td class="tr">${yenCell(trip.fareYen)}</td>
    ${vehicleTd}
    ${companionTd}
  </tr>`;
}

function buildMainHtml(m: JommuKirokuboModel): string {
  const y  = m.yParts.y;
  const mo = m.yParts.m.replace(/^0+/, "") || m.yParts.m;
  const d  = m.yParts.d.replace(/^0+/, "") || m.yParts.d;
  const cin  = e(displayClockIn(m));
  const cout = e(displayClockOut(m));
  const plate = e(m.escortVehiclePlate || m.escortVehicleLabel);

  const rows = Array.from({ length: 10 }, (_, i) => buildRecordRow(m, i)).join("\n");

  const o1    = m.odoStartKm?.trim() ?? "";
  const o2    = m.odoEndKm?.trim() ?? "";
  const o3    = m.totalOdoKm?.trim() ?? "";
  const o4    = m.actualDistanceKmSum.trim();
  const sales = m.salesTotalYen.trim();

  return `<div class="doc">

  <!-- タイトル -->
  <div class="title-row">
    <span class="doc-title">乗 務 記 録 簿</span>
    <span class="doc-note">＜保存期間：最後に記載した日から２年間＞</span>
  </div>

  <!-- ヘッダー情報 -->
  <div class="hdr-wrap">
    <!-- 左ボックス（乗務員・日時・始終業・随伴車） -->
    <div class="hdr-l">
      <table class="hdr-tbl">
        <colgroup>
          <col style="width:13%">   <!-- 乗務員氏名ラベル -->
          <col style="width:11%">   <!-- 始業時刻値 / 名前値col1 -->
          <col style="width:13%">   <!-- 終業時刻ラベル -->
          <col style="width:11%">   <!-- 終業時刻値 / 名前値col3 -->
          <col style="width:13%">   <!-- 随伴車ラベル / 業務年月日ラベル -->
          <col style="width:11.8%"> <!-- 年 / 随伴車値col1 -->
          <col style="width:4%">    <!-- 年単位 -->
          <col style="width:7.4%">  <!-- 月 -->
          <col style="width:4%">    <!-- 月単位 -->
          <col style="width:7.4%">  <!-- 日 -->
          <col style="width:4%">    <!-- 日単位 -->
        </colgroup>
        <tbody>
          <tr>
            <td class="lbl">乗務員氏名</td>
            <td class="val" colspan="3">${e(m.crewName)}</td>
            <td class="lbl">業務年月日</td>
            <td class="val hc">${e(y)}</td>
            <td class="unit">年</td>
            <td class="val hc">${e(mo)}</td>
            <td class="unit">月</td>
            <td class="val hc">${e(d)}</td>
            <td class="unit">日</td>
          </tr>
          <tr>
            <td class="lbl">始業時刻</td>
            <td class="val hc">${cin}</td>
            <td class="lbl">終業時刻</td>
            <td class="val hc">${cout}</td>
            <td class="lbl" style="line-height:1.2">随伴車<br>登録番号</td>
            <td class="val" colspan="6">${plate}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="hdr-gap"></div>

    <!-- 右ボックス（事業者名・安全運転管理者名） -->
    <div class="hdr-r">
      <table class="hdr-tbl">
        <colgroup>
          <col style="width:21.4%">
          <col style="width:78.6%">
        </colgroup>
        <tbody>
          <tr>
            <td class="lbl-g">事業者名</td>
            <td class="val">${e(m.operatorName)}</td>
          </tr>
          <tr>
            <td class="lbl-g" style="line-height:1.2">安全運転<br>管理者名</td>
            <td class="val">${e(m.safetyManagerName)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- 乗務記録テーブル -->
  <div class="sec-lbl">乗務記録</div>
  <table class="rec">
    <colgroup>
      <col style="width:2.5%">   <!-- No -->
      <col style="width:10%">    <!-- 依頼者 -->
      <col style="width:12.5%">  <!-- 客車の車両番号 -->
      <col style="width:11.2%">  <!-- 依頼場所 -->
      <col style="width:6.2%">   <!-- 開始時刻 -->
      <col style="width:10%">    <!-- 経由地 -->
      <col style="width:12.5%">  <!-- 到着場所 -->
      <col style="width:6.2%">   <!-- 到着時刻 -->
      <col style="width:7.5%">   <!-- 走行距離 -->
      <col style="width:7.5%">   <!-- 料金 -->
      <col style="width:7.5%">   <!-- 運転した車両 -->
      <col style="width:6.4%">   <!-- 同伴乗務員名 -->
    </colgroup>
    <thead>
      <tr>
        <th></th>
        <th>依頼者</th>
        <th>客車の<br>車両番号</th>
        <th>依頼場所</th>
        <th>開始時刻</th>
        <th>経由地</th>
        <th>到着場所</th>
        <th>到着時刻</th>
        <th>走行距離</th>
        <th>料金</th>
        <th>運転した<br>車両</th>
        <th>同伴<br>乗務員名</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <!-- メーター距離等 -->
  <div class="meter-lbl">メーター距離等</div>
  <table class="mtr">
    <colgroup>
      <col style="width:8.75%">  <!-- 始業時ラベル -->
      <col style="width:10%">    <!-- 始業時値 -->
      <col style="width:8.75%">  <!-- 終業時ラベル -->
      <col style="width:10%">    <!-- 終業時値 -->
      <col style="width:8.75%">  <!-- 走行距離合計ラベル -->
      <col style="width:10%">    <!-- 走行距離合計値 -->
      <col style="width:8.75%">  <!-- 実車走行距離ラベル -->
      <col style="width:10%">    <!-- 実車走行距離値 -->
      <col style="width:10%">    <!-- 売上合計ラベル -->
      <col style="width:15%">    <!-- 売上合計値 -->
    </colgroup>
    <tbody>
      <tr>
        <td class="mtr-lbl">始業時</td>
        <td class="mtr-val">${meterKm(o1)}</td>
        <td class="mtr-lbl">終業時</td>
        <td class="mtr-val">${meterKm(o2)}</td>
        <td class="mtr-lbl">走行距離合計</td>
        <td class="mtr-val">${meterKm(o3)}</td>
        <td class="mtr-lbl">実車走行距離</td>
        <td class="mtr-val">${meterKm(o4)}</td>
        <td class="mtr-lbl">売上合計</td>
        <td class="mtr-val">${sales ? e(sales) + "円" : "円"}</td>
      </tr>
    </tbody>
  </table>

  <div class="form-no">0000-0000</div>
</div>`;
}

async function loadRecordBookCss(): Promise<string> {
  if (cachedCss) return cachedCss;
  const p = path.join(TEMPLATE_DIR, "record-book.css");
  if (!existsSync(p)) throw new Error(`乗務記録簿 CSS が見つかりません: ${p}`);
  cachedCss = await fs.readFile(p, "utf8");
  return cachedCss;
}

async function loadFontFaceBlock(): Promise<string> {
  if (cachedFontFaceBlock) return cachedFontFaceBlock;
  const fonts: { file: string; family: string }[] = [
    { file: "DejaVuSerif_69.woff",          family: "DejaVuSerif_69" },
    { file: "NotoSansCJKjp-Regular_64.woff", family: "NotoSansCJKjp-Regular_64" },
    { file: "NotoSansCJKjp-Regular_64_1.woff", family: "NotoSansCJKjp-Regular_64_1" },
  ];
  const parts: string[] = [];
  for (const { file, family } of fonts) {
    const fp = path.join(TEMPLATE_DIR, "fonts", file);
    if (!existsSync(fp)) throw new Error("jommu: 乗務記録簿テンプレのフォントが欠けています。再デプロイを試してください。");
    const buf = await fs.readFile(fp);
    parts.push(`@font-face{font-family:${family};src:url("data:font/woff;base64,${buf.toString("base64")}") format("woff");}`);
  }
  cachedFontFaceBlock = parts.join("\n");
  return cachedFontFaceBlock;
}

/**
 * Puppeteer の setContent に渡せる完全 HTML。
 * @page は CSS 内で A4 landscape を指定済み（preferCSSPageSize: true で有効）。
 */
export async function buildJommuKirokuboSheetHtml(model: JommuKirokuboModel): Promise<string> {
  const [fontFace, css] = await Promise.all([loadFontFaceBlock(), loadRecordBookCss()]);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<style>${fontFace}</style>
<style>${css}</style>
</head>
<body>
${buildMainHtml(model)}
</body>
</html>`;
}
