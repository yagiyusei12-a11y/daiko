/**
 * 自動車運転代行業 変更届出書（別記様式第三号・第九条関係） A4 縦
 * 添付の見本 PDF に倣ったテーブル様式を Puppeteer 用に組み立てる。
 *
 * 対応する変更事項:
 *   - mutual_aid_renewal: 受託自動車共済契約の更新
 *   - escort_swap:        随伴車の入替
 *   - escort_add:         随伴車の増車
 *   - trade_name_change:  屋号の変更
 */

export type HenkoKisaiKind =
  | "mutual_aid_renewal"
  | "escort_swap"
  | "escort_add"
  | "trade_name_change";

export type HenkoKisaiInput = {
  kind: HenkoKisaiKind;
  /** 届出年月日 (YYYY-MM-DD)。空なら本日扱い */
  submittedOn: string;
  /** 宛先（例: ●●県公安委員会） */
  addresseeCommission: string;
  /** 申請者氏名又は名称 */
  applicantName: string;
  /** 申請者住所 */
  applicantAddress: string;
  /** 主たる営業所 名称 */
  mainOfficeName: string;
  /** 主たる営業所 所在地 */
  mainOfficeAddress: string;
  /** 認定をした公安委員会の名称 */
  certifiedCommission: string;
  /** 認定番号 */
  certificationNumber: string;
  /** 変更年月日 (YYYY-MM-DD) */
  changedOn: string;
  /** 変更理由 */
  changeReason: string;

  /* 変更事項の中身（kind に応じて使用） */
  /** 共済契約期間 新 開始 (YYYY-MM-DD) */
  newCoverageFrom?: string;
  newCoverageTo?: string;
  oldCoverageFrom?: string;
  oldCoverageTo?: string;

  /** 随伴用自動車 新 ナンバー一覧 / 旧 ナンバー一覧 */
  newEscortPlates?: string[];
  oldEscortPlates?: string[];

  /** 屋号 新 / 旧 */
  newTradeName?: string;
  oldTradeName?: string;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** "2026-05-14" → "令和8年5月14日"。範囲外は西暦表記で返す。 */
function ymdToWareki(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2019) return `${y}年${mo}月${d}日`;
  return `令和${y - 2018}年${mo}月${d}日`;
}

function lines(arr: string[] | undefined): string {
  const xs = (arr ?? []).map((s) => s.trim()).filter(Boolean);
  if (xs.length === 0) return "";
  return xs.map(esc).join("<br/>");
}

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;
  font-size:10.5pt;color:#000;background:#fff;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4 portrait;margin:14mm 16mm}

.hk-page{break-after:page;page-break-after:always}
.hk-page:last-child{break-after:auto;page-break-after:auto}

.hk-head{display:flex;justify-content:flex-end;margin-bottom:4mm}
.hk-receipt-tbl{border-collapse:collapse;font-size:9pt}
.hk-receipt-tbl td{border:1px solid #000;padding:3px 8px;min-width:32mm;height:7mm;vertical-align:middle}
.hk-receipt-tbl .hk-aster{background:#fff;font-size:8.5pt;text-align:left;white-space:nowrap}
.hk-form-no{position:absolute;left:16mm;top:14mm;font-size:9pt}

.hk-title{text-align:center;font-size:18pt;font-weight:600;letter-spacing:0.3em;margin:2mm 0 4mm}
.hk-intro{text-align:center;font-size:10pt;margin-bottom:6mm;line-height:1.7}

.hk-meta{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5mm;gap:10mm}
.hk-meta-left{font-size:10.5pt;line-height:1.7;white-space:nowrap}
.hk-meta-right{font-size:10.5pt;line-height:1.7;text-align:left;min-width:80mm;flex:0 0 auto}
.hk-meta-right .hk-applicant-label{margin-bottom:1mm;font-size:9.5pt}

.hk-tbl{width:100%;border-collapse:collapse;border:1.5px solid #000;table-layout:fixed}
.hk-tbl td{border:1px solid #000;padding:5px 7px;vertical-align:middle;line-height:1.55;font-size:10pt;word-break:break-word}
.hk-lbl{width:38%;text-align:center;background:#fff;font-size:10pt;line-height:1.5}
.hk-val{background:#fff;min-height:8mm}
.hk-tall{min-height:18mm;vertical-align:top}

/* 変更事項（新／旧）の入れ子テーブル */
.hk-change{padding:0!important}
.hk-change-tbl{width:100%;border-collapse:collapse;table-layout:fixed}
.hk-change-tbl td{border:1px solid #000;padding:6px 8px;vertical-align:top;font-size:10pt;line-height:1.55}
.hk-change-row-lbl{background:#fff;text-align:center;width:38%}
.hk-change-side-lbl{text-align:center;width:8%;background:#fff;font-weight:600}
.hk-change-side-val{width:46%;background:#fff;min-height:20mm;white-space:pre-wrap}

.hk-foot{margin-top:4mm;font-size:8.5pt;line-height:1.6}
.hk-foot p{margin:0 0 1mm}

@media screen{
  body{background:#e5e7eb;padding:16px}
  .hk-page{background:#fff;max-width:210mm;margin:0 auto 24px;padding:14mm 16mm;
    box-shadow:0 2px 12px rgba(0,0,0,.1);position:relative}
  .hk-page:last-child{margin-bottom:12px}
  .no-print{text-align:center;margin-bottom:12px}
  .no-print button{font:inherit;padding:6px 20px;background:#1e3a8a;color:#fff;
    border:none;border-radius:4px;cursor:pointer}
}
@media print{.no-print{display:none!important}.hk-page{position:relative}}
`;

/** kind に応じた変更事項セル（新／旧）を組み立てる */
function buildChangeBlock(input: HenkoKisaiInput): string {
  const k = input.kind;

  if (k === "mutual_aid_renewal") {
    const newRange =
      input.newCoverageFrom || input.newCoverageTo
        ? `${ymdToWareki(input.newCoverageFrom ?? "")}　〜<br/>${ymdToWareki(input.newCoverageTo ?? "")}`
        : "";
    const oldRange =
      input.oldCoverageFrom || input.oldCoverageTo
        ? `${ymdToWareki(input.oldCoverageFrom ?? "")}　〜<br/>${ymdToWareki(input.oldCoverageTo ?? "")}`
        : "";
    return `
      <table class="hk-change-tbl">
        <tr>
          <td class="hk-change-row-lbl" rowspan="2">変更事項</td>
          <td class="hk-change-side-lbl">新</td>
          <td class="hk-change-side-val">
            <div>共済契約期間</div>
            <div style="margin-top:4mm">${newRange}</div>
          </td>
        </tr>
        <tr>
          <td class="hk-change-side-lbl">旧</td>
          <td class="hk-change-side-val">
            <div>共済契約期間</div>
            <div style="margin-top:4mm">${oldRange}</div>
          </td>
        </tr>
      </table>`;
  }

  if (k === "escort_swap" || k === "escort_add") {
    const newPlates = lines(input.newEscortPlates);
    const oldPlates = lines(input.oldEscortPlates);
    return `
      <table class="hk-change-tbl">
        <tr>
          <td class="hk-change-row-lbl" rowspan="2">変更事項</td>
          <td class="hk-change-side-lbl">新</td>
          <td class="hk-change-side-val">
            <div>随伴用自動車</div>
            <div style="margin-top:4mm">${newPlates}</div>
          </td>
        </tr>
        <tr>
          <td class="hk-change-side-lbl">旧</td>
          <td class="hk-change-side-val">
            <div>随伴用自動車</div>
            <div style="margin-top:4mm">${oldPlates}</div>
          </td>
        </tr>
      </table>`;
  }

  // trade_name_change
  return `
    <table class="hk-change-tbl">
      <tr>
        <td class="hk-change-row-lbl" rowspan="2">変更事項</td>
        <td class="hk-change-side-lbl">新</td>
        <td class="hk-change-side-val">
          <div>主たる営業所の名称</div>
          <div style="margin-top:4mm">${esc(input.newTradeName ?? "")}</div>
        </td>
      </tr>
      <tr>
        <td class="hk-change-side-lbl">旧</td>
        <td class="hk-change-side-val">
          <div>主たる営業所の名称</div>
          <div style="margin-top:4mm">${esc(input.oldTradeName ?? "")}</div>
        </td>
      </tr>
    </table>`;
}

export function buildDaikoHenkoKisaiPrintHtml(input: HenkoKisaiInput): string {
  const submitted = ymdToWareki(input.submittedOn);
  const changed = ymdToWareki(input.changedOn);
  const certLine = input.certifiedCommission?.trim()
    ? `${esc(input.certifiedCommission.trim())}　認定`
    : "認定";

  const body = `
<div class="hk-page">
  <div class="hk-form-no">別記様式第三号（第九条関係）</div>
  <div class="hk-head">
    <table class="hk-receipt-tbl">
      <tr>
        <td class="hk-aster">※&nbsp;受&nbsp;理&nbsp;年&nbsp;月&nbsp;日</td>
        <td></td>
      </tr>
      <tr>
        <td class="hk-aster">※&nbsp;受&nbsp;理&nbsp;番&nbsp;号</td>
        <td></td>
      </tr>
    </table>
  </div>

  <h1 class="hk-title">変 更 届 出 書</h1>
  <p class="hk-intro">自動車運転代行業の業務の適正化に関する法律第８条第１項の規定により届出をします。</p>

  <div class="hk-meta">
    <div class="hk-meta-left">${esc(submitted)}</div>
    <div class="hk-meta-right">
      <div>${esc(input.addresseeCommission || "")}　殿</div>
    </div>
  </div>

  <div class="hk-meta" style="justify-content:flex-end;margin-bottom:6mm">
    <div class="hk-meta-right">
      <div class="hk-applicant-label">申請者の氏名又は名称及び住所</div>
      <div>${esc(input.applicantAddress || "")}</div>
      <div>${esc(input.applicantName || "")}</div>
    </div>
  </div>

  <table class="hk-tbl">
    <colgroup>
      <col style="width:38%"/>
      <col style="width:62%"/>
    </colgroup>
    <tbody>
      <tr><td class="hk-lbl">氏名又は名称</td><td class="hk-val">${esc(input.applicantName || "")}</td></tr>
      <tr><td class="hk-lbl">住　所</td><td class="hk-val">${esc(input.applicantAddress || "")}</td></tr>
      <tr><td class="hk-lbl">主たる営業所　名　称</td><td class="hk-val">${esc(input.mainOfficeName || "")}</td></tr>
      <tr><td class="hk-lbl">主たる営業所　所在地</td><td class="hk-val">${esc(input.mainOfficeAddress || "")}</td></tr>
      <tr><td class="hk-lbl">認定をした公安委員会の名称</td><td class="hk-val">${certLine}</td></tr>
      <tr><td class="hk-lbl">認定番号</td><td class="hk-val">${esc(input.certificationNumber || "")}</td></tr>
      <tr><td class="hk-lbl">変更年月日</td><td class="hk-val">${esc(changed)}</td></tr>
      <tr><td class="hk-change" colspan="2">${buildChangeBlock(input)}</td></tr>
      <tr><td class="hk-lbl">変更理由</td><td class="hk-val hk-tall">${esc(input.changeReason || "")}</td></tr>
    </tbody>
  </table>

  <div class="hk-foot">
    <p>記載要領　１　※印欄には記載しないこと。</p>
    <p>　　　　　２　所定の欄に記載できないときは、別紙に記載の上、これを添付すること。</p>
    <p>備考　用紙の大きさは、日本産業規格Ａ４とする。</p>
  </div>
</div>`;

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=1280"/>
<title>変更届出書</title>
<style>${CSS}</style>
</head>
<body>
<div class="no-print"><button type="button" onclick="window.print()">印刷</button></div>
${body}
</body>
</html>`;
}
