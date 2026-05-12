import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { loadUserAccess } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { businessDateYmdForOccurredAt } from "../lib/business-date.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerTimePunchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/time-punches", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const access = await loadUserAccess(u.sub, tid);
    const { businessDate } = req.query as { businessDate?: string };
    const where: { tenantId: string; businessDate?: string; employeeId?: string } = {
      tenantId: tid,
      ...(businessDate ? { businessDate } : {}),
    };
    if (access.isStaffShiftOnly) {
      if (!access.employeeId) return { punches: [] };
      where.employeeId = access.employeeId;
    }
    const rows = await prisma.timePunch.findMany({
      where,
      orderBy: { clockInAt: "desc" },
      take: 200,
      include: { employee: true },
    });
    return { punches: rows };
  });

  app.post<{ Body: { employeeId?: string; clockInAt?: string } }>(
    "/time-punches/clock-in",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const u = jwtUser(req);
      const access = await loadUserAccess(u.sub, tid);
      const tenant = await prisma.tenant.findUnique({ where: { id: tid }, include: { settings: true } });
      if (!tenant?.settings) return reply.code(500).send({ error: "tenant settings missing" });
      let employeeId = String(req.body?.employeeId || "");
      if (access.isStaffShiftOnly) {
        if (!access.employeeId) return reply.code(403).send({ error: "user not linked to an employee" });
        if (employeeId && employeeId !== access.employeeId) {
          return reply.code(403).send({ error: "staff can only clock in for their linked employee" });
        }
        employeeId = access.employeeId;
      }
      const clockInAt = req.body?.clockInAt ? new Date(req.body.clockInAt) : new Date();
      if (!employeeId || !Number.isFinite(clockInAt.getTime())) {
        return reply.code(400).send({ error: "employeeId required; clockInAt optional ISO" });
      }
      const emp = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: tid, status: "ACTIVE" } });
      if (!emp) return reply.code(404).send({ error: "employee not found" });
      const businessDate = businessDateYmdForOccurredAt(clockInAt, tenant.timezone, tenant.settings.businessDayRollHour);
      return prisma.timePunch.create({
        data: { tenantId: tid, employeeId, businessDate, clockInAt },
      });
    },
  );

  app.post<{ Params: { id: string }; Body: { clockOutAt?: string } }>(
    "/time-punches/:id/clock-out",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const u = jwtUser(req);
      const access = await loadUserAccess(u.sub, tid);
      const p = await prisma.timePunch.findFirst({
        where: { id: req.params.id, tenantId: tid },
      });
      if (!p) return reply.code(404).send({ error: "not found" });
      if (access.isStaffShiftOnly) {
        if (!access.employeeId || p.employeeId !== access.employeeId) {
          return reply.code(403).send({ error: "forbidden" });
        }
      }
      const clockOutAt = req.body?.clockOutAt ? new Date(req.body.clockOutAt) : new Date();
      return prisma.timePunch.update({
        where: { id: p.id },
        data: { clockOutAt },
      });
    },
  );
}
