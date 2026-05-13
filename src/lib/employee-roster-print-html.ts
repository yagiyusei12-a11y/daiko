/** 従事者名簿（印刷用 HTML）。様式は一般的な従事者名簿のレイアウトに準拠。 */

import type { Employee } from "@prisma/client";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

/** Asia/Tokyo の暦日 YYYY-MM-DD */
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

/** 生年月日・採用日から「採用時年齢」（満年齢、採用日時点） */
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
  font-family: "MS Mincho","Yu Mincho","Noto Serif JP",serif;
  font-size: 11px;
  color: #000;
  margin: 0;
  padding: 10px;
}
.toolbar { margin-bottom: 8px; }
.toolbar button { padding: 6px 12px; font-size: 12px; cursor: pointer; font-family: inherit; }
.sheet {
  max-width: 720px;
  margin: 0 auto 0;
  page-break-after: always;
}
.sheet:last-of-type { page-break-after: auto; }
.head-meta {
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 4px;
  font-size: 10px;
}
.retention { text-align: right; white-space: nowrap; }
.title-block { text-align: center; margin: 0 0 8px; position: relative; }
.title-block h1 {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
  letter-spacing: 0.12em;
}
.sub-operator { text-align: center; font-size: 10px; margin: 2px 0 6px; color: #222; }
table.form { border-collapse: collapse; width: 100%; table-layout: fixed; }
table.form th, table.form td {
  border: 1px solid #000;
  padding: 4px 5px;
  vertical-align: middle;
  word-break: break-word;
}
table.form th.lbl, td.lbl {
  background: #d9e8f7;
  font-weight: 600;
  text-align: center;
  width: 6.5em;
}
td.lbl-narrow { background: #d9e8f7; font-weight: 600; text-align: center; width: 3em; }
.t-center { text-align: center; }
.t-right { text-align: right; }
.ymd-parts span { display: inline-block; min-width: 2.2em; text-align: center; }
.gender-mark { letter-spacing: 0.5em; }
.license-photo-row td { height: 120px; vertical-align: top; padding: 4px; }
.license-photo-box {
  border: 1px dashed #666;
  height: 108px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #fafafa;
}
.license-photo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
.empty-note { color: #555; font-size: 11px; padding: 24px 8px; text-align: center; }
`;

function ymdCells(ymd: string): string {
  const { y, m, d } = splitYmd(ymd);
  if (!y) return '<span class="ymd-parts">　　年　　月　　日</span>';
  return `<span class="ymd-parts"><span>${esc(y)}</span> 年 <span>${esc(m)}</span> 月 <span>${esc(d)}</span> 日</span>`;
}

function ymdCellsBlank(): string {
  return '<span class="ymd-parts">＿＿＿＿年＿＿月＿＿日</span>';
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

  const gMale = gender === "男" ? "✓" : "□";
  const gFemale = gender === "女" ? "✓" : "□";

  return `<section class="sheet">
<div class="head-meta">
  <div>
    <table class="form" style="width:auto;margin-left:auto;border:none;">
      <tr>
        <td class="lbl" style="width:4.5em;border:1px solid #000;">作成日</td>
        <td style="border:1px solid #000;min-width:12em;">${ymdCells(ctx.createdYmd)}</td>
        <td class="lbl" style="width:4.5em;border:1px solid #000;">修正日</td>
        <td style="border:1px solid #000;min-width:12em;">${ymdCellsBlank()}</td>
      </tr>
    </table>
  </div>
</div>
<div class="title-block">
  <div class="retention">〈保存期間：退職日から2年間〉</div>
  <h1>従事者名簿</h1>
</div>
${ctx.operatorName ? `<p class="sub-operator">${esc(ctx.operatorName)}</p>` : ""}

<table class="form">
  <colgroup><col style="width:14%"/><col style="width:18%"/><col style="width:10%"/><col style="width:12%"/><col style="width:12%"/><col style="width:12%"/><col style="width:22%"/></colgroup>
  <tr>
    <td class="lbl" colspan="2">ふりがな</td>
    <td colspan="5">${esc(furigana)}</td>
  </tr>
  <tr>
    <td class="lbl" colspan="2">氏名</td>
    <td colspan="3">${esc(fullName)}</td>
    <td class="lbl">性別</td>
    <td class="t-center gender-mark">${gMale} 男　　${gFemale} 女</td>
  </tr>
  <tr>
    <td class="lbl" colspan="2">生年月日</td>
    <td colspan="2">${ymdCells(birth)}</td>
    <td class="lbl" colspan="2">採用時年齢</td>
    <td class="t-center">${esc(ageHire)}<span style="margin-left:4px;">歳</span></td>
  </tr>
  <tr>
    <td class="lbl" colspan="2">住所</td>
    <td colspan="5">〒 ${esc(zip)}　${esc(body)}</td>
  </tr>
  <tr>
    <td class="lbl" rowspan="3" colspan="2">連絡先</td>
    <td class="lbl">自宅</td>
    <td colspan="4">${esc(phone)}</td>
  </tr>
  <tr>
    <td class="lbl">携帯</td>
    <td colspan="4">${esc(mobile)}</td>
  </tr>
  <tr>
    <td class="lbl" colspan="5" style="text-align:left;padding-left:6px;"><strong>緊急連絡先</strong>　氏名 ${esc(emName)}　　続柄 ${esc(emRel)}　　電話 ${esc(emTel)}</td>
  </tr>
  <tr>
    <td class="lbl" colspan="2">採用年月日</td>
    <td colspan="2">${ymdCells(hired)}</td>
    <td class="lbl" colspan="2">退職年月日</td>
    <td>${ymdCells(retiredYmd)}</td>
  </tr>
  <tr>
    <td class="lbl" rowspan="2" colspan="2">運転免許</td>
    <td class="lbl">種類</td>
    <td colspan="2">${esc(licKind)}</td>
    <td class="lbl">番号</td>
    <td>第 ${esc(licNum)} 号</td>
  </tr>
  <tr>
    <td class="lbl">有効期限</td>
    <td colspan="2">${ymdCells(licExp)}</td>
    <td class="lbl">免許条件<br/>・限定等</td>
    <td>${hasCond ? `あり（${esc(licCond)}）` : "なし"}</td>
  </tr>
  <tr class="license-photo-row">
    <td class="lbl" colspan="3">運転免許証（表）</td>
    <td class="lbl" colspan="4">運転免許証（裏）</td>
  </tr>
  <tr class="license-photo-row">
    <td colspan="3">
      <div class="license-photo-box">${front ? `<img src="${esc(front)}" alt=""/>` : ""}</div>
    </td>
    <td colspan="4">
      <div class="license-photo-box">${back ? `<img src="${esc(back)}" alt=""/>` : ""}</div>
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
      ? `<section class="sheet"><p class="empty-note">印刷対象の従業員がありません（在籍のみ印刷する場合は、設定で従業員を登録してください）。</p></section>`
      : args.employees.map((e) => buildOneSheet(e, { createdYmd, operatorName: op })).join("\n");

  return `<!DOCTYPE html><html lang="ja"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>従事者名簿</title>
<style>${PRINT_CSS}</style>
</head><body>
<div class="toolbar no-print"><button type="button" onclick="window.print()">印刷</button></div>
${sheets}
<p class="no-print" style="text-align:center;font-size:10px;color:#444;margin-top:8px;">ブラウザの印刷ダイアログから PDF 保存できます。</p>
</body></html>`;
}
