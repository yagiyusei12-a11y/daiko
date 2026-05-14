/**
 * 従事者名簿（印刷用 HTML） A4 縦
 *
 * レイアウト: 10 列等幅 table
 *  - ラベル色: #BDD7EE（水色）
 *  - 免許番号: 12 桁を 1 文字ずつ格子表示（lic-num-box / lic-d）
 *  - 連絡先: 自宅・携帯を同一行横並び / 緊急連絡先は 2 行目
 *  - 番号行に有効期限を同居
 */

import type { Employee } from "@prisma/client";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  const mat = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!mat) return { y: "", m: "", d: "" };
  return { y: mat[1], m: String(Number(mat[2])), d: String(Number(mat[3])) };
}
function ymdFromDbDate(d: Date): string {
  return ymdTokyo(d);
}
/** "2025-06-15" → "2025年 6月 15日" */
function ymdDisplay(ymd: string): string {
  const { y, m, d } = splitYmd(ymd);
  if (!y) return "";
  return `${esc(y)}年　${esc(m)}月　${esc(d)}日`;
}
function splitPostalLine(addr: string): { zip: string; body: string } {
  const t = addr.trim();
  const mat = t.match(/^(\d{3})[-‐ー]?\s*(\d{4})\s*(.*)$/u);
  if (mat) return { zip: `${mat[1]}${mat[2]}`, body: (mat[3] ?? "").trim() };
  return { zip: "", body: t };
}
function normalizeGender(ext: Record<string, unknown>): "" | "男" | "女" {
  const raw = extStr(ext, "gender") || extStr(ext, "sex");
  const t = raw.trim();
  if (["男", "M", "m", "male", "MALE"].includes(t)) return "男";
  if (["女", "F", "f", "female", "FEMALE"].includes(t)) return "女";
  return "";
}
function safeDataUrlImg(src: string): string {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return "";
  return src;
}

/* ─────────────────────────────────────────────────
   CSS
───────────────────────────────────────────────── */
const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  font-family: "Noto Sans CJK JP","Noto Sans JP","BIZ UDPGothic","BIZ UD Gothic",
               "Hiragino Kaku Gothic ProN","Yu Gothic UI",YuGothic,
               "Meiryo UI",Meiryo,"MS PGothic",sans-serif;
  font-size: 9pt;
  color: #000;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

@page { size: A4 portrait; margin: 12mm 14mm; }

/* ── ページ（1 人 = 1 .er-page） ── */
.er-page { width: 100%; break-after: page; page-break-after: always; }
.er-page:last-child { break-after: auto; page-break-after: auto; }

/* ── タイトル部 ── */
.er-note   { text-align: right; font-size: 7.5pt; margin-bottom: 2mm; }
.er-title  { text-align: center; font-size: 16pt; font-weight: 400; letter-spacing: 0.4em; line-height: 1.4; margin-bottom: 1.5mm; }
.er-cdate  { text-align: right; font-size: 8.5pt; margin-bottom: 3mm; }

/* ── 表本体 ── */
table.er-tbl {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1.5px solid #333;
}
table.er-tbl td {
  border: 1px solid #333;
  padding: 4px 6px;
  vertical-align: middle;
  font-size: 9pt;
  line-height: 1.3;
}
.lbl   { background: #BDD7EE; text-align: center; font-weight: 400; white-space: nowrap; }
.val   { background: #fff; }

/* 縦書き（運転免許） */
.vc {
  writing-mode: vertical-rl;
  text-orientation: upright;
  letter-spacing: 0.2em;
  text-align: center;
  padding: 4px 2px !important;
  font-size: 8.5pt;
}

/* 氏名セル内レイアウト */
.name-cell  { padding: 0 !important; vertical-align: top; }
.name-furi  { display: flex; align-items: baseline; gap: 8px; padding: 3px 6px 2px; border-bottom: 1px dotted #bbb; font-size: 7.5pt; color: #555; }
.name-ftag  { white-space: nowrap; font-size: 7pt; }
.name-main  { padding: 5px 6px 7px; font-size: 12pt; }

/* 住所セル内レイアウト */
.addr-cell  { padding: 0 !important; vertical-align: top; }
.addr-zip   { padding: 3px 6px 2px; font-size: 8pt; border-bottom: 1px dotted #bbb; }
.addr-body  { padding: 4px 6px; }

/* 性別 */
.gv { text-align: center; font-size: 8.5pt; white-space: nowrap; }

/* 免許番号インライン格子 */
.lic-row {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 3px;
}
.lic-num-box { display: inline-flex; border: 1px solid #555; flex-shrink: 0; }
.lic-d {
  width: 1.4em;
  text-align: center;
  padding: 1px 0;
  border-right: 1px solid #555;
  font-size: 8.5pt;
}
.lic-d:last-child { border-right: none; }
.lic-exp        { display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; flex-shrink: 0; }
.lic-exp-lbl    { background: #BDD7EE; padding: 1px 5px; border: 1px solid #333; font-size: 8.5pt; white-space: nowrap; }

/* 写真エリア */
.photo-cap  { background: #BDD7EE; text-align: center; padding: 5px !important; font-size: 9pt; }
.photo-cell { height: 110px; vertical-align: middle; padding: 7px !important; }
.photo-box  {
  width: 100%; height: 94px;
  border: 1px dashed #bbb;
  display: flex; align-items: center; justify-content: center;
  text-align: center; font-size: 8pt; color: #bbb; line-height: 1.6;
}
.photo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }

/* 画面プレビュー */
@media screen {
  body { background: #e5e7eb; padding: 16px; min-width: 200mm; }
  .er-page { background: #fff; margin: 0 auto 32px; max-width: 210mm; padding: 12mm 14mm; box-shadow: 0 2px 12px rgba(0,0,0,.12); }
  .er-page:last-child { margin-bottom: 16px; }
  .no-print { text-align: center; margin-bottom: 12px; }
  .no-print button {
    font: inherit; font-size: 13px; padding: 6px 22px;
    background: #1e3a8a; color: #fff; border: none; border-radius: 4px; cursor: pointer;
  }
}
@media print { .no-print { display: none !important; } }
`;

/* ─────────────────────────────────────────────────
   1 人分の HTML
───────────────────────────────────────────────── */
function buildOneSheet(emp: Employee, ctx: { createdYmd: string }): string {
  const ext      = asExt(emp.registerExtension);
  const furigana = emp.furigana?.trim() ?? "";
  const fullName = `${emp.familyName}　${emp.givenName}`.trim();
  const gender   = normalizeGender(ext);
  const birth    = extStr(ext, "birthDate");
  const hired    = extStr(ext, "hiredOn");
  const retiredE = extStr(ext, "retiredOn");
  const retiredYmd = retiredE.trim() || (emp.retiredAt ? ymdFromDbDate(emp.retiredAt) : "");
  const addr     = emp.address?.trim() ?? "";
  const { zip, body: addrBody } = splitPostalLine(addr);
  const phone    = extStr(ext, "phone");
  const mobile   = extStr(ext, "mobile");
  const emName   = extStr(ext, "emergencyName");
  const emTel    = extStr(ext, "emergencyTel");
  const licKind  = extStr(ext, "licenseKind");
  const licNum   = extStr(ext, "licenseNumber");
  const licExp   = extStr(ext, "licenseExpiresOn");
  const licCond  = licenseConditionsText(ext);
  const hasCond  = licCond.length > 0;
  const front    = safeDataUrlImg(extStr(ext, "licensePhotoFrontDataUrl"));
  const back     = safeDataUrlImg(extStr(ext, "licensePhotoBackDataUrl"));

  const { y: cy, m: cm, d: cd } = splitYmd(ctx.createdYmd);

  /* 性別マーク */
  const gmark =
    gender === "男" ? "●　男　　○　女" :
    gender === "女" ? "○　男　　●　女" :
    "（　）男　（　）女";

  /* 免許番号 12 桁格子 */
  const rawDig = licNum.replace(/\D/g, "").slice(0, 12).split("");
  while (rawDig.length < 12) rawDig.push("");
  const digitCells = rawDig.map(d => `<span class="lic-d">${esc(d)}</span>`).join("");

  /* 郵便番号 */
  const zipStr = zip ? `〒${zip.slice(0, 3)}－${zip.slice(3)}` : "〒";

  /* 免許条件 */
  const condText = hasCond
    ? `あり（　${esc(licCond)}　）・なし`
    : "あり（　　　　　　　）・なし";

  /* 日付ヘルパー（空なら全角スペース） */
  const dsp = (ymd: string) => ymdDisplay(ymd) || "　　　年　　月　　日";

  return `<div class="er-page">
  <p class="er-note">＜保存期間：退職日から２年間＞</p>
  <h1 class="er-title">従 事 者 名 簿</h1>
  <p class="er-cdate">作成日　${esc(cy)}　年　${esc(cm)}　月　${esc(cd)}　日</p>

  <table class="er-tbl">
    <colgroup>
      <col style="width:10%"><col style="width:10%"><col style="width:10%">
      <col style="width:10%"><col style="width:10%"><col style="width:10%">
      <col style="width:10%"><col style="width:10%"><col style="width:10%">
      <col style="width:10%">
    </colgroup>
    <tbody>

      <!-- ─ 氏名 ─ -->
      <tr>
        <td class="lbl">氏名</td>
        <td colspan="4" class="val name-cell">
          <div class="name-furi">
            <span class="name-ftag">フリガナ</span>
            <span>${furigana ? esc(furigana) : ""}</span>
          </div>
          <div class="name-main">${esc(fullName)}</div>
        </td>
        <td class="lbl">男・女</td>
        <td class="val gv">${gmark}</td>
        <td class="lbl">生年月日</td>
        <td colspan="2" class="val">${dsp(birth)}</td>
      </tr>

      <!-- ─ 住所 ─ -->
      <tr>
        <td class="lbl">住所</td>
        <td colspan="9" class="val addr-cell">
          <div class="addr-zip">${zipStr}</div>
          <div class="addr-body">${esc(addrBody)}</div>
        </td>
      </tr>

      <!-- ─ 連絡先（自宅・携帯） ─ -->
      <tr>
        <td class="lbl" rowspan="2">連絡先</td>
        <td class="lbl">自宅</td>
        <td colspan="3" class="val">${esc(phone)}</td>
        <td class="lbl">携帯</td>
        <td colspan="4" class="val">${esc(mobile)}</td>
      </tr>

      <!-- ─ 緊急連絡先 ─ -->
      <tr>
        <td colspan="2" class="lbl">緊急連絡先</td>
        <td class="lbl">氏名</td>
        <td colspan="3" class="val">${esc(emName)}</td>
        <td class="lbl" style="line-height:1.25">電話<br>番号</td>
        <td colspan="2" class="val">${esc(emTel)}</td>
      </tr>

      <!-- ─ 採用・退職 ─ -->
      <tr>
        <td colspan="2" class="lbl">採用年月日</td>
        <td colspan="3" class="val">${dsp(hired)}</td>
        <td colspan="2" class="lbl">退職年月日</td>
        <td colspan="3" class="val">${dsp(retiredYmd)}</td>
      </tr>

      <!-- ─ 運転免許：種類 ─ -->
      <tr>
        <td class="lbl vc" rowspan="3">運転免許</td>
        <td class="lbl">種類</td>
        <td colspan="8" class="val">${esc(licKind)}</td>
      </tr>

      <!-- ─ 運転免許：番号 ＋ 有効期限 ─ -->
      <tr>
        <td class="lbl">番号</td>
        <td colspan="8" class="val">
          <div class="lic-row">
            <span>第</span>
            <span class="lic-num-box">${digitCells}</span>
            <span>号</span>
            <span class="lic-exp">
              <span class="lic-exp-lbl">有効期限</span>
              <span>${licExp ? dsp(licExp) : "　　　年　　月　　日"}</span>
            </span>
          </div>
        </td>
      </tr>

      <!-- ─ 免許条件・限定等 ─ -->
      <tr>
        <td colspan="2" class="lbl">免許条件・限定等</td>
        <td colspan="7" class="val">${condText}</td>
      </tr>

      <!-- ─ 免許証写真 ─ -->
      <tr>
        <td colspan="5" class="photo-cap">運転免許証　表</td>
        <td colspan="5" class="photo-cap">運転免許証　裏</td>
      </tr>
      <tr>
        <td colspan="5" class="photo-cell">
          <div class="photo-box">
            ${front ? `<img src="${escAttr(front)}" alt="免許証表面"/>` : "運転免許証　表<br>（写しを貼付）"}
          </div>
        </td>
        <td colspan="5" class="photo-cell">
          <div class="photo-box">
            ${back ? `<img src="${escAttr(back)}" alt="免許証裏面"/>` : "運転免許証　裏<br>（写しを貼付）"}
          </div>
        </td>
      </tr>

    </tbody>
  </table>
</div>`;
}

/* ─────────────────────────────────────────────────
   エクスポート
───────────────────────────────────────────────── */
export function buildEmployeeRosterPrintHtml(args: {
  employees: Employee[];
  printedAt: Date;
  operatorName?: string | null;
}): string {
  const createdYmd = ymdTokyo(args.printedAt);
  const sheets =
    args.employees.length === 0
      ? `<div class="er-page"><p style="padding:24px;text-align:center;color:#888">印刷対象の従業員がありません。</p></div>`
      : args.employees.map((e) => buildOneSheet(e, { createdYmd })).join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=1280"/>
<title>従事者名簿</title>
<style>${CSS}</style>
</head>
<body>
<div class="no-print"><button type="button" onclick="window.print()">印刷</button></div>
${sheets}
</body>
</html>`;
}
