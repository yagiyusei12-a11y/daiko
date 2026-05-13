/** 従事者名簿（印刷用 HTML）。Excel 様式に準拠したレイアウト。 */

import type { Employee } from "@prisma/client";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** img の src 用（data URL 等。& と " のみエスケープ） */
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

const PRINT_CSS = `
@page { size: A4; margin: 10mm; }
@media print {
  .no-print { display: none !important; }
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
body {
  font-family: "MS P Gothic","MS PGothic","Yu Gothic","Meiryo",sans-serif;
  font-size: 10.5pt;
  color: #000;
  margin: 0;
  padding: 8px 10px;
}
.toolbar { margin-bottom: 8px; }
.toolbar button { padding: 6px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.sheet {
  max-width: 185mm;
  margin: 0 auto 0;
  page-break-after: always;
  border: 2px solid #000;
  padding: 8px 10px 10px;
  box-sizing: border-box;
}
.sheet:last-of-type { page-break-after: auto; }
.rtop { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 4px; }
.rret { font-size: 9pt; text-align: right; flex: 1; }
.rdates { border-collapse: collapse; font-size: 9pt; }
.rdates td, .rdates th { border: 1px solid #000; padding: 2px 6px; vertical-align: middle; }
.rdates .dl { background: #d7e4f7; font-weight: bold; text-align: center; white-space: nowrap; }
.rtitle {
  text-align: center;
  font-size: 16pt;
  font-weight: bold;
  letter-spacing: 0.35em;
  margin: 6px 0 10px;
  text-indent: 0.35em;
}
.rf {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 2px solid #000;
}
.rf td, .rf th {
  border: 1px solid #000;
  padding: 4px 5px;
  vertical-align: middle;
  font-size: 10pt;
}
.rf .L {
  background: #d7e4f7;
  font-weight: bold;
  text-align: center;
  width: 5.5em;
}
.rf .Lwide { background: #d7e4f7; font-weight: bold; text-align: center; width: 7em; }
.rf .Lvert {
  background: #d7e4f7;
  font-weight: bold;
  text-align: center;
  writing-mode: vertical-rl;
  text-orientation: upright;
  width: 1.8em;
  letter-spacing: 0.15em;
  padding: 6px 2px;
}
.rf .fg { font-size: 9pt; border-bottom: 1px dashed #999; min-height: 1.3em; padding: 2px 4px; }
.rf .nm { font-size: 11pt; min-height: 1.6em; padding: 4px; }
.rf .cen { text-align: center; }
.rf .photo { height: 130px; vertical-align: top; padding: 4px; }
.rf .photobox {
  border: 1px dashed #555;
  height: 118px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fafafa;
  box-sizing: border-box;
}
.rf .photobox img { max-width: 100%; max-height: 100%; object-fit: contain; }
.rf .phlbl { background: #d7e4f7; font-weight: bold; text-align: center; font-size: 9.5pt; }
.cen { text-align: center; }
.empty-note { padding: 16px; text-align: center; color: #444; }
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
  const emRel = extStr(ext, "emergencyRelation");
  const emTel = extStr(ext, "emergencyTel");
  const licKind = extStr(ext, "licenseKind");
  const licNum = extStr(ext, "licenseNumber");
  const licExp = extStr(ext, "licenseExpiresOn");
  const licCond = licenseConditionsText(ext);
  const hasCond = licCond.length > 0;
  const front = safeDataUrlImg(extStr(ext, "licensePhotoFrontDataUrl"));
  const back = safeDataUrlImg(extStr(ext, "licensePhotoBackDataUrl"));

  const mark = (which: "男" | "女") => (gender === which ? "（●）" : "（　）");

  return `<section class="sheet">
<div class="rtop">
  <div class="rret">〈保存期間：退職日から2年間〉</div>
  <table class="rdates">
    <tr>
      <td class="dl">作成日</td>
      <td>${ymdCells(ctx.createdYmd)}</td>
      <td class="dl">修正日</td>
      <td>${ymdCellsBlank()}</td>
    </tr>
  </table>
</div>
<h1 class="rtitle">従　事　者　名　簿</h1>
${ctx.operatorName ? `<p class="cen" style="margin:-4px 0 8px;font-size:9.5pt">${esc(ctx.operatorName)}</p>` : ""}

<table class="rf">
  <tr>
    <td class="L" rowspan="2">氏名</td>
    <td colspan="3" style="padding:0;vertical-align:top">
      <div class="fg">${furigana ? esc(furigana) : "（　　　　　　　　　　　　　　　　　　　　　　　　　）"}</div>
      <div class="nm">${esc(fullName)}</div>
    </td>
    <td class="L">性別</td>
    <td class="cen">${mark("男")}男　・　${mark("女")}女</td>
    <td class="L">生年月日</td>
    <td class="cen">${ymdCells(birth)}</td>
  </tr>
  <tr>
    <td colspan="3"></td>
    <td class="L" colspan="2">採用時年齢</td>
    <td colspan="2" class="cen">満　${esc(ageHire || "　　")}　歳</td>
  </tr>
  <tr>
    <td class="L">住所</td>
    <td colspan="7">〒　${esc(zip)}　${esc(body)}</td>
  </tr>
  <tr>
    <td class="L" rowspan="2">連絡先</td>
    <td class="Lwide" colspan="1">自宅</td>
    <td colspan="6">（　${esc(phone)}　）</td>
  </tr>
  <tr>
    <td class="Lwide">携帯</td>
    <td colspan="6">（　${esc(mobile)}　）</td>
  </tr>
  <tr>
    <td class="L">緊急<br/>連絡先</td>
    <td colspan="7">氏名　（　${esc(emName)}　）　続柄　（　${esc(emRel)}　）　電話番号　（　${esc(emTel)}　）</td>
  </tr>
  <tr>
    <td class="L">採用<br/>年月日</td>
    <td colspan="3" class="cen">${ymdCells(hired)}</td>
    <td class="L">退職<br/>年月日</td>
    <td colspan="3" class="cen">${ymdCells(retiredYmd)}</td>
  </tr>
  <tr>
    <td class="Lvert" rowspan="3">運転免許</td>
    <td class="L" colspan="2">種類</td>
    <td colspan="5">${esc(licKind)}</td>
  </tr>
  <tr>
    <td class="L" colspan="2">番号</td>
    <td colspan="2">第　${esc(licNum)}　号</td>
    <td class="L">有効期限</td>
    <td colspan="2" class="cen">${ymdCells(licExp)}</td>
  </tr>
  <tr>
    <td class="L" colspan="2">免許条件<br/>・限定等</td>
    <td colspan="5">${hasCond ? `あり（ ${esc(licCond)} ）・なし（　　）` : "あり（　　　　　　　）・なし（　●　）"}</td>
  </tr>
  <tr>
    <td class="phlbl" colspan="4">運転免許証表</td>
    <td class="phlbl" colspan="4">運転免許証裏</td>
  </tr>
  <tr>
    <td class="photo" colspan="4">
      <div class="photobox">${front ? `<img src="${escAttr(front)}" alt=""/>` : ""}</div>
    </td>
    <td class="photo" colspan="4">
      <div class="photobox">${back ? `<img src="${escAttr(back)}" alt=""/>` : ""}</div>
    </td>
  </tr>
</table>
</section>`;
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
      ? `<section class="sheet"><p class="empty-note">印刷対象の従業員がありません。</p></section>`
      : args.employees.map((e) => buildOneSheet(e, { createdYmd, operatorName: op })).join("\n");

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>従事者名簿</title>
<style>${PRINT_CSS}</style>
</head><body>
<div class="toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${sheets}
<p class="no-print" style="text-align:center;font-size:10px;color:#444;margin-top:8px">ブラウザの印刷ダイアログから PDF 保存できます。</p>
</body></html>`;
}
