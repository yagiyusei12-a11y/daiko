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
@page { size: A4 portrait; margin: 10mm 12mm; }
@media print {
  .no-print { display: none !important; }
  body {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
    background: #fff !important;
    padding: 0 !important;
  }
  .sheet {
    box-shadow: none !important;
    border-radius: 0 !important;
  }
}
@media screen {
  body {
    background: linear-gradient(165deg, #f1f5f9 0%, #e2e8f0 50%, #f8fafc 100%);
    min-height: 100vh;
  }
}
body {
  font-family: "MS PMincho","ＭＳ Ｐ明朝","MS P Gothic","MS PGothic","Yu Gothic","Meiryo",sans-serif;
  font-size: 10.5pt;
  color: #334155;
  margin: 0;
  padding: 12px 14px 20px;
  box-sizing: border-box;
  line-height: 1.45;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.toolbar { margin-bottom: 10px; }
.toolbar button {
  padding: 8px 16px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid #334155;
  border-radius: 4px;
  background: #1e293b;
  color: #f8fafc;
}
.toolbar button:hover { background: #334155; }
.sheet {
  max-width: 186mm;
  margin: 0 auto 16px;
  page-break-after: always;
  border: 1px solid #64748b;
  padding: 12px 14px 14px;
  box-sizing: border-box;
  background: #fff;
  border-radius: 2px;
  box-shadow: 0 1px 3px rgba(15,23,42,.06), 0 8px 20px rgba(15,23,42,.05);
}
.sheet:last-of-type { page-break-after: auto; }
.rtop {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px 12px;
  margin-bottom: 8px;
}
.rret {
  font-size: 8.5pt;
  text-align: left;
  color: #64748b;
  letter-spacing: 0.02em;
  flex: 0 1 auto;
  max-width: min(100%, 22em);
}
.rdates { border-collapse: collapse; font-size: 9pt; flex: 0 0 auto; margin-left: auto; }
.rdates td, .rdates th {
  border: 1px solid #cbd5e1;
  padding: 5px 10px;
  vertical-align: middle;
}
.rdates .dl {
  background: linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  color: #1e293b;
}
.rdates .rd-val { white-space: nowrap; color: #0f172a; }
.rtitle {
  text-align: center;
  font-size: 15pt;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-indent: 0.28em;
  margin: 4px 0 10px;
  color: #0f172a;
  font-feature-settings: "palt";
}
.r-subtitle {
  margin: -2px 0 10px;
  font-size: 9.5pt;
  color: #475569;
}
.rf {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid #64748b;
}
.rf td, .rf th {
  border: 1px solid #cbd5e1;
  padding: 7px 8px;
  vertical-align: middle;
  font-size: 10pt;
}
.rf .L {
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  font-weight: 600;
  text-align: center;
  width: 5.8em;
  min-width: 4.8em;
  color: #1e293b;
  white-space: nowrap;
}
.rf .Lwide {
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  font-weight: 600;
  text-align: center;
  width: 4.5em;
  min-width: 3.5em;
  white-space: nowrap;
  color: #1e293b;
}
.rf .Lvert {
  background: linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%);
  font-weight: 600;
  text-align: center;
  writing-mode: vertical-rl;
  text-orientation: upright;
  width: 2em;
  min-width: 1.6em;
  letter-spacing: 0.12em;
  padding: 8px 4px;
  color: #1e293b;
  border-right-color: #94a3b8;
}
.cell-nameblock { padding: 0 !important; vertical-align: middle; }
.fg-wrap {
  display: flex;
  align-items: flex-end;
  gap: 0.45em;
  padding: 6px 8px 4px;
  border-bottom: 1px dashed #cbd5e1;
}
.fg-lbl {
  font-size: 8.5pt;
  color: #64748b;
  white-space: nowrap;
  flex-shrink: 0;
  font-weight: 600;
  line-height: 1.2;
}
.fg-line {
  flex: 1;
  min-width: 0;
  min-height: 1.35em;
  font-size: 9pt;
  color: #334155;
  line-height: 1.35;
}
.rf .nm {
  font-size: 11pt;
  min-height: 1.45em;
  padding: 6px 8px 7px;
  color: #0f172a;
  line-height: 1.4;
}
.cell-spacer { min-height: 0.5em; background: #fafafa; }
.cell-gender {
  white-space: nowrap;
  padding: 6px 4px !important;
}
.gender-line { display: inline-flex; align-items: baseline; gap: 0.08em; }
.g-mark { letter-spacing: 0; }
.g-lbl { font-weight: 500; }
.g-sep { margin: 0 0.35em; color: #94a3b8; }
.cell-date { white-space: nowrap; font-variant-numeric: tabular-nums; color: #0f172a; }
.cell-age { white-space: nowrap; }
.cell-address { line-height: 1.5; padding: 8px 10px !important; color: #0f172a; }
.addr-body { display: inline; }
.cell-tel { padding: 7px 10px !important; white-space: nowrap; color: #0f172a; }
.cell-emergency {
  padding: 8px 10px !important;
  vertical-align: middle;
  color: #0f172a;
}
.em-stacked { display: flex; flex-direction: column; gap: 6px; }
.em-line {
  display: flex;
  align-items: baseline;
  flex-wrap: nowrap;
  gap: 0.2em;
  line-height: 1.45;
}
.em-lbl { font-weight: 600; color: #475569; flex-shrink: 0; white-space: nowrap; }
.em-parens { color: #94a3b8; flex-shrink: 0; }
.em-body { flex: 1; min-width: 0; word-break: break-word; overflow-wrap: anywhere; }
.cell-lic {
  line-height: 1.45;
  padding: 8px 10px !important;
  vertical-align: middle;
  text-align: left;
}
.cell-lic-cond {
  line-height: 1.5;
  padding: 8px 10px !important;
  vertical-align: middle;
  word-break: break-word;
  overflow-wrap: break-word;
}
.rf .cen { text-align: center; }
.rf .photo { height: 128px; vertical-align: top; padding: 6px; }
.rf .photobox {
  border: 1px dashed #94a3b8;
  height: 116px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8fafc;
  box-sizing: border-box;
  border-radius: 2px;
}
.rf .photobox img { max-width: 100%; max-height: 100%; object-fit: contain; }
.rf .phlbl {
  background: linear-gradient(180deg, #f1f5f9 0%, #e8edf3 100%);
  font-weight: 600;
  text-align: center;
  font-size: 9.5pt;
  color: #1e293b;
}
.cen { text-align: center; }
.empty-note { padding: 20px; text-align: center; color: #64748b; }
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

  return `<section class="sheet">
<div class="rtop">
  <div class="rret">〈保存期間：退職日から2年間〉</div>
  <table class="rdates">
    <tr>
      <td class="dl">作成日</td>
      <td class="rd-val">${ymdCells(ctx.createdYmd)}</td>
      <td class="dl">修正日</td>
      <td class="rd-val">${ymdCellsBlank()}</td>
    </tr>
  </table>
</div>
<h1 class="rtitle">従　事　者　名　簿</h1>
${ctx.operatorName ? `<p class="r-subtitle cen">${esc(ctx.operatorName)}</p>` : ""}

<table class="rf">
  <tr>
    <td class="L" rowspan="2">氏名</td>
    <td colspan="3" class="cell-nameblock">
      <div class="fg-wrap">
        <span class="fg-lbl">ふりがな</span>
        <div class="fg-line">${furigana ? esc(furigana) : "　"}</div>
      </div>
      <div class="nm">${esc(fullName)}</div>
    </td>
    <td class="L">性別</td>
    <td class="cen cell-gender">
      <span class="gender-line"><span class="g-mark">${mark("男")}</span><span class="g-lbl">男</span></span>
      <span class="g-sep">・</span>
      <span class="gender-line"><span class="g-mark">${mark("女")}</span><span class="g-lbl">女</span></span>
    </td>
    <td class="L">生年月日</td>
    <td class="cen cell-date">${ymdCells(birth)}</td>
  </tr>
  <tr>
    <td colspan="3" class="cell-spacer"></td>
    <td class="L" colspan="2">採用時年齢</td>
    <td colspan="2" class="cen cell-age">満　${esc(ageHire || "　　")}　歳</td>
  </tr>
  <tr>
    <td class="L">住所</td>
    <td colspan="7" class="cell-address">〒　${esc(zip)}　<span class="addr-body">${esc(body)}</span></td>
  </tr>
  <tr>
    <td class="L" rowspan="2">連絡先</td>
    <td class="Lwide">自宅</td>
    <td colspan="6" class="cell-tel">（　${esc(phone)}　）</td>
  </tr>
  <tr>
    <td class="Lwide">携帯</td>
    <td colspan="6" class="cell-tel">（　${esc(mobile)}　）</td>
  </tr>
  <tr>
    <td class="L">緊急<br/>連絡先</td>
    <td colspan="7" class="cell-emergency">
      <div class="em-stacked">
        <div class="em-line">
          <span class="em-lbl">氏名</span>
          <span class="em-parens">（</span><span class="em-body">${esc(emName)}</span><span class="em-parens">）</span>
        </div>
        <div class="em-line">
          <span class="em-lbl">電話番号</span>
          <span class="em-parens">（</span><span class="em-body">${esc(emTel)}</span><span class="em-parens">）</span>
        </div>
      </div>
    </td>
  </tr>
  <tr>
    <td class="L">採用<br/>年月日</td>
    <td colspan="3" class="cen cell-date">${ymdCells(hired)}</td>
    <td class="L">退職<br/>年月日</td>
    <td colspan="3" class="cen cell-date">${ymdCells(retiredYmd)}</td>
  </tr>
  <tr>
    <td class="Lvert" rowspan="3">運転免許</td>
    <td class="L" colspan="2">種類</td>
    <td colspan="5" class="cell-lic">${esc(licKind)}</td>
  </tr>
  <tr>
    <td class="L" colspan="2">有効期限</td>
    <td colspan="6" class="cen cell-date">${ymdCells(licExp)}</td>
  </tr>
  <tr>
    <td class="L" colspan="2">免許条件<br/>・限定等</td>
    <td colspan="6" class="cell-lic-cond">${hasCond ? `あり（ ${esc(licCond)} ）・なし（　　）` : "あり（　　　　　　　）・なし（　●　）"}</td>
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
