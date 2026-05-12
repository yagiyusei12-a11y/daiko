import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../auth/pre.js";
import { prisma } from "../db.js";
import { PickupRuleJsonSchema } from "../lib/pickup-pricing.js";
import { WaitingRuleSchema } from "../lib/tariff-waiting.js";
import { tenantIdFromReq } from "./tenant-scope.js";

const distanceModeSchema = z.enum(["INITIAL_ADD", "SEGMENTS_ONLY", "TIERED_ADD"]);

const versionPatchBodySchema = z
  .object({
    initialDistanceM: z.number().int().min(0),
    initialFareYen: z.number().int().min(0),
    addUnitDistanceM: z.number().int().min(1),
    addFareYen: z.number().int().min(0),
    waitingFareYenPerMin: z.number().int().min(0),
    distanceMode: distanceModeSchema.optional(),
    waitingRuleJson: z.unknown().optional(),
    perViaStopYen: z.number().int().min(0).optional(),
    cancellationFeeYen: z.number().int().min(0).optional(),
    nightSurchargeBps: z.number().int().optional(),
    leftHandSurchargeBps: z.number().int().optional(),
    nightSurchargeFlatYen: z.number().int().min(0).optional(),
    lateNightFlatYen: z.number().int().min(0).optional(),
    earlyMorningFlatYen: z.number().int().min(0).optional(),
    earlyRushFlatYen: z.number().int().min(0).optional(),
    pickupRuleJson: z.unknown().optional(),
    distanceDiscountFromM: z.number().int().min(0).nullable().optional(),
    distanceDiscountBps: z.number().int().optional(),
    notes: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

const tierPostBodySchema = z
  .object({
    fromM: z.number().int().min(0),
    untilM: z.number().int().min(0).nullable().optional(),
    stepM: z.number().int().min(1),
    addYenPerStep: z.number().int().min(0),
    sortOrder: z.number().int().optional(),
  })
  .strict();

const tierPatchBodySchema = z
  .object({
    fromM: z.number().int().min(0).optional(),
    untilM: z.number().int().min(0).nullable().optional(),
    stepM: z.number().int().min(1).optional(),
    addYenPerStep: z.number().int().min(0).optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

function versionsTakeFromQuery(q: unknown): number {
  const raw = typeof q === "object" && q !== null && "versionsLimit" in q ? String((q as { versionsLimit?: string }).versionsLimit ?? "") : "";
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return Math.min(100, Math.max(1, n));
}

function linearWaitingJson(perMinYen: number, graceMin = 0): Prisma.InputJsonValue {
  return { type: "linear", graceMin, perMinYen };
}

function versionsInclude(take: number): Prisma.TariffPlanInclude {
  return {
    versions: {
      orderBy: { version: "desc" },
      take,
      include: {
        segments: true,
        distanceTiers: { orderBy: { sortOrder: "asc" } },
      },
    },
  };
}

export async function registerTariffRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tariff-plans", { preHandler: [authenticate] }, async (req) => {
    const tid = tenantIdFromReq(req);
    const take = versionsTakeFromQuery(req.query);
    const rows = await prisma.tariffPlan.findMany({
      where: { tenantId: tid },
      include: versionsInclude(take),
      orderBy: { name: "asc" },
    });
    return { plans: rows };
  });

  app.delete<{ Params: { planId: string } }>("/tariff-plans/:planId", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const plan = await prisma.tariffPlan.findFirst({
      where: { id: req.params.planId, tenantId: tid },
    });
    if (!plan) return reply.code(404).send({ error: "not found" });
    await prisma.tariffPlan.delete({ where: { id: plan.id } });
    return { ok: true };
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
        waitingRuleJson: linearWaitingJson(0),
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
      include: { segments: true, distanceTiers: { orderBy: { sortOrder: "asc" } } },
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
        distanceMode: last?.distanceMode ?? "INITIAL_ADD",
        waitingRuleJson: (last?.waitingRuleJson as Prisma.InputJsonValue) ?? linearWaitingJson(waitingFareYenPerMin),
        perViaStopYen: last?.perViaStopYen ?? 0,
        cancellationFeeYen: last?.cancellationFeeYen ?? 0,
        nightSurchargeBps: last?.nightSurchargeBps ?? 0,
        leftHandSurchargeBps: last?.leftHandSurchargeBps ?? 0,
        nightSurchargeFlatYen: last?.nightSurchargeFlatYen ?? 0,
        lateNightFlatYen: last?.lateNightFlatYen ?? 0,
        earlyMorningFlatYen: last?.earlyMorningFlatYen ?? 0,
        earlyRushFlatYen: last?.earlyRushFlatYen ?? 0,
        pickupRuleJson: (last?.pickupRuleJson as Prisma.InputJsonValue) ?? [],
        distanceDiscountFromM: last?.distanceDiscountFromM ?? null,
        distanceDiscountBps: last?.distanceDiscountBps ?? 0,
        notes: last?.notes ?? null,
      },
    });

    if (last?.segments?.length) {
      await prisma.tariffSegment.createMany({
        data: last.segments.map((s) => ({
          versionId: ver.id,
          fromM: s.fromM,
          toM: s.toM,
          fareYen: s.fareYen,
          fareMemberYen: s.fareMemberYen,
        })),
      });
    }

    if (last?.distanceTiers?.length) {
      await prisma.tariffDistanceTier.createMany({
        data: last.distanceTiers.map((t) => ({
          versionId: ver.id,
          sortOrder: t.sortOrder,
          fromM: t.fromM,
          untilM: t.untilM,
          stepM: t.stepM,
          addYenPerStep: t.addYenPerStep,
        })),
      });
    }

    const full = await prisma.tariffPlanVersion.findFirst({
      where: { id: ver.id },
      include: { segments: true, distanceTiers: { orderBy: { sortOrder: "asc" } } },
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

    let waitingRuleJson: Prisma.InputJsonValue = ver.waitingRuleJson as Prisma.InputJsonValue;
    let waitingFareYenPerMin = b.waitingFareYenPerMin;

    if (b.waitingRuleJson !== undefined) {
      const wr = WaitingRuleSchema.safeParse(b.waitingRuleJson);
      if (!wr.success) {
        return reply.code(400).send({ error: "invalid waitingRuleJson", details: wr.error.flatten() });
      }
      waitingRuleJson = wr.data as unknown as Prisma.InputJsonValue;
      if (wr.data.type === "linear") {
        waitingFareYenPerMin = wr.data.perMinYen;
      }
    } else {
      waitingFareYenPerMin = b.waitingFareYenPerMin;
      if (waitingFareYenPerMin !== ver.waitingFareYenPerMin) {
        waitingRuleJson = linearWaitingJson(waitingFareYenPerMin, 0);
      }
    }

    let pickupRuleJson: Prisma.InputJsonValue | undefined;
    if (b.pickupRuleJson !== undefined) {
      const pr = PickupRuleJsonSchema.safeParse(b.pickupRuleJson);
      if (!pr.success) {
        return reply.code(400).send({ error: "invalid pickupRuleJson", details: pr.error.flatten() });
      }
      pickupRuleJson = pr.data as unknown as Prisma.InputJsonValue;
    }

    const updated = await prisma.tariffPlanVersion.update({
      where: { id: ver.id },
      data: {
        initialDistanceM: b.initialDistanceM,
        initialFareYen: b.initialFareYen,
        addUnitDistanceM: b.addUnitDistanceM,
        addFareYen: b.addFareYen,
        waitingFareYenPerMin,
        waitingRuleJson,
        ...(b.distanceMode !== undefined ? { distanceMode: b.distanceMode } : {}),
        ...(b.perViaStopYen !== undefined ? { perViaStopYen: b.perViaStopYen } : {}),
        ...(b.cancellationFeeYen !== undefined ? { cancellationFeeYen: b.cancellationFeeYen } : {}),
        ...(b.nightSurchargeBps !== undefined ? { nightSurchargeBps: b.nightSurchargeBps } : {}),
        ...(b.leftHandSurchargeBps !== undefined ? { leftHandSurchargeBps: b.leftHandSurchargeBps } : {}),
        ...(b.nightSurchargeFlatYen !== undefined ? { nightSurchargeFlatYen: b.nightSurchargeFlatYen } : {}),
        ...(b.lateNightFlatYen !== undefined ? { lateNightFlatYen: b.lateNightFlatYen } : {}),
        ...(b.earlyMorningFlatYen !== undefined ? { earlyMorningFlatYen: b.earlyMorningFlatYen } : {}),
        ...(b.earlyRushFlatYen !== undefined ? { earlyRushFlatYen: b.earlyRushFlatYen } : {}),
        ...(pickupRuleJson !== undefined ? { pickupRuleJson } : {}),
        ...(b.distanceDiscountFromM !== undefined ? { distanceDiscountFromM: b.distanceDiscountFromM } : {}),
        ...(b.distanceDiscountBps !== undefined ? { distanceDiscountBps: b.distanceDiscountBps } : {}),
        ...(b.notes !== undefined ? { notes: b.notes } : {}),
      },
      include: { segments: true, distanceTiers: { orderBy: { sortOrder: "asc" } } },
    });
    return updated;
  });

  app.post<{
    Params: { versionId: string };
    Body: { fromM?: number; toM?: number; fareYen?: number; fareMemberYen?: number | null };
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
    let fareMemberYen: number | null | undefined = undefined;
    if (req.body?.fareMemberYen !== undefined && req.body.fareMemberYen !== null) {
      const fm = Math.floor(Number(req.body.fareMemberYen));
      if (!Number.isFinite(fm)) return reply.code(400).send({ error: "invalid fareMemberYen" });
      fareMemberYen = fm;
    } else if (req.body?.fareMemberYen === null) {
      fareMemberYen = null;
    }
    const seg = await prisma.tariffSegment.create({
      data: {
        versionId: ver.id,
        fromM,
        toM,
        fareYen,
        ...(fareMemberYen !== undefined ? { fareMemberYen } : {}),
      },
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

  app.post<{
    Params: { versionId: string };
    Body: z.infer<typeof tierPostBodySchema>;
  }>("/tariff-versions/:versionId/distance-tiers", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const ver = await prisma.tariffPlanVersion.findFirst({
      where: { id: req.params.versionId, plan: { tenantId: tid } },
    });
    if (!ver) return reply.code(404).send({ error: "version not found" });
    const parsed = tierPostBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const untilM = b.untilM === undefined ? null : b.untilM;
    if (untilM !== null && untilM <= b.fromM) {
      return reply.code(400).send({ error: "untilM must be null or greater than fromM" });
    }
    let sortOrder = b.sortOrder;
    if (sortOrder === undefined) {
      const agg = await prisma.tariffDistanceTier.aggregate({
        where: { versionId: ver.id },
        _max: { sortOrder: true },
      });
      sortOrder = (agg._max.sortOrder ?? -1) + 1;
    }
    const tier = await prisma.tariffDistanceTier.create({
      data: {
        versionId: ver.id,
        sortOrder,
        fromM: b.fromM,
        untilM,
        stepM: b.stepM,
        addYenPerStep: b.addYenPerStep,
      },
    });
    return tier;
  });

  app.patch<{
    Params: { tierId: string };
    Body: z.infer<typeof tierPatchBodySchema>;
  }>("/tariff-distance-tiers/:tierId", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const tier = await prisma.tariffDistanceTier.findFirst({
      where: { id: req.params.tierId, version: { plan: { tenantId: tid } } },
    });
    if (!tier) return reply.code(404).send({ error: "not found" });
    const parsed = tierPatchBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid body", details: parsed.error.flatten() });
    }
    const b = parsed.data;
    const fromM = b.fromM ?? tier.fromM;
    const untilM = b.untilM === undefined ? tier.untilM : b.untilM;
    if (untilM !== null && untilM <= fromM) {
      return reply.code(400).send({ error: "untilM must be null or greater than fromM" });
    }
    const updated = await prisma.tariffDistanceTier.update({
      where: { id: tier.id },
      data: {
        ...(b.fromM !== undefined ? { fromM: b.fromM } : {}),
        ...(b.untilM !== undefined ? { untilM: b.untilM } : {}),
        ...(b.stepM !== undefined ? { stepM: b.stepM } : {}),
        ...(b.addYenPerStep !== undefined ? { addYenPerStep: b.addYenPerStep } : {}),
        ...(b.sortOrder !== undefined ? { sortOrder: b.sortOrder } : {}),
      },
    });
    return updated;
  });

  app.delete<{ Params: { tierId: string } }>("/tariff-distance-tiers/:tierId", { preHandler: [authenticate] }, async (req, reply) => {
    const tid = tenantIdFromReq(req);
    const tier = await prisma.tariffDistanceTier.findFirst({
      where: { id: req.params.tierId, version: { plan: { tenantId: tid } } },
    });
    if (!tier) return reply.code(404).send({ error: "not found" });
    await prisma.tariffDistanceTier.delete({ where: { id: tier.id } });
    return { ok: true };
  });
}
