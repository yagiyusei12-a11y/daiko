import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { buildEmployeeRosterPrintHtml } from "../lib/employee-roster-print-html.js";

export async function registerDocumentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

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
