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

const MAX_OVERLAY = 48;
const MAX_TRIP_COL = 72;

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

function tripColA(t: JommuTripRow): string {
  return trunc(
    [t.clientName, t.charterVehicleNo, t.origin, t.departedHm].filter(Boolean).join("　"),
    MAX_TRIP_COL,
  );
}

function tripColB(t: JommuTripRow): string {
  return trunc(
    [t.viaText, t.destination, t.arrivedHm].filter(Boolean).join("　"),
    MAX_TRIP_COL,
  );
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

function buildOverlaySpans(m: JommuKirokuboModel): string {
  const y = m.yParts.y;
  const mo = m.yParts.m.replace(/^0+/, "") || m.yParts.m;
  const d = m.yParts.d.replace(/^0+/, "") || m.yParts.d;
  const dateStr = `${y}年${mo}月${d}日`;
  const crew = escapeHtml(trunc(m.crewName, MAX_OVERLAY));
  const office = escapeHtml(trunc(m.officeName, MAX_OVERLAY));
  const plate = escapeHtml(trunc(m.companyCarRegNo, MAX_OVERLAY));
  const safety = escapeHtml(trunc(m.safetyManagerName, MAX_OVERLAY));
  const companion = escapeHtml(trunc(m.accompanyingCrewName, MAX_OVERLAY));
  const dateEsc = escapeHtml(dateStr);
  return (
    `<span id="jmu-crew" class="t s0" style="left:40px;bottom:746px;">${crew}</span>` +
    `<span id="jmu-date" class="t s0" style="left:430px;bottom:748px;">${dateEsc}</span>` +
    `<span id="jmu-office" class="t s0" style="left:870px;bottom:748px;">${office}</span>` +
    `<span id="jmu-plate" class="t s0" style="left:455px;bottom:718px;">${plate}</span>` +
    `<span id="jmu-safety" class="t s0" style="left:955px;bottom:718px;">${safety}</span>` +
    `<span id="jmu-companion" class="t s0" style="left:980px;bottom:668px;">${companion}</span>`
  );
}

function applyModel(html: string, m: JommuKirokuboModel): string {
  let out = html;
  out = out.replace("__JOMMU_EXTRA__", buildOverlaySpans(m));

  out = replaceSpanInner(out, "t1", clockPlaceholderOrValue(m.clockInHm));
  out = replaceSpanInner(out, "t2", clockPlaceholderOrValue(m.clockOutHm));

  for (let i = 0; i < TRIP_TRIPLES.length; i++) {
    const [a, b, km] = TRIP_TRIPLES[i]!;
    const trip = m.trips[i];
    if (!trip) {
      out = replaceSpanInner(out, a, escapeHtml("： "));
      out = replaceSpanInner(out, b, escapeHtml("： "));
      out = replaceSpanInner(out, km, escapeHtml("km "));
      continue;
    }
    out = replaceSpanInner(out, a, `${escapeHtml(tripColA(trip))} `);
    out = replaceSpanInner(out, b, `${escapeHtml(tripColB(trip))} `);
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
    .replace("__JOMMU_BG__", bg);
  html = applyModel(html, model);
  if (html.includes("__JOMMU")) {
    throw new Error("jommu: テンプレの埋め込みが不完全です（プレースホルダが残りました）");
  }
  return injectPrintPageSize(html);
}
