/** お客様向け料金表（A4 縦・印刷用 HTML）。設定の pricingPrefs を表示する。 */

import {
  coercePricingPrefs,
  type DistanceBand,
  type LongDistanceDiscountTier,
  type PricingPrefsV1,
  type SpecialFareEntry,
  type TimeBand,
} from "./pricing-prefs.js";
import { PRINT_BUSINESS_BASE_CSS } from "./print-business-theme.js";
import { ymdTokyo } from "./tokyo-datetime.js";

export type RyokinhyoCompanyInfo = {
  businessName: string;
  addressLine: string;
  phone: string | null;
};

export type RyokinhyoPrintInput = {
  company: RyokinhyoCompanyInfo;
  pricingPrefs: PricingPrefsV1;
  /** 記載日（省略時は東京の当日） */
  issuedYmd?: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function yen(n: number): string {
  return `¥${Math.max(0, Math.floor(n)).toLocaleString("ja-JP")}`;
}

function formatYmdJa(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

function formatDistanceCustomer(m: number): string {
  const v = Math.max(0, Math.floor(m));
  if (v === 0) return "—";
  if (v % 1000 === 0) return `${v / 1000}km`;
  return `${v.toLocaleString("ja-JP")}m`;
}

function formatMinutesCustomer(min: number): string {
  const v = Math.max(0, Math.floor(min));
  if (v === 0) return "—";
  return `${v.toLocaleString("ja-JP")}分`;
}

function regimeLabel(regime: PricingPrefsV1["regime"]): string {
  if (regime === "distance") return "距離制を主とする";
  if (regime === "time") return "時間制を主とする";
  if (regime === "both") return "距離・時間の併用";
  return "未設定";
}

function specialRegimeLabel(regime: SpecialFareEntry["regime"]): string {
  if (regime === "time") return "時間制";
  if (regime === "both") return "距離・時間併用";
  return "距離制";
}

function distanceBandRows(band: DistanceBand): string {
  const rows: [string, string][] = [
    ["初乗り料金", yen(band.baseFareYen)],
    ["初乗りに含まれる距離", formatDistanceCustomer(band.includedDistanceM)],
  ];
  if (band.addEveryM > 0 && band.addFareYen > 0) {
    rows.push([`超過分（${formatDistanceCustomer(band.addEveryM)}ごと）`, yen(band.addFareYen)]);
  } else if (band.addEveryM > 0 || band.addFareYen > 0) {
    rows.push(["超過加算", "設定をご確認ください"]);
  }
  return tableFromRows(rows);
}

function timeBandRows(band: TimeBand): string {
  const rows: [string, string][] = [
    ["初乗り料金", yen(band.baseFareYen)],
    ["初乗りに含まれる時間", formatMinutesCustomer(band.includedMinutes)],
  ];
  if (band.addEveryMin > 0 && band.addFareYen > 0) {
    rows.push([`超過分（${formatMinutesCustomer(band.addEveryMin)}ごと）`, yen(band.addFareYen)]);
  } else if (band.addEveryMin > 0 || band.addFareYen > 0) {
    rows.push(["超過加算", "設定をご確認ください"]);
  }
  return tableFromRows(rows);
}

function tableFromRows(rows: [string, string][]): string {
  const body = rows
    .map(
      ([th, td]) =>
        `<tr><th>${esc(th)}</th><td>${esc(td)}</td></tr>`,
    )
    .join("");
  return `<table class="rk-tbl"><tbody>${body}</tbody></table>`;
}

function section(title: string, inner: string): string {
  if (!inner.trim()) return "";
  return `<section class="rk-section"><h2 class="rk-h2">${esc(title)}</h2>${inner}</section>`;
}

function flatFeeSection(title: string, yenValue: number): string {
  if (yenValue <= 0) return "";
  return section(title, tableFromRows([["料金", yen(yenValue)]]));
}

function longDistanceTierText(t: LongDistanceDiscountTier): string {
  const km =
    t.thresholdKm > 0
      ? `${t.thresholdKm.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}km以上`
      : "全走行距離";
  if (t.discountKind === "percent" && t.percent > 0) {
    return `${km}：運賃の${t.percent}%を割引`;
  }
  if (t.flatYen > 0) {
    return `${km}：${yen(t.flatYen)}割引`;
  }
  return `${km}：割引（金額は運行時に算定）`;
}

const RYOKINHYO_CSS = `${PRINT_BUSINESS_BASE_CSS}
@page { size: A4 portrait; margin: 14mm 16mm; }
.rk-doc {
  width: 178mm;
  max-width: 100%;
  margin: 0 auto;
  color: var(--pd-ink);
  font-size: 10.5pt;
  line-height: 1.5;
}
.rk-doc .rk-title {
  margin: 0 0 4mm;
  text-align: center;
  font-size: 20pt;
  font-weight: 800;
  letter-spacing: 0.2em;
}
.rk-doc .rk-subtitle {
  margin: 0 0 6mm;
  text-align: center;
  font-size: 10pt;
  color: var(--pd-muted);
}
.rk-doc .rk-company {
  margin: 0 0 5mm;
  padding: 3mm 4mm;
  border: 1px solid var(--pd-line);
  background: var(--pd-fill);
  font-size: 10.5pt;
}
.rk-doc .rk-company .rk-name {
  font-size: 12pt;
  font-weight: 700;
  margin: 0 0 1.5mm;
}
.rk-doc .rk-company p { margin: 0.5mm 0; }
.rk-doc .rk-regime {
  margin: 0 0 5mm;
  padding: 2.5mm 3.5mm;
  border-left: 3px solid var(--pd-accent);
  background: var(--pd-fill-label);
  font-weight: 600;
}
.rk-doc .rk-section { margin-bottom: 5mm; }
.rk-doc .rk-h2 {
  margin: 0 0 2mm;
  font-size: 11.5pt;
  font-weight: 700;
  border-bottom: 1px solid var(--pd-line-strong);
  padding-bottom: 1mm;
}
.rk-doc .rk-h3 {
  margin: 3mm 0 1.5mm;
  font-size: 10.5pt;
  font-weight: 700;
}
.rk-doc .rk-tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 10pt;
}
.rk-doc .rk-tbl th,
.rk-doc .rk-tbl td {
  border: 1px solid var(--pd-line);
  padding: 2mm 2.5mm;
  vertical-align: top;
  word-break: break-word;
}
.rk-doc .rk-tbl th {
  width: 38%;
  background: var(--pd-fill-label);
  font-weight: 600;
  text-align: left;
}
.rk-doc .rk-tbl td { background: #fff; }
.rk-doc .rk-list {
  margin: 0;
  padding-left: 1.2em;
}
.rk-doc .rk-list li { margin: 1mm 0; }
.rk-doc .rk-note {
  margin: 6mm 0 0;
  font-size: 9pt;
  color: var(--pd-muted);
  line-height: 1.55;
}
.rk-doc .rk-empty {
  padding: 4mm;
  border: 1px dashed var(--pd-line);
  color: var(--pd-muted);
  text-align: center;
}
`;

export function buildDaikoRyokinhyoPrintHtml(input: RyokinhyoPrintInput): string {
  const prefs = coercePricingPrefs(input.pricingPrefs);
  const issuedYmd = (input.issuedYmd?.trim() || ymdTokyo()).slice(0, 10);
  const company = input.company;

  const sections: string[] = [];

  if (!prefs.regime) {
    sections.push(
      `<div class="rk-empty">料金体制が未設定です。システムの「設定 → 料金」で登録してください。</div>`,
    );
  } else {
    if (prefs.regime === "distance" || prefs.regime === "both") {
      const d = prefs.mainDistance ?? { baseFareYen: 0, includedDistanceM: 0, addEveryM: 0, addFareYen: 0 };
      sections.push(section("基本運賃（距離制）", distanceBandRows(d)));
    }
    if (prefs.regime === "time" || prefs.regime === "both") {
      const t = prefs.mainTime ?? { baseFareYen: 0, includedMinutes: 0, addEveryMin: 0, addFareYen: 0 };
      sections.push(section("基本運賃（時間制）", timeBandRows(t)));
    }
  }

  if (prefs.features.includes("pickup") && (prefs.pickupBaseYen ?? 0) > 0) {
    sections.push(flatFeeSection("迎車料金", prefs.pickupBaseYen ?? 0));
  }
  if (prefs.features.includes("waiting")) {
    const w = prefs.waiting ?? { baseFareYen: 0, includedMinutes: 0, addEveryMin: 0, addFareYen: 0 };
    if (w.baseFareYen > 0 || w.includedMinutes > 0 || w.addEveryMin > 0) {
      sections.push(section("待機時間", timeBandRows(w)));
    }
  }
  if (prefs.features.includes("leftHand") && (prefs.leftHandBaseYen ?? 0) > 0) {
    sections.push(flatFeeSection("左ハンドル車両", prefs.leftHandBaseYen ?? 0));
  }
  if (prefs.features.includes("foreignCar") && (prefs.foreignCarBaseYen ?? 0) > 0) {
    sections.push(flatFeeSection("外車", prefs.foreignCarBaseYen ?? 0));
  }
  if (prefs.features.includes("cancel") && (prefs.cancelBaseYen ?? 0) > 0) {
    sections.push(flatFeeSection("キャンセル料", prefs.cancelBaseYen ?? 0));
  }

  if (prefs.features.includes("specialFare") && prefs.specialFares.length > 0) {
    const blocks = prefs.specialFares
      .map((sf) => {
        const parts: string[] = [`<h3 class="rk-h3">${esc(sf.name)}（${esc(specialRegimeLabel(sf.regime))}）</h3>`];
        if (sf.regime === "distance" || sf.regime === "both") {
          parts.push(distanceBandRows(sf.distance ?? { baseFareYen: 0, includedDistanceM: 0, addEveryM: 0, addFareYen: 0 }));
        }
        if (sf.regime === "time" || sf.regime === "both") {
          parts.push(timeBandRows(sf.time ?? { baseFareYen: 0, includedMinutes: 0, addEveryMin: 0, addFareYen: 0 }));
        }
        if ((sf.extraFlatYen ?? 0) > 0) {
          parts.push(tableFromRows([["追加料金（定額）", yen(sf.extraFlatYen ?? 0)]]));
        }
        return `<div class="rk-special">${parts.join("")}</div>`;
      })
      .join("");
    sections.push(section("特別料金", blocks));
  }

  if (prefs.features.includes("longDistanceDiscount") && prefs.longDistanceTiers.length > 0) {
    const items = prefs.longDistanceTiers
      .slice()
      .sort((a, b) => a.thresholdKm - b.thresholdKm)
      .map((t) => `<li>${esc(longDistanceTierText(t))}</li>`)
      .join("");
    sections.push(section("長距離割引", `<ul class="rk-list">${items}</ul>`));
  }

  const regimeBlock = prefs.regime
    ? `<p class="rk-regime">料金の算定方法：${esc(regimeLabel(prefs.regime))}</p>`
    : "";

  const companyLines: string[] = [];
  if (company.addressLine) companyLines.push(`<p>${esc(company.addressLine)}</p>`);
  if (company.phone?.trim()) companyLines.push(`<p>TEL ${esc(company.phone.trim())}</p>`);

  const body = `<div class="pd-doc rk-doc">
  <h1 class="rk-title">料金表</h1>
  <p class="rk-subtitle">自動車運転代行サービス</p>
  <div class="rk-company">
    <p class="rk-name">${esc(company.businessName || "事業者名未設定")}</p>
    ${companyLines.join("\n    ")}
  </div>
  ${regimeBlock}
  ${sections.join("\n  ")}
  <p class="rk-note">
    ※ 上記は事業者がシステムに登録した料金設定に基づくものです。実際のご請求は走行距離・時間・選択プラン等により異なる場合があります。<br />
    記載日：${esc(formatYmdJa(issuedYmd))}
  </p>
</div>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>料金表</title>
<style>${RYOKINHYO_CSS}</style>
</head>
<body class="pd-body">${body}</body>
</html>`;
}
