import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const versionPatchBodySchema = z
  .object({
    initialDistanceM: z.number().int().min(0),
    initialFareYen: z.number().int().min(0),
    addUnitDistanceM: z.number().int().min(1),
    addFareYen: z.number().int().min(0),
    waitingFareYenPerMin: z.number().int().min(0),
  })
  .strict();

function versionsTakeFromQuery(q: unknown): number {
  const raw = typeof q === "object" && q !== null && "versionsLimit" in q ? String((q as { versionsLimit?: string }).versionsLimit ?? "") : "";
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return Math.min(100, Math.max(1, n));
}

export async function registerTariffRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tariff-plans", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const take = versionsTakeFromQuery(req.query);
    const rows = await prisma.tariffPlan.findMany({
      where: { tenantId: tid },
      include: { versions: { orderBy: { version: "desc" }, take, include: { segments: true } } },
      orderBy: { name: "asc" },
    });
    return { plans: rows };
  });

  app.post<{ Body: { name?: string } }>("/tariff-plans", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const name = String(req.body?.name || "").trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    const plan = await prisma.tariffPlan.create({ data: { tenantId: tid, name } });
    const ver = await prisma.tariffPlanVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        initialDistanceM: 2000,
        initialFareYen: 800,
        addUnitDistanceM: 200,
        addFareYen: 100,
        waitingFareYenPerMin: 0,
      },
    });
    return { plan, version: ver };
  });

  app.post<{
    Params: { planId: string };
    Body: {
      initialDistanceM?: number;
      initialFareYen?: number;
      addUnitDistanceM?: number;
      addFareYen?: number;
      waitingFareYenPerMin?: number;
    };
  }>("/tariff-plans/:planId/versions", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const plan = await prisma.tariffPlan.findFirst({ where: { id: req.params.planId, tenantId: tid } });
    if (!plan) return reply.code(404).send({ error: "not found" });
    const last = await prisma.tariffPlanVersion.findFirst({
      where: { planId: plan.id },
      orderBy: { version: "desc" },
      include: { segments: true },
    });
    const versionNum = (last?.version ?? 0) + 1;

    const body = req.body as Record<string, unknown> | undefined;
    const fromBody = (key: string): number | undefined => {
      const raw = body?.[key];
      if (raw === undefined || raw === null || raw === "") return undefined;
      const n = Math.floor(Number(raw));
      return Number.isFinite(n) ? n : undefined;
    };

    const initialDistanceM = Math.max(0, fromBody("initialDistanceM") ?? last?.initialDistanceM ?? 2000);
    const initialFareYen = Math.max(0, fromBody("initialFareYen") ?? last?.initialFareYen ?? 800);
    const addUnitDistanceM = Math.max(1, fromBody("addUnitDistanceM") ?? last?.addUnitDistanceM ?? 200);
    const addFareYen = Math.max(0, fromBody("addFareYen") ?? last?.addFareYen ?? 100);
    const waitingFareYenPerMin = Math.max(0, fromBody("waitingFareYenPerMin") ?? last?.waitingFareYenPerMin ?? 0);

    const ver = await prisma.tariffPlanVersion.create({
      data: {
        planId: plan.id,
        version: versionNum,
        initialDistanceM,
        initialFareYen,
        addUnitDistanceM,
        addFareYen,
        waitingFareYenPerMin,
      },
    });

    if (last?.segments?.length) {
      await prisma.tariffSegment.createMany({
        data: last.segments.map((s) => ({
          versionId: ver.id,
          fromM: s.fromM,
          toM: s.toM,
          fareYen: s.fareYen,
        })),
      });
    }

    const full = await prisma.tariffPlanVersion.findFirst({
      where: { id: ver.id },
      include: { segments: true },
    });
    return full ?? ver;
  });

  app.patch<{
    Params: { versionId: string };
    Body: z.infer<typeof versionPatchBodySchema>;
  }>("/tariff-versions/:versionId", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const ver = await prisma.tariffPlanVersion.findFirst({
      where: { id: req.params.versionId, plan: { tenantId: tid } },
    });
    if (!ver) return reply.code(404).send({ error: "version not found" });
    const parsed = versionPatchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const updated = await prisma.tariffPlanVersion.update({
      where: { id: ver.id },
      data: {
        initialDistanceM: b.initialDistanceM,
        initialFareYen: b.initialFareYen,
        addUnitDistanceM: b.addUnitDistanceM,
        addFareYen: b.addFareYen,
        waitingFareYenPerMin: b.waitingFareYenPerMin,
      },
      include: { segments: true },
    });
    return updated;
  });

  app.post<{
    Params: { versionId: string };
    Body: { fromM?: number; toM?: number; fareYen?: number };
  }>("/tariff-versions/:versionId/segments", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const ver = await prisma.tariffPlanVersion.findFirst({
      where: { id: req.params.versionId, plan: { tenantId: tid } },
    });
    if (!ver) return reply.code(404).send({ error: "version not found" });
    const fromM = Math.floor(Number(req.body?.fromM ?? NaN));
    const toM = Math.floor(Number(req.body?.toM ?? NaN));
    const fareYen = Math.floor(Number(req.body?.fareYen ?? NaN));
    if (!Number.isFinite(fromM) || !Number.isFinite(toM) || !Number.isFinite(fareYen)) {
      return reply.code(400).send({ error: "fromM, toM, fareYen required as numbers" });
    }
    if (fromM > toM) return reply.code(400).send({ error: "fromM must be <= toM" });
    const seg = await prisma.tariffSegment.create({
      data: { versionId: ver.id, fromM, toM, fareYen },
    });
    return seg;
  });

  app.delete<{ Params: { segmentId: string } }>(
    "/tariff-segments/:segmentId",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const tid = tenantIdFromReq(req);
      const seg = await prisma.tariffSegment.findFirst({
        where: { id: req.params.segmentId, version: { plan: { tenantId: tid } } },
      });
      if (!seg) return reply.code(404).send({ error: "not found" });
      await prisma.tariffSegment.delete({ where: { id: seg.id } });
      return { ok: true };
    },
  );
}
