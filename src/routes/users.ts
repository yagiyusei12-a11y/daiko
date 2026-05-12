import type { FastifyInstance } from "fastify";
import { authenticate, jwtUser } from "../auth/pre.js";
import { userHasPermission } from "../lib/permissions.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const allowed = await userHasPermission(u.sub, tid, "rbac.manage");
    if (!allowed) return reply.code(403).send({ error: "forbidden" });
    const rows = await prisma.user.findMany({
      where: { tenantId: tid },
      orderBy: { email: "asc" },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
    });
    return {
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        employeeId: row.employeeId,
        roles: row.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
      })),
    };
  });

  app.patch<{
    Params: { id: string };
    Body: { employeeId?: string | null };
  }>("/users/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const u = jwtUser(req);
    const allowed = await userHasPermission(u.sub, tid, "rbac.manage");
    if (!allowed) return reply.code(403).send({ error: "forbidden" });
    if (!("employeeId" in (req.body ?? {}))) {
      return reply.code(400).send({ error: "employeeId required in body (null to clear)" });
    }
    const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!target) return reply.code(404).send({ error: "not found" });
    const raw = req.body?.employeeId;
    const eid = raw === null || raw === "" ? null : String(raw);
    if (eid) {
      const emp = await prisma.employee.findFirst({ where: { id: eid, tenantId: tid, status: "ACTIVE" } });
      if (!emp) return reply.code(400).send({ error: "invalid employeeId" });
    }
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { employeeId: eid },
      include: {
        roles: { include: { role: { select: { id: true, name: true } } } },
      },
    });
    return {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      employeeId: updated.employeeId,
      roles: updated.roles.map((r) => ({ id: r.role.id, name: r.role.name })),
    };
  });
}
