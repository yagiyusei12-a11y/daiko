/** 従事者名簿（印刷用 HTML）。A4 縦向き・枠付きビジネス様式。 */

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
@page { size: A4 portrait; margin: 12mm 14mm; }
.er-doc {
  width: 182mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  color: var(--pd-ink);
}
.er-doc .er-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 3mm;
}
.er-doc .er-retention {
  margin: 0;
  font-size: 7.5pt;
  color: var(--pd-muted);
  flex: 1;
  min-width: 0;
}
.er-doc .er-dates {
  border-collapse: collapse;
  font-size: 8.5pt;
  border: 1px solid var(--pd-line-strong);
  flex-shrink: 0;
}
.er-doc .er-dates td {
  border: 1px solid var(--pd-line-strong);
  padding: 4px 8px;
  vertical-align: middle;
}
.er-doc .er-dates .er-dl {
  background: var(--pd-fill-label);
  font-weight: 700;
  text-align: center;
  white-space: nowrap;
}
.er-doc .er-dates .er-dv {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.er-doc .er-title {
  margin: 0 0 4mm;
  text-align: center;
  font-size: 18pt;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-indent: 0.28em;
}
.er-doc .er-tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1.5px solid var(--pd-line-strong);
  margin: 0;
}
.er-doc .er-tbl th,
.er-doc .er-tbl td {
  border: 1px solid var(--pd-line-strong);
  padding: 4px 6px;
  vertical-align: middle;
  font-size: 9pt;
}
.er-doc .er-lbl {
  background: var(--pd-fill-label);
  font-weight: 700;
  text-align: center;
  color: var(--pd-ink);
  font-size: 8.5pt;
  line-height: 1.3;
}
.er-doc .er-val {
  background: #fff;
  color: var(--pd-ink);
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.er-doc .er-v {
  writing-mode: vertical-rl;
  text-orientation: upright;
  width: 1.55rem;
  min-width: 1.45rem;
  letter-spacing: 0.12em;
  padding: 6px 2px !important;
  font-size: 8.5pt;
}
.er-doc .er-narrow { width: 3.6rem; }
.er-doc .er-name-wrap { padding: 0 !important; vertical-align: top; }
.er-doc .er-furi {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 8px 4px;
  border-bottom: 1px dashed var(--pd-line);
}
.er-doc .er-furi-l {
  font-size: 8pt;
  font-weight: 700;
  color: var(--pd-muted);
  white-space: nowrap;
}
.er-doc .er-furi-v { flex: 1; min-width: 0; font-size: 9pt; }
.er-doc .er-name-big {
  padding: 6px 8px 8px;
  font-size: 13pt;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.er-doc .er-spacer { height: 5px; background: #f9fafb; }
.er-doc .er-c { text-align: center; }
.er-doc .er-g {
  font-size: 8.5pt;
  white-space: nowrap;
  text-align: center;
}
.er-doc .er-date {
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 9pt;
}
.er-doc .er-em {
  padding: 6px 8px !important;
}
.er-doc .er-em table { width: 100%; border-collapse: collapse; }
.er-doc .er-em td { border: none; padding: 3px 0; vertical-align: baseline; }
.er-doc .er-em .er-em-l { width: 5em; font-weight: 700; font-size: 8.5pt; color: var(--pd-muted); }
.er-doc .er-photo-cap {
  background: var(--pd-fill-label);
  font-weight: 700;
  text-align: center;
  font-size: 8.5pt;
  padding: 5px !important;
}
.er-doc .er-photo-cell {
  height: 118px;
  vertical-align: middle;
  padding: 6px !important;
}
.er-doc .er-photo-box {
  height: 104px;
  border: 1px dashed var(--pd-line-strong);
  background: #fafafa;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 8pt;
  color: var(--pd-muted);
  line-height: 1.5;
}
.er-doc .er-photo-box img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.er-empty {
  padding: 36px 16px;
  text-align: center;
  color: var(--pd-muted);
  border: 1px solid var(--pd-line-strong);
}
`;

function ymdCells(ymd: string): string {
  const { y, m, d } = splitYmd(ymd);
  if (!y) return "＿＿＿＿年　　月　　日";
  return `${esc(y)}　年　${esc(m)}　月　${esc(d)}　日`;
}

function ymdCellsBlank(): string {
  return "＿＿＿＿年　　月　　日";
}

function buildOneSheet(emp: Employee, ctx: { createdYmd: string }): string {
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
  const licNum = extStr(ext, "licenseNumber");
  const licExp = extStr(ext, "licenseExpiresOn");
  const licCond = licenseConditionsText(ext);
  const hasCond = licCond.length > 0;
  const front = safeDataUrlImg(extStr(ext, "licensePhotoFrontDataUrl"));
  const back = safeDataUrlImg(extStr(ext, "licensePhotoBackDataUrl"));

  const mark = (which: "男" | "女") => (gender === which ? "（●）" : "（　）");

  return `<article class="pd-doc er-doc">
<div class="er-head">
  <p class="er-retention">〈保存期間：退職日から2年間〉</p>
  <table class="er-dates" role="presentation">
    <tr>
      <td class="er-dl">作成日</td>
      <td class="er-dv">${ymdCells(ctx.createdYmd)}</td>
      <td class="er-dl">修正日</td>
      <td class="er-dv">${ymdCellsBlank()}</td>
    </tr>
  </table>
</div>
<h1 class="er-title">従事者名簿</h1>

<table class="er-tbl">
  <tbody>
  <tr>
    <td class="er-lbl" rowspan="2">氏名</td>
    <td colspan="3" class="er-val er-name-wrap">
      <div class="er-furi"><span class="er-furi-l">フリガナ</span><div class="er-furi-v">${furigana ? esc(furigana) : "　"}</div></div>
      <div class="er-name-big">${esc(fullName)}</div>
    </td>
    <td class="er-lbl">男女</td>
    <td class="er-val er-g">
      <span>${mark("男")}</span>男　<span>${mark("女")}</span>女
    </td>
    <td class="er-lbl">生年月日</td>
    <td class="er-val er-date">${ymdCells(birth)}</td>
  </tr>
  <tr>
    <td colspan="3" class="er-spacer"></td>
    <td class="er-lbl" colspan="2">採用時年齢</td>
    <td class="er-val er-c er-date" colspan="2">満　${esc(ageHire || "　　")}　歳</td>
  </tr>
  <tr>
    <td class="er-lbl">住所</td>
    <td class="er-val" colspan="7">〒　${esc(zip)}　${esc(body)}</td>
  </tr>
  <tr>
    <td class="er-lbl" rowspan="2">連絡先</td>
    <td class="er-lbl er-narrow">自宅</td>
    <td class="er-val" colspan="6">（　${esc(phone)}　）</td>
  </tr>
  <tr>
    <td class="er-lbl er-narrow">携帯</td>
    <td class="er-val" colspan="6">（　${esc(mobile)}　）</td>
  </tr>
  <tr>
    <td class="er-lbl">緊急<br/>連絡先</td>
    <td class="er-val er-em" colspan="7">
      <table role="presentation">
        <tr><td class="er-em-l">氏名</td><td>（　${esc(emName)}　）</td></tr>
        <tr><td class="er-em-l">電話番号</td><td>（　${esc(emTel)}　）</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td class="er-lbl">採用<br/>年月日</td>
    <td class="er-val er-date" colspan="3">${ymdCells(hired)}</td>
    <td class="er-lbl">退職<br/>年月日</td>
    <td class="er-val er-date" colspan="3">${ymdCells(retiredYmd)}</td>
  </tr>
  <tr>
    <td class="er-lbl er-v" rowspan="4">運転免許</td>
    <td class="er-lbl" colspan="2">種類</td>
    <td class="er-val" colspan="5">${esc(licKind)}</td>
  </tr>
  <tr>
    <td class="er-lbl" colspan="2">番号</td>
    <td class="er-val" colspan="5">第　${esc(licNum)}　号</td>
  </tr>
  <tr>
    <td class="er-lbl" colspan="2">有効期限</td>
    <td class="er-val er-date" colspan="5">${ymdCells(licExp)}</td>
  </tr>
  <tr>
    <td class="er-lbl" colspan="2">免許条件<br/>・限定等</td>
    <td class="er-val" colspan="5">${hasCond ? `あり（ ${esc(licCond)} ）・なし（　　）` : "あり（　　　　　　　）・なし（　●　）"}</td>
  </tr>
  <tr>
    <td class="er-photo-cap" colspan="4">運転免許証　表</td>
    <td class="er-photo-cap" colspan="4">運転免許証　裏</td>
  </tr>
  <tr>
    <td class="er-photo-cell" colspan="4">
      <div class="er-photo-box">${front ? `<img src="${escAttr(front)}" alt="免許証表面"/>` : "運転免許証　表<br/>（写しを貼付）"}</div>
    </td>
    <td class="er-photo-cell" colspan="4">
      <div class="er-photo-box">${back ? `<img src="${escAttr(back)}" alt="免許証裏面"/>` : "運転免許証　裏<br/>（写しを貼付）"}</div>
    </td>
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
  const sheets =
    args.employees.length === 0
      ? `<article class="pd-doc er-doc"><p class="er-empty">印刷対象の従業員がありません。</p></article>`
      : args.employees.map((e) => buildOneSheet(e, { createdYmd })).join("\n");

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
