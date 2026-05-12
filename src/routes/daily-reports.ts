import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { coercePricingPrefs, mergeLegSurchargesJson, tripSurchargeDefaults } from "../lib/pricing-prefs.js";

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function registerDailyReportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/daily-reports", async (req) => {
    const { tenantId } = jwtUser(req);
    const reports = await prisma.dailyReport.findMany({
      where: { tenantId },
      orderBy: { businessDate: "desc" },
      take: 40,
      select: {
        id: true,
        businessDate: true,
        meterStart: true,
        meterEnd: true,
        vehicleId: true,
        mainEmployeeId: true,
      },
    });
    return { reports };
  });

  app.post("/daily-reports", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = (req.body || {}) as Record<string, unknown>;
    const businessDate = String(b.businessDate || "").trim();
    const vehicleId = String(b.vehicleId || "").trim();
    const mainEmployeeId = String(b.mainEmployeeId || "").trim();
    const meterStart = Math.max(0, Math.floor(Number(b.meterStart) || 0));
    const meterEnd = Math.max(0, Math.floor(Number(b.meterEnd) || 0));
    if (!businessDate || !vehicleId || !mainEmployeeId) {
      return reply.code(400).send({ error: "businessDate, vehicleId, mainEmployeeId required" });
    }
    const veh = await prisma.vehicle.findFirst({ where: { id: vehicleId, tenantId } });
    const emp = await prisma.employee.findFirst({ where: { id: mainEmployeeId, tenantId } });
    if (!veh || !emp) return reply.code(400).send({ error: "invalid vehicle or employee" });

    const dr = await prisma.dailyReport.create({
      data: {
        tenantId,
        businessDate,
        vehicleId,
        mainEmployeeId,
        meterStart,
        meterEnd,
      },
    });
    const now = new Date();
    await prisma.tripLeg.create({
      data: {
        dailyReportId: dr.id,
        clientName: "お客様",
        origin: "",
        destination: "",
        departedAt: now,
        arrivedAt: now,
        distanceM: 0,
        fareYen: 0,
        legSurchargesJson: {},
      },
    });
    return { id: dr.id };
  });

  app.get("/daily-reports/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String((req.params as { id: string }).id);
    const report = await prisma.dailyReport.findFirst({
      where: { id, tenantId },
      include: {
        trips: { orderBy: { id: "asc" } },
        vehicle: { select: { id: true, label: true } },
        mainEmployee: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    if (!report) return reply.code(404).send({ error: "not found" });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const prefs = coercePricingPrefs(asObj(settings?.customJson).pricingPrefs);
    return { report, pricingDefaults: tripSurchargeDefaults(prefs), pricingFeatures: prefs.features };
  });

  app.post("/daily-reports/:id/trips", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const rid = String((req.params as { id: string }).id);
    const dr = await prisma.dailyReport.findFirst({ where: { id: rid, tenantId } });
    if (!dr) return reply.code(404).send({ error: "not found" });
    const now = new Date();
    const leg = await prisma.tripLeg.create({
      data: {
        dailyReportId: rid,
        clientName: "お客様",
        origin: "",
        destination: "",
        departedAt: now,
        arrivedAt: now,
        distanceM: 0,
        fareYen: 0,
        legSurchargesJson: {},
      },
    });
    return { id: leg.id };
  });

  app.patch<{ Params: { id: string; tripId: string }; Body: Record<string, unknown> }>(
    "/daily-reports/:id/trips/:tripId",
    async (req, reply) => {
      const { tenantId } = jwtUser(req);
      const rid = String(req.params.id);
      const tripId = String(req.params.tripId);
      const dr = await prisma.dailyReport.findFirst({ where: { id: rid, tenantId } });
      if (!dr) return reply.code(404).send({ error: "not found" });
      const trip = await prisma.tripLeg.findFirst({ where: { id: tripId, dailyReportId: rid } });
      if (!trip) return reply.code(404).send({ error: "trip not found" });
      const b = req.body || {};

      const data: Prisma.TripLegUpdateInput = {};

      if (typeof b.clientName === "string") data.clientName = b.clientName.trim();
      if (typeof b.origin === "string") data.origin = b.origin;
      if (typeof b.destination === "string") data.destination = b.destination;
      if (b.fareYen !== undefined) data.fareYen = Math.max(0, Math.floor(Number(b.fareYen) || 0));

      if (b.legSurchargesJson !== undefined) {
        const merged = mergeLegSurchargesJson(trip.legSurchargesJson, b.legSurchargesJson);
        data.legSurchargesJson = merged as Prisma.InputJsonValue;
        const left = merged.leftHand as { apply?: boolean } | undefined;
        if (left !== undefined) {
          data.applyLeftHandSurchargeFlat = Boolean(left.apply);
        }
      }

      await prisma.tripLeg.update({ where: { id: tripId }, data });
      return { ok: true };
    },
  );
}
