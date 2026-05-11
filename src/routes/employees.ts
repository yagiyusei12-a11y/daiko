import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { employeeRegisterForCreateSchema, registerExtensionSchema } from "../lib/dispatch-profile.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const patchBodySchema = z
  .object({
    status: z.enum(["active", "ACTIVE", "retired", "RETIRED"]).optional(),
    familyName: z.string().min(1).max(100).optional(),
    givenName: z.string().min(1).max(100).optional(),
    furigana: z.string().max(200).nullable().optional(),
    address: z.string().max(2000).nullable().optional(),
    registerExtension: z.record(z.unknown()).optional(),
  })
  .strict();

export async function registerEmployeeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/employees", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const { status } = req.query as { status?: string };
    const where = {
      tenantId: tid,
      ...(status === "retired" ? { status: "RETIRED" as const } : status === "all" ? {} : { status: "ACTIVE" as const }),
    };
    const rows = await prisma.employee.findMany({
      where,
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    });
    return { employees: rows };
  });

  app.post<{
    Body: {
      familyName?: string;
      givenName?: string;
      furigana?: string;
      address?: string;
      registerExtension?: Record<string, unknown>;
    };
  }>("/employees", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const familyName = String(req.body?.familyName || "").trim();
    const givenName = String(req.body?.givenName || "").trim();
    const furigana = String(req.body?.furigana || "").trim();
    const address = String(req.body?.address || "").trim();
    if (!familyName || !givenName) return reply.code(400).send({ error: "familyName, givenName required" });
    if (!furigana) return reply.code(400).send({ error: "furigana required" });
    if (!address) return reply.code(400).send({ error: "address required" });

    const extRaw = req.body?.registerExtension;
    if (!extRaw || typeof extRaw !== "object" || Array.isArray(extRaw)) {
      return reply.code(400).send({ error: "registerExtension object required" });
    }
    const trimmedExt: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extRaw as Record<string, unknown>)) {
      trimmedExt[k] = typeof v === "string" ? v.trim() : v;
    }
    const extParsed = employeeRegisterForCreateSchema.safeParse(trimmedExt);
    if (!extParsed.success) {
      return reply.code(400).send({
        error: "registerExtension invalid",
        details: extParsed.error.flatten(),
      });
    }

    const row = await prisma.employee.create({
      data: {
        tenantId: tid,
        familyName,
        givenName,
        furigana,
        address,
        status: "ACTIVE",
        registerExtension: extParsed.data as Prisma.InputJsonValue,
      },
    });
    return row;
  });

  app.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      retiredAt?: string | null;
      familyName?: string;
      givenName?: string;
      furigana?: string | null;
      address?: string | null;
      registerExtension?: Record<string, unknown>;
    };
  }>("/employees/:id", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const id = req.params.id;
    const cur = await prisma.employee.findFirst({ where: { id, tenantId: tid } });
    if (!cur) return reply.code(404).send({ error: "not found" });

    const parsed = patchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const data: Prisma.EmployeeUpdateInput = {};

    if (body.status === "retired" || body.status === "RETIRED") {
      data.status = "RETIRED";
      data.retiredAt = new Date();
    } else if (body.status === "active" || body.status === "ACTIVE") {
      data.status = "ACTIVE";
      data.retiredAt = null;
    }

    if (body.familyName !== undefined) data.familyName = body.familyName;
    if (body.givenName !== undefined) data.givenName = body.givenName;
    if (body.furigana !== undefined) data.furigana = body.furigana;
    if (body.address !== undefined) data.address = body.address;

    if (body.registerExtension !== undefined) {
      const prev =
        cur.registerExtension !== null &&
        typeof cur.registerExtension === "object" &&
        !Array.isArray(cur.registerExtension)
          ? (cur.registerExtension as Record<string, unknown>)
          : {};
      const merged = { ...prev, ...body.registerExtension };
      const ext = registerExtensionSchema.safeParse(merged);
      if (!ext.success) {
        return reply.code(400).send({ error: `registerExtension: ${ext.error.message}` });
      }
      data.registerExtension = ext.data as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "no valid fields to update" });
    }

    const row = await prisma.employee.update({ where: { id }, data });
    return row;
  });

  app.post<{
    Params: { id: string };
    Body: {
      validFrom?: string;
      compensationType?: string;
      baseHourlyYen?: number;
      commissionMainRateBps?: number;
      commissionPartnerRateBps?: number;
    };
  }>("/employees/:id/compensation", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const emp = await prisma.employee.findFirst({ where: { id: req.params.id, tenantId: tid } });
    if (!emp) return reply.code(404).send({ error: "not found" });
    const ct = req.body?.compensationType;
    if (ct !== "HOURLY_ONLY" && ct !== "COMMISSION_ONLY" && ct !== "HOURLY_AND_COMMISSION") {
      return reply.code(400).send({ error: "invalid compensationType" });
    }
    const validFrom = req.body?.validFrom ? new Date(req.body.validFrom) : new Date();
    if (!Number.isFinite(validFrom.getTime())) return reply.code(400).send({ error: "invalid validFrom" });
    const row = await prisma.employeeCompensationPeriod.create({
      data: {
        employeeId: emp.id,
        validFrom,
        compensationType: ct,
        baseHourlyYen: Math.max(0, Math.floor(Number(req.body?.baseHourlyYen ?? 0))),
        commissionMainRateBps: Math.max(0, Math.floor(Number(req.body?.commissionMainRateBps ?? 0))),
        commissionPartnerRateBps: Math.max(0, Math.floor(Number(req.body?.commissionPartnerRateBps ?? 0))),
      },
    });
    return row;
  });
}
