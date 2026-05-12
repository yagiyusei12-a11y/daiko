import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { employeeIsSafeDrivingManager } from "../lib/dispatch-profile.js";
import { loadUserAccess } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { businessDateYmdForOccurredAt } from "../lib/business-date.js";
import { tenantIdFromReq } from "./tenant-scope.js";

function alcoholCheckDeletableForAccess(row: { employeeId: string }, access: { isStaffShiftOnly: boolean; employeeId: string | null }): boolean {
  if (!access.isStaffShiftOnly) return true;
  return Boolean(access.employeeId && row.employeeId === access.employeeId);
}

export async function registerAlcoholRoutes(app: FastifyInstance): Promise<void> {
  app.get("/alcohol-checks", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const { businessDate } = req.query as { businessDate?: string };
    const where: { tenantId: string; businessDate?: string; employeeId?: string } = {
      tenantId: tid,
      ...(businessDate ? { businessDate } : {}),
    };
    if (access.isStaffShiftOnly) {
      if (!access.employeeId) return { checks: [] };
      where.employeeId = access.employeeId;
    }
    const rows = await prisma.alcoholCheck.findMany({
      where,
      orderBy: { checkedAt: "desc" },
      take: 200,
      include: { employee: true },
    });
    return { checks: rows };
  });

  app.post<{
    Body: {
      employeeId?: string;
      phase?: string;
      checkedAt?: string;
      checkerEmployeeId?: string;
      checkerName?: string;
      checkMethod?: string;
      checkMethodOther?: string;
      methodNote?: string;
      detectorUsed?: boolean;
      resultPositive?: boolean;
      instructionNote?: string;
      otherNote?: string;
      supervisorNote?: string;
    };
  }>("/alcohol-checks", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const tenant = await prisma.tenant.findUnique({ where: { id: tid }, include: { settings: true } });
    if (!tenant?.settings) return reply.code(500).send({ error: "tenant settings missing" });
    let employeeId = String(req.body?.employeeId || "");
    if (access.isStaffShiftOnly) {
      if (!access.employeeId) return reply.code(403).send({ error: "user not linked to an employee" });
      if (employeeId && employeeId !== access.employeeId) {
        return reply.code(403).send({ error: "staff can only record alcohol checks for their linked employee" });
      }
      employeeId = access.employeeId;
    }
    const phase = String(req.body?.phase || "").trim();
    const checkedAt = req.body?.checkedAt ? new Date(req.body.checkedAt) : new Date();
    if (!employeeId || !phase) return reply.code(400).send({ error: "employeeId, phase required" });
    const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: tid } });
    if (!emp) return reply.code(404).send({ error: "employee not found" });
    const businessDate = businessDateYmdForOccurredAt(checkedAt, tenant.timezone, tenant.settings.businessDayRollHour);

    let checkerName: string | null = null;
    const checkerEmployeeId = req.body?.checkerEmployeeId ? String(req.body.checkerEmployeeId).trim() : "";
    if (checkerEmployeeId) {
      const checker = await prisma.employee.findFirst({
        where: { id: checkerEmployeeId, tenantId: tid, status: "ACTIVE" },
      });
      if (!checker) return reply.code(400).send({ error: "checker employee not found" });
      if (!employeeIsSafeDrivingManager(checker.registerExtension)) {
        return reply.code(400).send({ error: "checker must be a safe driving manager" });
      }
      checkerName = `${checker.familyName} ${checker.givenName}`.trim().slice(0, 200) || null;
    }

    return prisma.alcoholCheck.create({
      data: {
        tenantId: tid,
        employeeId,
        businessDate,
        phase,
        checkedAt,
        checkerName,
        checkMethod: req.body?.checkMethod ? String(req.body.checkMethod).slice(0, 50) : null,
        checkMethodOther: req.body?.checkMethodOther ? String(req.body.checkMethodOther).slice(0, 200) : null,
        methodNote: req.body?.methodNote ? String(req.body.methodNote).slice(0, 500) : null,
        detectorUsed: Boolean(req.body?.detectorUsed),
        resultPositive: Boolean(req.body?.resultPositive),
        instructionNote: req.body?.instructionNote ? String(req.body.instructionNote).slice(0, 500) : null,
        otherNote: req.body?.otherNote ? String(req.body.otherNote).slice(0, 500) : null,
        supervisorNote: req.body?.supervisorNote ? String(req.body.supervisorNote).slice(0, 1000) : null,
      },
    });
  });

  app.delete<{ Params: { id: string } }>("/alcohol-checks/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const row = await prisma.alcoholCheck.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!row) return reply.code(404).send({ error: "not found" });
    if (!alcoholCheckDeletableForAccess(row, access)) return reply.code(404).send({ error: "not found" });
    await prisma.alcoholCheck.delete({ where: { id: row.id } });
    return { ok: true };
  });
}
