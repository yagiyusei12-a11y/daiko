import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { buildEmployeeRosterPrintHtml } from "../lib/employee-roster-print-html.js";
import { hasSecondClassDriverLicense } from "../lib/employee-license.js";
import { buildJommuKirokuboHtmlBundle, type JommuKirokuboModel } from "../lib/jommu-kirokubo-html.js";
import { loadJommuKirokuboModelForDailyReport } from "../lib/jommu-daily-report-model.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_JOMMU_RANGE_DAYS = 400;
const MAX_JOMMU_REPORTS = 200;
const MAX_CREW_IDS = 80;

export async function registerDocumentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

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

    const title = `乗務記録簿（${from}〜${to}）`;
    const html = buildJommuKirokuboHtmlBundle(ok, title);
    return reply.type("text/html; charset=utf-8").send(html);
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
}
