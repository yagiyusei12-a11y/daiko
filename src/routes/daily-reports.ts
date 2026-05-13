import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { coercePricingPrefs, mergeLegSurchargesJson, tripSurchargeDefaults } from "../lib/pricing-prefs.js";

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 経由地 JSON（string[]）を検証し、空要素は除く */
function parseViaStopsJsonBody(v: unknown): { ok: true; stops: string[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: "viaStopsJson は文字列の配列である必要があります" };
  const stops: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return { ok: false, error: "viaStopsJson は文字列の配列である必要があります" };
    const t = x.trim();
    if (t) stops.push(t);
  }
  return { ok: true, stops };
}

export async function registerDailyReportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get<{ Querystring: { businessDate?: string } }>("/daily-reports", async (req) => {
    const { tenantId } = jwtUser(req);
    const q = String(req.query?.businessDate ?? "").trim();
    const where: Prisma.DailyReportWhereInput = { tenantId };
    if (q) where.businessDate = q;
    const reports = await prisma.dailyReport.findMany({
      where,
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: q ? 200 : 40,
      select: {
        id: true,
        businessDate: true,
        meterStart: true,
        meterEnd: true,
        vehicle: { select: { label: true } },
        mainEmployee: { select: { familyName: true, givenName: true } },
      },
    });
    return {
      reports: reports.map((r) => ({
        id: r.id,
        businessDate: r.businessDate,
        meterStart: r.meterStart,
        meterEnd: r.meterEnd,
        vehicleLabel: r.vehicle.label,
        mainEmployeeName: `${r.mainEmployee.familyName} ${r.mainEmployee.givenName}`,
      })),
    };
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

    let partnerEmployeeId: string | null = null;
    if (b.partnerEmployeeId !== undefined && b.partnerEmployeeId !== null && String(b.partnerEmployeeId).trim()) {
      const pid = String(b.partnerEmployeeId).trim();
      if (pid === mainEmployeeId) return reply.code(400).send({ error: "partner must differ from main employee" });
      const p = await prisma.employee.findFirst({ where: { id: pid, tenantId, status: "ACTIVE" } });
      if (!p) return reply.code(400).send({ error: "invalid partnerEmployeeId" });
      partnerEmployeeId = pid;
    }

    let escortVehicleId: string | null = null;
    if (b.escortVehicleId !== undefined && b.escortVehicleId !== null && String(b.escortVehicleId).trim()) {
      const eid = String(b.escortVehicleId).trim();
      const ev = await prisma.vehicle.findFirst({ where: { id: eid, tenantId } });
      if (!ev) return reply.code(400).send({ error: "invalid escortVehicleId" });
      escortVehicleId = eid;
    }

    let escortOdometerStartM: number | null = null;
    if (b.escortOdometerStartM !== undefined && b.escortOdometerStartM !== null && String(b.escortOdometerStartM) !== "") {
      escortOdometerStartM = Math.max(0, Math.floor(Number(b.escortOdometerStartM) || 0));
    }

    const dr = await prisma.dailyReport.create({
      data: {
        tenantId,
        businessDate,
        vehicleId,
        mainEmployeeId,
        partnerEmployeeId,
        escortVehicleId,
        escortOdometerStartM,
        meterStart,
        meterEnd,
      },
    });
    return { id: dr.id };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/daily-reports/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id);
    const dr = await prisma.dailyReport.findFirst({ where: { id, tenantId } });
    if (!dr) return reply.code(404).send({ error: "not found" });
    const b = req.body || {};
    const data: Prisma.DailyReportUpdateInput = {};

    if (b.partnerEmployeeId !== undefined) {
      const raw = b.partnerEmployeeId;
      if (raw === null || raw === "") {
        data.partnerEmployee = { disconnect: true };
      } else {
        const pid = String(raw).trim();
        if (pid === dr.mainEmployeeId) return reply.code(400).send({ error: "partner must differ from main employee" });
        const p = await prisma.employee.findFirst({ where: { id: pid, tenantId, status: "ACTIVE" } });
        if (!p) return reply.code(400).send({ error: "invalid partnerEmployeeId" });
        data.partnerEmployee = { connect: { id: pid } };
      }
    }

    if (b.escortVehicleId !== undefined) {
      const raw = b.escortVehicleId;
      if (raw === null || raw === "") {
        data.escortVehicle = { disconnect: true };
      } else {
        const vid = String(raw).trim();
        const v = await prisma.vehicle.findFirst({ where: { id: vid, tenantId } });
        if (!v) return reply.code(400).send({ error: "invalid escortVehicleId" });
        data.escortVehicle = { connect: { id: vid } };
      }
    }

    if (b.escortOdometerStartM !== undefined) {
      if (b.escortOdometerStartM === null || b.escortOdometerStartM === "") {
        data.escortOdometerStartM = null;
      } else {
        data.escortOdometerStartM = Math.max(0, Math.floor(Number(b.escortOdometerStartM) || 0));
      }
    }

    if (b.escortOdometerEndM !== undefined) {
      if (b.escortOdometerEndM === null || b.escortOdometerEndM === "") {
        data.escortOdometerEndM = null;
      } else {
        data.escortOdometerEndM = Math.max(0, Math.floor(Number(b.escortOdometerEndM) || 0));
      }
    }

    await prisma.dailyReport.update({ where: { id }, data });
    return { ok: true };
  });

  app.get("/daily-reports/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String((req.params as { id: string }).id);
    const report = await prisma.dailyReport.findFirst({
      where: { id, tenantId },
      include: {
        trips: { orderBy: { id: "asc" } },
        vehicle: { select: { id: true, label: true, plate: true } },
        escortVehicle: { select: { id: true, label: true, plate: true } },
        mainEmployee: { select: { id: true, familyName: true, givenName: true } },
        partnerEmployee: { select: { id: true, familyName: true, givenName: true } },
      },
    });
    if (!report) return reply.code(404).send({ error: "not found" });
    const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const prefs = coercePricingPrefs(asObj(settings?.customJson).pricingPrefs);

    const tariffVersions = await prisma.tariffPlanVersion.findMany({
      where: { plan: { tenantId } },
      select: {
        id: true,
        version: true,
        validTo: true,
        plan: { select: { id: true, name: true } },
      },
      orderBy: [{ plan: { name: "asc" } }, { version: "desc" }],
    });

    const employees = await prisma.employee.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, familyName: true, givenName: true },
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    });
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId, active: true },
      select: { id: true, label: true, plate: true },
      orderBy: { label: "asc" },
    });

    return {
      report,
      employees,
      vehicles,
      tariffVersions: tariffVersions.map((tv) => ({
        id: tv.id,
        label: `${tv.plan.name}（v${tv.version}）${tv.validTo ? " ※終了版" : ""}`,
        planId: tv.plan.id,
        version: tv.version,
      })),
      pricingDefaults: tripSurchargeDefaults(prefs),
      pricingFeatures: prefs.features,
    };
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
        clientName: "",
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
      if (typeof b.charterVehicleNo === "string") data.charterVehicleNo = b.charterVehicleNo.trim() || null;
      if (typeof b.origin === "string") data.origin = b.origin;
      if (typeof b.destination === "string") data.destination = b.destination;

      if (b.viaStopsJson !== undefined) {
        const parsed = parseViaStopsJsonBody(b.viaStopsJson);
        if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
        data.viaStopsJson = parsed.stops as Prisma.InputJsonValue;
        data.viaNote = parsed.stops.length ? parsed.stops.join("\n") : null;
        data.viaStopCount = parsed.stops.length;
      } else if (typeof b.viaNote === "string") {
        const trimmed = b.viaNote.trim() || null;
        data.viaNote = trimmed;
        const lines = b.viaNote.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
        data.viaStopsJson = lines;
        data.viaStopCount = lines.length;
      }
      if (b.fareYen !== undefined) data.fareYen = Math.max(0, Math.floor(Number(b.fareYen) || 0));
      if (b.parkingAdvanceYen !== undefined) data.parkingAdvanceYen = Math.max(0, Math.floor(Number(b.parkingAdvanceYen) || 0));
      if (b.tripMeterStartM !== undefined) {
        data.tripMeterStartM =
          b.tripMeterStartM === null || b.tripMeterStartM === "" ? null : Math.max(0, Math.floor(Number(b.tripMeterStartM) || 0));
      }
      if (b.tripMeterEndM !== undefined) {
        data.tripMeterEndM =
          b.tripMeterEndM === null || b.tripMeterEndM === "" ? null : Math.max(0, Math.floor(Number(b.tripMeterEndM) || 0));
      }
      if (b.distanceM !== undefined) data.distanceM = Math.max(0, Math.floor(Number(b.distanceM) || 0));

      if (typeof b.departedAt === "string" && String(b.departedAt).trim()) {
        const d = new Date(String(b.departedAt));
        if (!Number.isNaN(d.getTime())) data.departedAt = d;
      }
      if (typeof b.arrivedAt === "string" && String(b.arrivedAt).trim()) {
        const d = new Date(String(b.arrivedAt));
        if (!Number.isNaN(d.getTime())) data.arrivedAt = d;
      }

      if (b.tariffVersionId !== undefined) {
        if (b.tariffVersionId === null || b.tariffVersionId === "") {
          data.tariffVersion = { disconnect: true };
        } else {
          const tid = String(b.tariffVersionId).trim();
          const tv = await prisma.tariffPlanVersion.findFirst({
            where: { id: tid, plan: { tenantId } },
            select: { id: true },
          });
          if (!tv) return reply.code(400).send({ error: "invalid tariffVersionId" });
          data.tariffVersion = { connect: { id: tid } };
        }
      }

      if (typeof b.applyNightSurcharge === "boolean") data.applyNightSurcharge = b.applyNightSurcharge;
      if (typeof b.applyNightSurchargeFlat === "boolean") data.applyNightSurchargeFlat = b.applyNightSurchargeFlat;
      if (typeof b.applyLeftHandSurcharge === "boolean") data.applyLeftHandSurcharge = b.applyLeftHandSurcharge;
      if (typeof b.applyEarlyMorningFlatYen === "boolean") data.applyEarlyMorningFlatYen = b.applyEarlyMorningFlatYen;
      if (typeof b.applyLateNightFlatYen === "boolean") data.applyLateNightFlatYen = b.applyLateNightFlatYen;
      if (typeof b.applyEarlyRushFlatYen === "boolean") data.applyEarlyRushFlatYen = b.applyEarlyRushFlatYen;

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
