import type { FastifyInstance, FastifyReply } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import {
  buildComplaintLedgerPrintHtml,
  type ComplaintLedgerPrintItem,
} from "../lib/complaint-ledger-print-html.js";
import { buildEmployeeRosterPrintHtml } from "../lib/employee-roster-print-html.js";
import { hasSecondClassDriverLicense } from "../lib/employee-license.js";
import type { JommuKirokuboModel } from "../lib/jommu-types.js";
import { isChromiumConfiguredForPdf, renderHtmlToPdf } from "../lib/html-to-pdf.js";
import { renderJommuKirokuboPdfBundle } from "../lib/jommu-excel-pdf.js";
import { userFacingJommuPdfError } from "../lib/jommu-pdf-user-error.js";
import { loadJommuKirokuboModelForDailyReport } from "../lib/jommu-daily-report-model.js";
import { buildDaikoHenkoKisaiPrintHtml, type HenkoKisaiInput, type HenkoKisaiKind } from "../lib/daiko-henko-kisai-print-html.js";
import { buildDaikoLaw14SeiyakuPrintHtml } from "../lib/daiko-law14-seiyaku-print-html.js";
import { buildDaikoNinteiCertificatePrintHtml } from "../lib/daiko-nintei-certificate-print-html.js";
import { buildDaikoYakkanPrintHtml } from "../lib/daiko-yakkan-print-html.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_JOMMU_RANGE_DAYS = 400;
const MAX_JOMMU_REPORTS = 200;
const MAX_CREW_IDS = 80;
const MAX_ROSTER_EMPLOYEES = 100;
const MAX_COMPLAINT_LEDGER_PRINT = 100;
const MAX_SEIYAKU_SHEETS = 60;
const MAX_SEIYAKU_LINE = 800;
const MAX_SEIYAKU_BODY = 30_000;
const MAX_NINTEI_ISSUING = 300;
const MAX_NINTEI_CERT_RAW = 120;
const MAX_NINTEI_NAME = 300;
const MAX_NINTEI_LOCATION = 800;
const MAX_YAKKAN_BODY = 500_000;

function wantsPdfOutput(b: Record<string, unknown>): boolean {
  return String(b.outputFormat ?? "").trim().toLowerCase() === "pdf";
}

type EmpNm = { familyName: string; givenName: string };

function complaintEmpName(e: EmpNm | null | undefined): string {
  if (!e) return "";
  return `${e.familyName}　${e.givenName}`;
}

function complaintReceivedAtDisplay(d: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function complaintCompletedOnDisplay(d: Date | null): string {
  if (!d) return "―";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

function mapComplaintToPrintItem(row: {
  receivedAt: Date;
  receivedBy: string | null;
  receivedByEmployee: EmpNm | null;
  driverEmployee: EmpNm | null;
  placeOrSection: string | null;
  complainantName: string | null;
  complainantAddress: string | null;
  complainantContact: string | null;
  detail: string | null;
  causeAnalysis: string | null;
  rebuttal: string | null;
  correctiveAction: string | null;
  handlerName: string | null;
  handlerEmployee: EmpNm | null;
  completedOn: Date | null;
}): ComplaintLedgerPrintItem {
  return {
    receivedAtDisplay: complaintReceivedAtDisplay(row.receivedAt),
    receivedBy: complaintEmpName(row.receivedByEmployee) || (row.receivedBy?.trim() ?? "―"),
    driverName: complaintEmpName(row.driverEmployee) || "―",
    placeOrSection: row.placeOrSection?.trim() || "―",
    complainantName: row.complainantName?.trim() || "―",
    complainantAddress: row.complainantAddress?.trim() || "―",
    complainantContact: row.complainantContact?.trim() || "―",
    detail: row.detail?.trim() || "―",
    causeAnalysis: row.causeAnalysis?.trim() || "―",
    rebuttal: row.rebuttal?.trim() || "―",
    correctiveAction: row.correctiveAction?.trim() || "―",
    handlerName: complaintEmpName(row.handlerEmployee) || (row.handlerName?.trim() ?? "―"),
    completedOnDisplay: complaintCompletedOnDisplay(row.completedOn),
  };
}

async function sendHtmlOrPdf(
  reply: FastifyReply,
  req: { log: { error: (e: unknown) => void } },
  b: Record<string, unknown>,
  html: string,
  filenameStem: string,
) {
  if (!wantsPdfOutput(b)) {
    return reply.type("text/html; charset=utf-8").send(html);
  }
  if (!isChromiumConfiguredForPdf()) {
    return reply.code(503).send({
      error:
        "PDF 出力はサーバーに Chromium のインストールと環境変数 CHROMIUM_EXECUTABLE の設定が必要です。管理者に連絡してください。",
    });
  }
  try {
    const buf = await renderHtmlToPdf(html);
    const safe = filenameStem.replace(/[^\w.-]+/g, "_").slice(0, 120) || "document";
    return reply
      .type("application/pdf")
      .header("Content-Disposition", `attachment; filename="${safe}.pdf"`)
      .send(buf);
  } catch (e) {
    req.log.error(e);
    return reply.code(500).send({ error: "PDF の生成に失敗しました。時間をおいて再度お試しください。" });
  }
}

export async function registerDocumentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/documents/employee-roster-print", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const includeRetired = Boolean(b.includeRetired);
    const rawIds = b.employeeIds;
    if (!Array.isArray(rawIds)) {
      return reply.code(400).send({ error: "employeeIds は文字列の配列で指定してください" });
    }
    const employeeIds = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))];
    if (employeeIds.length === 0) {
      return reply.code(400).send({ error: "employeeIds を 1 人以上指定してください" });
    }
    if (employeeIds.length > MAX_ROSTER_EMPLOYEES) {
      return reply.code(400).send({ error: `一度に印刷できるのは ${MAX_ROSTER_EMPLOYEES} 人までです` });
    }

    const statusWhere = includeRetired ? {} : ({ status: "ACTIVE" as const } as const);
    const rows = await prisma.employee.findMany({
      where: { tenantId, id: { in: employeeIds }, ...statusWhere },
    });
    if (rows.length !== employeeIds.length) {
      return reply.code(400).send({
        error: "無効な従業員 id が含まれるか、「在籍のみ」のときに退職者が含まれています",
      });
    }

    const byId = new Map(rows.map((e) => [e.id, e]));
    const employeesOrdered = employeeIds.map((id) => byId.get(id)).filter((e): e is (typeof rows)[0] => e != null);

    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const operatorName = settings?.legalTradeName?.trim() ?? "";
    const html = buildEmployeeRosterPrintHtml({
      employees: employeesOrdered,
      printedAt: new Date(),
      operatorName: operatorName || null,
    });
    return sendHtmlOrPdf(reply, req, b, html, "employee-roster");
  });

  app.post("/documents/complaint-ledger-print", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const rawIds = b.complaintIds;
    if (!Array.isArray(rawIds)) {
      return reply.code(400).send({ error: "complaintIds は文字列の配列で指定してください" });
    }
    const complaintIds = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))];
    if (complaintIds.length === 0) {
      return reply.code(400).send({ error: "complaintIds を 1 件以上指定してください" });
    }
    if (complaintIds.length > MAX_COMPLAINT_LEDGER_PRINT) {
      return reply.code(400).send({ error: `一度に PDF 化できるのは ${MAX_COMPLAINT_LEDGER_PRINT} 件までです` });
    }

    const empPick = { select: { familyName: true, givenName: true } } as const;
    const rows = await prisma.complaintLedger.findMany({
      where: { tenantId, id: { in: complaintIds } },
      include: {
        driverEmployee: empPick,
        receivedByEmployee: empPick,
        handlerEmployee: empPick,
      },
    });
    if (rows.length !== complaintIds.length) {
      return reply.code(400).send({ error: "無効な苦情 id が含まれています" });
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = complaintIds.map((id) => byId.get(id)).filter((r): r is (typeof rows)[0] => r != null);
    const items = ordered.map((r) => mapComplaintToPrintItem(r));
    const html = buildComplaintLedgerPrintHtml(items);
    return sendHtmlOrPdf(reply, req, b, html, "complaint-ledger");
  });

  app.post("/documents/daiko-law14-seiyaku-print", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = (req.body ?? {}) as Record<string, unknown>;

    const companyLine = String(b.companyLine ?? "").trim();
    const representativeLine = String(b.representativeLine ?? "").trim();
    const pledgeYmd = String(b.pledgeYmd ?? "").trim();
    const pledgeBody = String(b.pledgeBody ?? "");
    const includeRetired = Boolean(b.includeRetired);

    if (!companyLine) {
      return reply.code(400).send({ error: "companyLine を入力してください" });
    }
    if (!representativeLine) {
      return reply.code(400).send({ error: "representativeLine を入力してください" });
    }
    if (companyLine.length > MAX_SEIYAKU_LINE || representativeLine.length > MAX_SEIYAKU_LINE) {
      return reply.code(400).send({ error: "宛名行が長すぎます" });
    }
    if (!ISO_DATE.test(pledgeYmd)) {
      return reply.code(400).send({ error: "pledgeYmd は YYYY-MM-DD で指定してください" });
    }
    if (!pledgeBody.trim()) {
      return reply.code(400).send({ error: "誓約の本文を入力してください" });
    }
    if (pledgeBody.length > MAX_SEIYAKU_BODY) {
      return reply.code(400).send({ error: "誓約の本文が長すぎます" });
    }

    const rawSheets = b.sheets;
    if (!Array.isArray(rawSheets) || rawSheets.length === 0) {
      return reply.code(400).send({ error: "sheets は 1 件以上のオブジェクト配列で指定してください" });
    }
    if (rawSheets.length > MAX_SEIYAKU_SHEETS) {
      return reply.code(400).send({ error: `一度に印刷できるのは ${MAX_SEIYAKU_SHEETS} 枚までです` });
    }

    type One = { employeeId: string; signerName: string; signerAddress: string };
    const parsed: One[] = [];
    for (const row of rawSheets) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return reply.code(400).send({ error: "sheets の各要素はオブジェクトにしてください" });
      }
      const o = row as Record<string, unknown>;
      const employeeId = String(o.employeeId ?? "").trim();
      const signerName = String(o.signerName ?? "").trim();
      const signerAddress = String(o.signerAddress ?? "").trim();
      if (!employeeId) return reply.code(400).send({ error: "各 sheet に employeeId を指定してください" });
      if (!signerName) return reply.code(400).send({ error: "各 sheet に signerName を指定してください" });
      if (signerName.length > 200 || signerAddress.length > 800) {
        return reply.code(400).send({ error: "氏名・住所の文字数が上限を超えています" });
      }
      parsed.push({ employeeId, signerName, signerAddress });
    }

    const ids = [...new Set(parsed.map((p) => p.employeeId))];
    const statusWhere = includeRetired ? {} : ({ status: "ACTIVE" as const } as const);
    const rows = await prisma.employee.findMany({
      where: { tenantId, id: { in: ids }, ...statusWhere },
      select: { id: true },
    });
    if (rows.length !== ids.length) {
      return reply.code(400).send({
        error: "無効な従業員 id が含まれるか、「在籍のみ」のときに退職者が含まれています",
      });
    }

    const html = buildDaikoLaw14SeiyakuPrintHtml({
      companyLine,
      representativeLine,
      pledgeYmd,
      pledgeBody,
      sheets: parsed.map((p) => ({ signerName: p.signerName, signerAddress: p.signerAddress })),
    });
    return sendHtmlOrPdf(reply, req, b, html, "daiko-law14-seiyaku");
  });

  app.post("/documents/henko-kisai-print", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;

    const kindRaw = String(b.kind ?? "").trim();
    const allowedKinds: HenkoKisaiKind[] = [
      "mutual_aid_renewal",
      "escort_swap",
      "escort_add",
      "trade_name_change",
    ];
    if (!allowedKinds.includes(kindRaw as HenkoKisaiKind)) {
      return reply.code(400).send({ error: "kind は mutual_aid_renewal / escort_swap / escort_add / trade_name_change のいずれかを指定してください" });
    }
    const kind = kindRaw as HenkoKisaiKind;

    function strField(key: string, max = 800): string {
      const v = b[key];
      const s = typeof v === "string" ? v.trim() : "";
      return s.length > max ? s.slice(0, max) : s;
    }

    function ymdField(key: string): string {
      const v = String(b[key] ?? "").trim();
      if (!v) return "";
      if (!ISO_DATE.test(v)) {
        throw Object.assign(new Error(`${key} は YYYY-MM-DD で指定してください`), { _httpStatus: 400 });
      }
      return v;
    }

    function plateList(key: string): string[] {
      const v = b[key];
      if (!Array.isArray(v)) return [];
      return v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean)
        .slice(0, 50);
    }

    try {
      const input: HenkoKisaiInput = {
        kind,
        submittedOn: ymdField("submittedOn"),
        addresseeCommission: strField("addresseeCommission", 300),
        applicantName: strField("applicantName", 300),
        applicantAddress: strField("applicantAddress", 600),
        mainOfficeName: strField("mainOfficeName", 300),
        mainOfficeAddress: strField("mainOfficeAddress", 600),
        certifiedCommission: strField("certifiedCommission", 300),
        certificationNumber: strField("certificationNumber", 120),
        changedOn: ymdField("changedOn"),
        changeReason: strField("changeReason", 2000),
        newCoverageFrom: ymdField("newCoverageFrom"),
        newCoverageTo: ymdField("newCoverageTo"),
        oldCoverageFrom: ymdField("oldCoverageFrom"),
        oldCoverageTo: ymdField("oldCoverageTo"),
        newEscortPlates: plateList("newEscortPlates"),
        oldEscortPlates: plateList("oldEscortPlates"),
        newTradeName: strField("newTradeName", 300),
        oldTradeName: strField("oldTradeName", 300),
      };

      if (!input.submittedOn) {
        return reply.code(400).send({ error: "提出年月日を入力してください" });
      }
      if (!input.changedOn) {
        return reply.code(400).send({ error: "変更年月日を入力してください" });
      }

      const html = buildDaikoHenkoKisaiPrintHtml(input);
      return sendHtmlOrPdf(reply, req, b, html, "daiko-henko-kisai");
    } catch (e) {
      if (e && typeof e === "object" && "_httpStatus" in e) {
        const msg = e instanceof Error ? e.message : String((e as { message?: unknown }).message ?? "入力が不正です");
        return reply.code(400).send({ error: msg });
      }
      throw e;
    }
  });

  app.post("/documents/daiko-nintei-certificate-print", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const issuingAuthorityDisplay = String(b.issuingAuthorityDisplay ?? "").trim();
    const certificationNumberMiddle = String(b.certificationNumberMiddle ?? "");
    const certificationDateYmd = String(b.certificationDateYmd ?? "").trim();
    const nameOrTitle = String(b.nameOrTitle ?? "").trim();
    const location = String(b.location ?? "").trim();

    if (issuingAuthorityDisplay.length > MAX_NINTEI_ISSUING) {
      return reply.code(400).send({ error: "認定をした公安委員会の欄が長すぎます" });
    }
    if (certificationNumberMiddle.length > MAX_NINTEI_CERT_RAW) {
      return reply.code(400).send({ error: "認定番号の欄が長すぎます" });
    }
    if (certificationDateYmd && !ISO_DATE.test(certificationDateYmd)) {
      return reply.code(400).send({ error: "認定年月日は YYYY-MM-DD で指定するか、空にしてください" });
    }
    if (nameOrTitle.length > MAX_NINTEI_NAME) {
      return reply.code(400).send({ error: "氏名又は名称の欄が長すぎます" });
    }
    if (location.length > MAX_NINTEI_LOCATION) {
      return reply.code(400).send({ error: "所在地の欄が長すぎます" });
    }

    const html = buildDaikoNinteiCertificatePrintHtml({
      issuingAuthorityDisplay,
      certificationNumberMiddle,
      certificationDateYmd: ISO_DATE.test(certificationDateYmd) ? certificationDateYmd : "",
      nameOrTitle,
      location,
    });
    return sendHtmlOrPdf(reply, req, b, html, "daiko-nintei-certificate");
  });

  app.post("/documents/daiko-yakkan-print", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const bodyText = String(b.bodyText ?? "");
    if (!bodyText.trim()) {
      return reply.code(400).send({ error: "約款の本文を入力してください" });
    }
    if (bodyText.length > MAX_YAKKAN_BODY) {
      return reply.code(400).send({ error: "約款の本文が長すぎます" });
    }
    const html = buildDaikoYakkanPrintHtml({ bodyText });
    return sendHtmlOrPdf(reply, req, b, html, "daiko-yakkan");
  });

  app.post("/documents/daily-reports-jommu-print", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const from = String(b.from ?? "").trim();
    const to = String(b.to ?? "").trim();
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return reply.code(400).send({ error: "from, to は YYYY-MM-DD で指定してください" });
    }
    if (from > to) {
      return reply.code(400).send({ error: "from は to 以前である必要があります" });
    }
    const t0 = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
    const t1 = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
    const spanDays = (t1 - t0) / 86_400_000;
    if (spanDays > MAX_JOMMU_RANGE_DAYS) {
      return reply.code(400).send({ error: `期間は ${MAX_JOMMU_RANGE_DAYS} 日以内で指定してください` });
    }

    const crewScope = String(b.crewScope ?? "all").trim();
    if (crewScope !== "all" && crewScope !== "second") {
      return reply.code(400).send({ error: "crewScope は all または second です" });
    }

    const rawIds = b.crewIds;
    if (!Array.isArray(rawIds)) {
      return reply.code(400).send({ error: "crewIds は文字列の配列で指定してください" });
    }
    const crewIds = [...new Set(rawIds.map((x) => String(x).trim()).filter(Boolean))];
    if (crewIds.length === 0) {
      return reply.code(400).send({ error: "crewIds を 1 人以上指定してください" });
    }
    if (crewIds.length > MAX_CREW_IDS) {
      return reply.code(400).send({ error: `crewIds は ${MAX_CREW_IDS} 人までです` });
    }

    const emps = await prisma.employee.findMany({
      where: { tenantId, status: "ACTIVE", id: { in: crewIds } },
      select: { id: true, registerExtension: true },
    });
    if (emps.length !== crewIds.length) {
      return reply.code(400).send({ error: "無効な従業員 id が含まれています" });
    }
    if (crewScope === "second") {
      for (const e of emps) {
        if (!hasSecondClassDriverLicense(e.registerExtension)) {
          return reply.code(400).send({
            error: "第二種免許登録者のみのときは、第二種免許を登録した従業員だけを crewIds に含めてください",
          });
        }
      }
    }

    const allowedIds = emps.map((e) => e.id);

    const count = await prisma.dailyReport.count({
      where: {
        tenantId,
        businessDate: { gte: from, lte: to },
        mainEmployeeId: { in: allowedIds },
      },
    });
    if (count > MAX_JOMMU_REPORTS) {
      return reply.code(400).send({
        error: `対象日報が ${MAX_JOMMU_REPORTS} 件を超えています。期間や対象者を絞ってください`,
      });
    }

    const reports = await prisma.dailyReport.findMany({
      where: {
        tenantId,
        businessDate: { gte: from, lte: to },
        mainEmployeeId: { in: allowedIds },
      },
      orderBy: [{ businessDate: "asc" }, { mainEmployeeId: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    const models = await Promise.all(
      reports.map((r) => loadJommuKirokuboModelForDailyReport(tenantId, r.id)),
    );
    const ok = models.filter((m): m is JommuKirokuboModel => m != null);

    if (!wantsPdfOutput(b)) {
      return reply.code(400).send({
        error:
          "乗務記録簿は PDF のみ出力します。リクエスト body の outputFormat に pdf を指定してください。",
      });
    }
    if (!isChromiumConfiguredForPdf()) {
      return reply.code(503).send({
        error:
          "乗務記録簿の PDF にはサーバーに Chromium または Chrome が必要です。管理者に CHROMIUM_EXECUTABLE の設定を依頼してください。",
      });
    }
    try {
      const buf = await renderJommuKirokuboPdfBundle(ok);
      const safe =
        `daily-reports-jommu_${from}_${to}`.replace(/[^\w.-]+/g, "_").slice(0, 120) || "document";
      return reply
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${safe}.pdf"`)
        .send(buf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.error({ err: e, jommuPdf: true, message: msg }, "jommu kirokubo pdf failed");
      return reply.code(500).send({ error: userFacingJommuPdfError(e) });
    }
  });

  app.get<{ Querystring: { includeRetired?: string } }>(
    "/documents/employee-roster-print.html",
    async (req, reply) => {
      const { tenantId } = jwtUser(req);
      const includeRetired = String(req.query?.includeRetired ?? "").trim() === "1";

      const where = { tenantId, ...(includeRetired ? {} : { status: "ACTIVE" as const }) };

      const [employees, settings] = await Promise.all([
        prisma.employee.findMany({
          where,
          orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
        }),
        prisma.tenantSettings.findUnique({ where: { tenantId } }),
      ]);

      const operatorName = settings?.legalTradeName?.trim() ?? "";
      const html = buildEmployeeRosterPrintHtml({
        employees,
        printedAt: new Date(),
        operatorName: operatorName || null,
      });

      return reply.type("text/html; charset=utf-8").send(html);
    },
  );

  app.post<{ Body: Record<string, unknown> }>("/documents/alcohol-check-pdf", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = req.body || {};
    const yearMonth = String(b.yearMonth ?? "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      return reply.code(400).send({ error: "yearMonth は yyyy-MM 形式で指定してください" });
    }
    const [y, m] = yearMonth.split("-");
    const dateFrom = `${y}-${m}-01`;
    const nextMonth = m === "12" ? `${Number(y) + 1}-01-01` : `${y}-${String(Number(m) + 1).padStart(2, "0")}-01`;

    const punches = await prisma.timeCardPunch.findMany({
      where: {
        tenantId,
        businessDate: { gte: dateFrom, lt: nextMonth },
        kind: { in: ["CLOCK_IN", "CLOCK_OUT"] },
      },
      orderBy: [{ businessDate: "asc" }, { punchedAt: "asc" }],
      include: { employee: { select: { familyName: true, givenName: true } } },
    });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

    type AlcoholRow = {
      businessDate: string;
      phase: string;
      name: string;
      breathalyzerName: string;
      verificationMethod: string;
      alcoholDetected: boolean;
      instructionsNote: string;
      verifierName: string;
    };

    const rows: AlcoholRow[] = punches
      .filter((p) => p.alcoholCheckJson !== null)
      .map((p) => {
        const ac = (p.alcoholCheckJson ?? {}) as Record<string, unknown>;
        return {
          businessDate: p.businessDate,
          phase: p.kind === "CLOCK_IN" ? "出勤" : "退勤",
          name: `${p.employee.familyName} ${p.employee.givenName}`,
          breathalyzerName: typeof ac.breathalyzerName === "string" ? ac.breathalyzerName : "—",
          verificationMethod: typeof ac.verificationMethod === "string" ? ac.verificationMethod : "—",
          alcoholDetected: Boolean(ac.alcoholDetected),
          instructionsNote: typeof ac.instructionsNote === "string" ? ac.instructionsNote : "",
          verifierName: typeof ac.verifierName === "string" ? ac.verifierName : "—",
        };
      });

    const tableRows = rows
      .map(
        (r) => `<tr>
      <td>${r.businessDate}</td>
      <td>${r.name}</td>
      <td>${r.phase}</td>
      <td>${r.breathalyzerName}</td>
      <td>${r.verificationMethod}</td>
      <td class="${r.alcoholDetected ? "positive" : ""}">${r.alcoholDetected ? "あり" : "なし"}</td>
      <td class="note">${r.instructionsNote.replace(/</g, "&lt;").replace(/\n/g, "<br>")}</td>
      <td>${r.verifierName}</td>
    </tr>`,
      )
      .join("\n");

    const [ym_y, ym_m] = yearMonth.split("-");
    const title = `アルコール点検記録 ${ym_y}年${Number(ym_m)}月`;
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4 portrait; margin: 15mm 12mm; }
  body { font-family: "Noto Sans JP", sans-serif; font-size: 10pt; color: #0f172a; margin: 0; }
  h1 { font-size: 14pt; font-weight: 700; text-align: center; margin: 0 0 4pt; }
  .sub { font-size: 10pt; text-align: center; color: #475569; margin: 0 0 10pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th { background: #1e293b; color: #fff; padding: 4pt 5pt; text-align: center; white-space: nowrap; }
  td { border: 1px solid #cbd5e1; padding: 3pt 5pt; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  td.positive { color: #dc2626; font-weight: 700; }
  td.note { font-size: 8pt; max-width: 80pt; word-break: break-all; }
</style>
</head>
<body>
<h1>${title}</h1>
<p class="sub">${tenant?.name ?? ""}</p>
<table>
  <thead>
    <tr>
      <th>日付</th><th>氏名</th><th>区分</th><th>検知器</th><th>確認方法</th><th>酒気帯び</th><th>指示事項</th><th>確認者</th>
    </tr>
  </thead>
  <tbody>
${tableRows || "<tr><td colspan=\"8\" style=\"text-align:center;color:#94a3b8\">記録なし</td></tr>"}
  </tbody>
</table>
</body>
</html>`;

    return sendHtmlOrPdf(reply, req, b, html, `alcohol-check_${yearMonth}`);
  });
}
