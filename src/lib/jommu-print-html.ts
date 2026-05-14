/**
 * 乗務記録簿: templates/jommu-print の HTML（IDR 由来レイアウト）を埋めて PDF 用 HTML を返す。
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { JommuKirokuboModel, JommuTripRow } from "./jommu-types.js";

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "jommu-print");

const TRIP_TRIPLES: [string, string, string][] = [
  ["t4", "t5", "t6"],
  ["t8", "t9", "ta"],
  ["tc", "td", "te"],
  ["tg", "th", "ti"],
  ["tk", "tl", "tm"],
  ["to", "tp", "tq"],
  ["ts", "tt", "tu"],
  ["tw", "tx", "ty"],
  ["t10", "t11", "t12"],
  ["t14", "t15", "t16"],
];

const FARE_SPAN_IDS = ["t23", "t25", "t27", "t29", "t2b", "t2d", "t2f", "t2h", "t2j", "t2l"];

/** 乗務記録テーブル各行の baseline（#t3 などと同じ段） */
const TRIP_ROW_BOTTOM = [639, 602, 566, 529, 492, 456, 419, 382, 346, 309];

/** ヘッダー #t1r … と揃えた列左端（px） */
const COL = {
  client: 86,
  charter: 203,
  origin: 367,
  depart: 469,
  via: 573,
  dest: 698,
  arrive: 808,
  companion: 1054,
} as const;

const MAX_CELL: Record<keyof typeof COL, number> = {
  client: 14,
  charter: 12,
  origin: 18,
  depart: 6,
  via: 14,
  dest: 16,
  arrive: 6,
  companion: 12,
};

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

function trunc(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function jmuCell(text: string, left: number, bottom: number, max: number, cls: string): string {
  const body = escapeHtml(trunc(text, max));
  return `<span class="t ${cls} jmu-el" style="left:${left}px;bottom:${bottom}px;">${body} </span>`;
}

function replaceSpanInner(html: string, id: string, innerEscaped: string): string {
  const safeId = id.replace(/[^a-z0-9]/gi, (ch) => `\\${ch}`);
  const re = new RegExp(`(<span\\s+id="${safeId}"[^>]*>)([\\s\\S]*?)(</span>)`);
  return html.replace(re, `$1${innerEscaped}$3`);
}

function clockPlaceholderOrValue(hm: string | null | undefined): string {
  const v = hm?.trim();
  if (!v) return escapeHtml("： ");
  return `${escapeHtml(v)} `;
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

function buildHeaderOverlays(m: JommuKirokuboModel): string {
  const y = m.yParts.y;
  const mo = m.yParts.m.replace(/^0+/, "") || m.yParts.m;
  const d = m.yParts.d.replace(/^0+/, "") || m.yParts.d;

  const parts: string[] = [];
  /** 乗務員氏名（2 段目左セル。やや下げてセル中央付近） */
  parts.push(jmuCell(m.crewName, 46, 726, 16, "s0"));
  /** 業務年月日の数字（1 段目の 3 区分に分割。ラベル「年」「月」「日」の左側欄） */
  parts.push(jmuCell(y, 372, 781, 6, "s2"));
  parts.push(jmuCell(mo, 548, 781, 4, "s2"));
  parts.push(jmuCell(d, 668, 781, 4, "s2"));
  /** 事業者名（1 段目右セル） */
  parts.push(jmuCell(m.operatorName, 818, 781, 28, "s0"));
  /** 随伴車（表示名）／登録番号／安全運転管理者 */
  parts.push(jmuCell(m.escortVehicleLabel, 458, 739, 18, "s5"));
  parts.push(jmuCell(m.escortVehiclePlate, 458, 719, 20, "s5"));
  parts.push(jmuCell(m.safetyManagerName, 928, 719, 18, "s5"));

  return parts.join("");
}

function tripCell(t: JommuTripRow, key: keyof typeof COL): string {
  switch (key) {
    case "client":
      return t.clientName;
    case "charter":
      return t.charterVehicleNo;
    case "origin":
      return t.origin;
    case "depart":
      return t.departedHm;
    case "via":
      return t.viaText;
    case "dest":
      return t.destination;
    case "arrive":
      return t.arrivedHm;
    case "companion":
      return "";
    default:
      return "";
  }
}

function buildTripGridOverlays(m: JommuKirokuboModel): string {
  const keys = Object.keys(COL) as (keyof typeof COL)[];
  const parts: string[] = [];
  for (let i = 0; i < TRIP_ROW_BOTTOM.length; i++) {
    const bottom = TRIP_ROW_BOTTOM[i]!;
    const trip = m.trips[i];
    for (const k of keys) {
      if (k === "companion") {
        parts.push(jmuCell(m.accompanyingCrewName, COL[k], bottom, MAX_CELL[k], "s5"));
        continue;
      }
      const raw = trip ? tripCell(trip, k) : "";
      parts.push(jmuCell(raw, COL[k], bottom, MAX_CELL[k], "s0"));
    }
  }
  return parts.join("");
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

function applyModel(html: string, m: JommuKirokuboModel): string {
  let out = html;
  out = out.replace("__JOMMU_EXTRA__", buildHeaderOverlays(m) + buildTripGridOverlays(m));

  out = replaceSpanInner(out, "t1", clockPlaceholderOrValue(displayClockIn(m)));
  out = replaceSpanInner(out, "t2", clockPlaceholderOrValue(displayClockOut(m)));

  for (let i = 0; i < TRIP_TRIPLES.length; i++) {
    const [a, b, km] = TRIP_TRIPLES[i]!;
    const trip = m.trips[i];
    out = replaceSpanInner(out, a, escapeHtml("： "));
    out = replaceSpanInner(out, b, escapeHtml("： "));
    if (!trip) {
      out = replaceSpanInner(out, km, escapeHtml("km "));
      continue;
    }
    const dist = trip.distanceKm.trim();
    out = replaceSpanInner(out, km, dist ? `${escapeHtml(dist)}km ` : escapeHtml("km "));
  }

  for (let i = 0; i < FARE_SPAN_IDS.length; i++) {
    const id = FARE_SPAN_IDS[i]!;
    const trip = m.trips[i];
    const fare = trip?.fareYen.trim();
    out = replaceSpanInner(out, id, fare ? `${escapeHtml(fare)}円 ` : escapeHtml("円 "));
  }

  const o1 = m.odoStartKm?.trim() ?? "";
  const o2 = m.odoEndKm?.trim() ?? "";
  const o3 = m.totalOdoKm?.trim() ?? "";
  const o4 = m.actualDistanceKmSum.trim();
  out = replaceSpanInner(out, "t17", o1 ? `${escapeHtml(o1)}㎞ ` : escapeHtml("㎞ "));
  out = replaceSpanInner(out, "t18", o2 ? `${escapeHtml(o2)}㎞ ` : escapeHtml("㎞ "));
  out = replaceSpanInner(out, "t19", o3 ? `${escapeHtml(o3)}㎞ ` : escapeHtml("㎞ "));
  out = replaceSpanInner(out, "t1a", o4 ? `${escapeHtml(o4)}㎞ ` : escapeHtml("㎞ "));

  out = replaceSpanInner(out, "t1b", escapeHtml(" "));
  out = replaceSpanInner(out, "t2t", `${escapeHtml(m.salesTotalYen)}円 `);

  return out;
}

function injectPrintPageSize(html: string): string {
  const inj =
    "<style>@page{size:1286px 909px;margin:0;}" +
    ".jmu-el{z-index:3;transform-origin:bottom left;}</style>";
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
    .replace("__JOMMU_BG__", bg);
  html = applyModel(html, model);
  if (html.includes("__JOMMU")) {
    throw new Error("jommu: テンプレの埋め込みが不完全です（プレースホルダが残りました）");
  }
  return injectPrintPageSize(html);
}
