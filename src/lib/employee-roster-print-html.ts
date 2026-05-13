/** 従事者名簿（印刷用 HTML）。従業員マスタの内容を帳票レイアウトで出力。 */

import type { Employee } from "@prisma/client";
import { PRINT_BUSINESS_BASE_CSS } from "./print-business-theme.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function asExt(j: unknown): Record<string, unknown> {
  if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
  return {};
}

function extStr(ext: Record<string, unknown>, key: string): string {
  const v = ext[key];
  return typeof v === "string" ? v : "";
}

function licenseConditionsText(ext: Record<string, unknown>): string {
  const v = ext.licenseConditions;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").join("、");
  if (typeof v === "string") return v.trim();
  return "";
}

function ymdTokyo(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function splitYmd(ymd: string): { y: string; m: string; d: string } {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { y: "", m: "", d: "" };
  return { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) };
}

function ymdFromDbDate(d: Date): string {
  return ymdTokyo(d);
}

function ageAtHireYears(birthYmd: string, hiredYmd: string): string {
  const b = splitYmd(birthYmd);
  const h = splitYmd(hiredYmd);
  if (!b.y || !h.y) return "";
  const by = Number(b.y);
  const bm = Number(b.m);
  const bd = Number(b.d);
  const hy = Number(h.y);
  const hm = Number(h.m);
  const hd = Number(h.d);
  if (![by, bm, bd, hy, hm, hd].every((n) => Number.isFinite(n))) return "";
  let yrs = hy - by;
  if (hm < bm || (hm === bm && hd < bd)) yrs -= 1;
  return yrs >= 0 ? String(yrs) : "";
}

function splitPostalLine(addr: string): { zip: string; body: string } {
  const t = addr.trim();
  const m = t.match(/^(\d{3})[-‐ー]?\s*(\d{4})\s*(.*)$/u);
  if (m) return { zip: `${m[1]}${m[2]}`, body: (m[3] ?? "").trim() };
  return { zip: "", body: t };
}

function normalizeGender(ext: Record<string, unknown>): "" | "男" | "女" {
  const raw = extStr(ext, "gender") || extStr(ext, "sex");
  const t = raw.trim();
  if (t === "男" || t === "M" || t === "m" || t === "male" || t === "MALE") return "男";
  if (t === "女" || t === "F" || t === "f" || t === "female" || t === "FEMALE") return "女";
  return "";
}

function safeDataUrlImg(src: string): string {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return "";
  return src;
}

const ROSTER_CSS = `${PRINT_BUSINESS_BASE_CSS}
.rs-doc .rs-top { margin-bottom: 4px; }
.rs-doc .rs-grid { margin-top: 0; border-top: 2px solid var(--pd-accent); }
.rs-doc .rs-grid td { font-size: 9.8pt; }
.rs-doc .rs-label-narrow { width: 4.25rem; min-width: 3.5rem; }
.rs-doc .rs-name-block { padding: 0 !important; vertical-align: middle; }
.rs-doc .rs-furi-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 8px 10px 5px;
  border-bottom: 1px dashed var(--pd-line-strong);
}
.rs-doc .rs-furi-lbl {
  font-size: 8.5pt;
  font-weight: 600;
  color: var(--pd-muted);
  white-space: nowrap;
}
.rs-doc .rs-furi-val {
  flex: 1;
  min-width: 0;
  font-size: 9.5pt;
  color: var(--pd-ink);
  line-height: 1.4;
}
.rs-doc .rs-name-main {
  padding: 8px 10px 10px;
  font-size: 12pt;
  font-weight: 700;
  color: var(--pd-ink);
  letter-spacing: 0.02em;
}
.rs-doc .rs-spacer { height: 6px; background: var(--pd-fill); }
.rs-doc .rs-gender { white-space: nowrap; text-align: center; padding: 6px 4px !important; }
.rs-doc .rs-g-line { display: inline-flex; align-items: baseline; gap: 0.06em; }
.rs-doc .rs-g-sep { margin: 0 0.3em; color: var(--pd-line-strong); }
.rs-doc .rs-date { white-space: nowrap; text-align: center; font-variant-numeric: tabular-nums; color: var(--pd-ink); }
.rs-doc .rs-address { line-height: 1.55; padding: 9px 11px !important; color: var(--pd-ink); }
.rs-doc .rs-tel { padding: 8px 10px !important; white-space: nowrap; color: var(--pd-ink); }
.rs-doc .rs-em-wrap { padding: 10px 11px !important; vertical-align: middle; }
.rs-doc .rs-em-stack { display: table; width: 100%; }
.rs-doc .rs-em-row { display: table-row; }
.rs-doc .rs-em-cell { display: table-cell; padding: 3px 0; vertical-align: baseline; }
.rs-doc .rs-em-cell:first-child { width: 5.2em; font-weight: 600; color: var(--pd-muted); font-size: 9pt; }
.rs-doc .rs-em-val { color: var(--pd-ink); padding-left: 0.35rem; }
.rs-doc .rs-lic { text-align: left; vertical-align: middle; padding: 9px 11px !important; line-height: 1.45; color: var(--pd-ink); }
.rs-doc .rs-lic-cond { word-break: break-word; overflow-wrap: anywhere; }
.rs-doc .rs-photo { height: 124px; vertical-align: middle; padding: 8px; }
.rs-doc .rs-photo-box {
  height: 108px;
  border: 1px dashed var(--pd-line-strong);
  border-radius: 6px;
  background: var(--pd-fill);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rs-doc .rs-photo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.rs-doc .rs-photo-cap {
  background: var(--pd-fill);
  font-weight: 600;
  text-align: center;
  font-size: 9pt;
  color: var(--pd-ink);
  padding: 7px;
}
.rs-empty { padding: 28px; text-align: center; color: var(--pd-muted); }
`;

function ymdCells(ymd: string): string {
  const { y, m, d } = splitYmd(ymd);
  if (!y) return "＿＿＿＿年　　月　　日";
  return `${esc(y)}　年　${esc(m)}　月　${esc(d)}　日`;
}

function ymdCellsBlank(): string {
  return "＿＿＿＿年　　月　　日";
}

function buildOneSheet(emp: Employee, ctx: { createdYmd: string; operatorName: string }): string {
  const ext = asExt(emp.registerExtension);
  const furigana = emp.furigana?.trim() ?? "";
  const fullName = `${emp.familyName}　${emp.givenName}`.trim();
  const gender = normalizeGender(ext);
  const birth = extStr(ext, "birthDate");
  const hired = extStr(ext, "hiredOn");
  const retiredExt = extStr(ext, "retiredOn");
  const retiredYmd =
    retiredExt.trim() !== ""
      ? retiredExt
      : emp.retiredAt
        ? ymdFromDbDate(emp.retiredAt)
        : "";
  const ageHire = ageAtHireYears(birth, hired);
  const addr = emp.address?.trim() ?? "";
  const { zip, body } = splitPostalLine(addr);
  const phone = extStr(ext, "phone");
  const mobile = extStr(ext, "mobile");
  const emName = extStr(ext, "emergencyName");
  const emTel = extStr(ext, "emergencyTel");
  const licKind = extStr(ext, "licenseKind");
  const licExp = extStr(ext, "licenseExpiresOn");
  const licCond = licenseConditionsText(ext);
  const hasCond = licCond.length > 0;
  const front = safeDataUrlImg(extStr(ext, "licensePhotoFrontDataUrl"));
  const back = safeDataUrlImg(extStr(ext, "licensePhotoBackDataUrl"));

  const mark = (which: "男" | "女") => (gender === which ? "（●）" : "（　）");

  return `<article class="pd-doc rs-doc">
<div class="pd-doc-head rs-top">
  <p class="pd-retention">〈保存期間：退職日から2年間〉</p>
  <table class="pd-meta-dates" role="presentation">
    <tr>
      <td class="pd-md-lbl">作成日</td>
      <td class="pd-md-val">${ymdCells(ctx.createdYmd)}</td>
      <td class="pd-md-lbl">修正日</td>
      <td class="pd-md-val">${ymdCellsBlank()}</td>
    </tr>
  </table>
</div>
<div class="pd-title-wrap">
  <h1 class="pd-title">従事者名簿</h1>
  <div class="pd-title-rule" aria-hidden="true"></div>
</div>
${ctx.operatorName ? `<p class="pd-subtitle">${esc(ctx.operatorName)}</p>` : ""}

<table class="pd-table rs-grid">
  <tbody>
  <tr>
    <td class="pd-label-cell" rowspan="2">氏名</td>
    <td colspan="3" class="rs-name-block">
      <div class="rs-furi-row">
        <span class="rs-furi-lbl">ふりがな</span>
        <div class="rs-furi-val">${furigana ? esc(furigana) : "　"}</div>
      </div>
      <div class="rs-name-main">${esc(fullName)}</div>
    </td>
    <td class="pd-label-cell">性別</td>
    <td class="pd-center rs-gender">
      <span class="rs-g-line"><span>${mark("男")}</span>男</span>
      <span class="rs-g-sep">・</span>
      <span class="rs-g-line"><span>${mark("女")}</span>女</span>
    </td>
    <td class="pd-label-cell">生年月日</td>
    <td class="rs-date">${ymdCells(birth)}</td>
  </tr>
  <tr>
    <td colspan="3" class="rs-spacer"></td>
    <td class="pd-label-cell" colspan="2">採用時年齢</td>
    <td colspan="2" class="pd-center rs-date">満　${esc(ageHire || "　　")}　歳</td>
  </tr>
  <tr>
    <td class="pd-label-cell">住所</td>
    <td colspan="7" class="rs-address">〒　${esc(zip)}　${esc(body)}</td>
  </tr>
  <tr>
    <td class="pd-label-cell" rowspan="2">連絡先</td>
    <td class="pd-label-cell rs-label-narrow">自宅</td>
    <td colspan="6" class="rs-tel">（　${esc(phone)}　）</td>
  </tr>
  <tr>
    <td class="pd-label-cell rs-label-narrow">携帯</td>
    <td colspan="6" class="rs-tel">（　${esc(mobile)}　）</td>
  </tr>
  <tr>
    <td class="pd-label-cell">緊急<br/>連絡先</td>
    <td colspan="7" class="rs-em-wrap">
      <div class="rs-em-stack">
        <div class="rs-em-row">
          <div class="rs-em-cell">氏名</div>
          <div class="rs-em-cell rs-em-val">（${esc(emName)}）</div>
        </div>
        <div class="rs-em-row">
          <div class="rs-em-cell">電話番号</div>
          <div class="rs-em-cell rs-em-val">（${esc(emTel)}）</div>
        </div>
      </div>
    </td>
  </tr>
  <tr>
    <td class="pd-label-cell">採用<br/>年月日</td>
    <td colspan="3" class="pd-center rs-date">${ymdCells(hired)}</td>
    <td class="pd-label-cell">退職<br/>年月日</td>
    <td colspan="3" class="pd-center rs-date">${ymdCells(retiredYmd)}</td>
  </tr>
  <tr>
    <td class="pd-label-cell pd-vertical" rowspan="3">運転免許</td>
    <td class="pd-label-cell" colspan="2">種類</td>
    <td colspan="5" class="rs-lic">${esc(licKind)}</td>
  </tr>
  <tr>
    <td class="pd-label-cell" colspan="2">有効期限</td>
    <td colspan="6" class="pd-center rs-date">${ymdCells(licExp)}</td>
  </tr>
  <tr>
    <td class="pd-label-cell" colspan="2">免許条件<br/>・限定等</td>
    <td colspan="6" class="rs-lic rs-lic-cond">${hasCond ? `あり（ ${esc(licCond)} ）・なし（　　）` : "あり（　　　　　　　）・なし（　●　）"}</td>
  </tr>
  <tr>
    <td class="rs-photo-cap" colspan="4">運転免許証（表）</td>
    <td class="rs-photo-cap" colspan="4">運転免許証（裏）</td>
  </tr>
  <tr>
    <td class="rs-photo" colspan="4"><div class="rs-photo-box">${front ? `<img src="${escAttr(front)}" alt=""/>` : ""}</div></td>
    <td class="rs-photo" colspan="4"><div class="rs-photo-box">${back ? `<img src="${escAttr(back)}" alt=""/>` : ""}</div></td>
  </tr>
  </tbody>
</table>
</article>`;
}

export function buildEmployeeRosterPrintHtml(args: {
  employees: Employee[];
  printedAt: Date;
  operatorName?: string | null;
}): string {
  const createdYmd = ymdTokyo(args.printedAt);
  const op = (args.operatorName ?? "").trim();
  const sheets =
    args.employees.length === 0
      ? `<article class="pd-doc rs-doc"><p class="rs-empty">印刷対象の従業員がありません。</p></article>`
      : args.employees.map((e) => buildOneSheet(e, { createdYmd, operatorName: op })).join("\n");

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>従事者名簿</title>
<style>${ROSTER_CSS}</style>
</head><body class="pd-body">
<div class="pd-toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${sheets}
<p class="pd-hint no-print">ブラウザの印刷ダイアログから PDF 保存できます。</p>
</body></html>`;
}
