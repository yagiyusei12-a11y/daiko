import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticate, jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { coercePricingPrefs, mergeLegSurchargesJson, tripSurchargeDefaults } from "../lib/pricing-prefs.js";
import { coerceBusinessBasicsFromCustomJson } from "../lib/business-basics.js";
import { appendVehicleOdometerAndSetCurrent } from "../lib/vehicle-odometer.js";
import { hasSecondClassDriverLicense } from "../lib/employee-license.js";
import { isChromiumConfiguredForPdf } from "../lib/html-to-pdf.js";
import { renderJommuKirokuboPdf } from "../lib/jommu-excel-pdf.js";
import { userFacingJommuPdfError } from "../lib/jommu-pdf-user-error.js";
import { loadJommuKirokuboModelForDailyReport } from "../lib/jommu-daily-report-model.js";
import { listSpecialFareTariffVersions } from "../lib/sync-tariff-from-special-fares.js";

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
        mainEmployee: { select: { familyName: true, givenName: true } },
        escortVehicle: { select: { label: true } },
      },
    });
    return {
      reports: reports.map((r) => ({
        id: r.id,
        businessDate: r.businessDate,
        meterStart: r.meterStart,
        meterEnd: r.meterEnd,
        mainEmployeeName: `${r.mainEmployee.familyName} ${r.mainEmployee.givenName}`,
        escortVehicleLabel: r.escortVehicle?.label ?? null,
      })),
    };
  });

  app.post("/daily-reports", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const b = (req.body || {}) as Record<string, unknown>;
    const businessDate = String(b.businessDate || "").trim();
    const vehicleIdRaw = String(b.vehicleId ?? "").trim();
    const mainEmployeeId = String(b.mainEmployeeId || "").trim();
    const meterStart = Math.max(0, Math.floor(Number(b.meterStart) || 0));
    const meterEnd = Math.max(0, Math.floor(Number(b.meterEnd) || 0));
    if (!businessDate || !mainEmployeeId) {
      return reply.code(400).send({ error: "businessDate, mainEmployeeId required" });
    }
    let vehicleId: string | null = null;
    if (vehicleIdRaw) {
      const veh = await prisma.vehicle.findFirst({ where: { id: vehicleIdRaw, tenantId } });
      if (!veh) return reply.code(400).send({ error: "invalid vehicleId" });
      vehicleId = vehicleIdRaw;
    }
    const emp = await prisma.employee.findFirst({ where: { id: mainEmployeeId, tenantId } });
    if (!emp) return reply.code(400).send({ error: "invalid employee" });
    if (!hasSecondClassDriverLicense(emp.registerExtension)) {
      return reply.code(400).send({ error: "客車担当者は第二種免許を登録した従業員を選んでください" });
    }

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

    const dupReport = await prisma.dailyReport.findFirst({
      where: {
        tenantId,
        businessDate,
        mainEmployeeId,
        escortVehicleId,
      },
      select: { id: true },
    });
    if (dupReport) {
      return reply.code(409).send({
        error:
          "この事業日・客車担当・随伴車の組み合わせの日報は既にあります。随伴車を変える場合は新しい日報を作成してください。",
      });
    }

    let escortOdometerStartM: number | null = null;
    if (b.escortOdometerStartM !== undefined && b.escortOdometerStartM !== null && String(b.escortOdometerStartM) !== "") {
      escortOdometerStartM = Math.max(0, Math.floor(Number(b.escortOdometerStartM) || 0));
    }

    if (escortVehicleId && escortOdometerStartM != null) {
      const veh = await prisma.vehicle.findFirst({ where: { id: escortVehicleId, tenantId }, select: { currentOdometer: true } });
      const curOdo = veh?.currentOdometer;
      if (curOdo != null && escortOdometerStartM < curOdo) {
        return reply.code(400).send({
          error: `随伴車の開始ODOは車両マスタの現在ODO（${curOdo}）以上にしてください`,
        });
      }
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

    if (escortVehicleId && escortOdometerStartM != null) {
      const cur = await prisma.vehicle.findUnique({ where: { id: escortVehicleId }, select: { currentOdometer: true } });
      if (cur?.currentOdometer !== escortOdometerStartM) {
        await appendVehicleOdometerAndSetCurrent(prisma, {
          tenantId,
          vehicleId: escortVehicleId,
          value: escortOdometerStartM,
          source: "DAILY_REPORT",
          dailyReportId: dr.id,
          businessDate,
        });
      }
    }
    if (vehicleId) {
      const cand = meterEnd ?? meterStart;
      const cur = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { currentOdometer: true } });
      if (cur?.currentOdometer !== cand) {
        await appendVehicleOdometerAndSetCurrent(prisma, {
          tenantId,
          vehicleId,
          value: cand,
          source: "DAILY_REPORT",
          dailyReportId: dr.id,
          businessDate,
        });
      }
    }

    return { id: dr.id };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/daily-reports/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id);
    const dr = await prisma.dailyReport.findFirst({ where: { id, tenantId } });
    if (!dr) return reply.code(404).send({ error: "not found" });
    const b = req.body || {};
    const data: Prisma.DailyReportUpdateInput = {};

    if (b.vehicleId !== undefined) {
      const raw = b.vehicleId;
      if (raw === null || raw === "") {
        data.vehicle = { disconnect: true };
      } else {
        const vid = String(raw).trim();
        const v = await prisma.vehicle.findFirst({ where: { id: vid, tenantId } });
        if (!v) return reply.code(400).send({ error: "invalid vehicleId" });
        data.vehicle = { connect: { id: vid } };
      }
    }

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
      const nextEscort = raw === null || raw === "" ? null : String(raw).trim();
      const dupOther = await prisma.dailyReport.findFirst({
        where: {
          tenantId,
          businessDate: dr.businessDate,
          mainEmployeeId: dr.mainEmployeeId,
          escortVehicleId: nextEscort,
          NOT: { id },
        },
        select: { id: true },
      });
      if (dupOther) {
        return reply.code(409).send({
          error:
            "この事業日・客車担当・随伴車の組み合わせの日報が既に存在します。随伴車を変える場合は新しい日報を作成してください。",
        });
      }
      if (raw === null || raw === "") {
        data.escortVehicle = { disconnect: true };
      } else {
        const vid = nextEscort as string;
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

    if (b.meterStart !== undefined) {
      data.meterStart = Math.max(0, Math.floor(Number(b.meterStart) || 0));
    }
    if (b.meterEnd !== undefined) {
      data.meterEnd = Math.max(0, Math.floor(Number(b.meterEnd) || 0));
    }

    let previewEscortVid = dr.escortVehicleId;
    if (b.escortVehicleId !== undefined) {
      previewEscortVid = b.escortVehicleId === null || b.escortVehicleId === "" ? null : String(b.escortVehicleId).trim();
    }
    let previewEscortStart = dr.escortOdometerStartM;
    if (b.escortOdometerStartM !== undefined) {
      previewEscortStart =
        b.escortOdometerStartM === null || b.escortOdometerStartM === ""
          ? null
          : Math.max(0, Math.floor(Number(b.escortOdometerStartM) || 0));
    }
    let previewEscortEnd = dr.escortOdometerEndM;
    if (b.escortOdometerEndM !== undefined) {
      previewEscortEnd =
        b.escortOdometerEndM === null || b.escortOdometerEndM === ""
          ? null
          : Math.max(0, Math.floor(Number(b.escortOdometerEndM) || 0));
    }
    for (const [odoLabel, odoVal] of [
      ["開始ODO", previewEscortStart],
      ["終了ODO", previewEscortEnd],
    ] as const) {
      if (previewEscortVid && odoVal != null) {
        const veh = await prisma.vehicle.findFirst({
          where: { id: previewEscortVid, tenantId },
          select: { currentOdometer: true },
        });
        const curOdo = veh?.currentOdometer;
        if (curOdo != null && odoVal < curOdo) {
          return reply.code(400).send({
            error: `随伴車の${odoLabel}は車両マスタの現在ODO（${curOdo}）以上にしてください`,
          });
        }
      }
    }

    await prisma.dailyReport.update({ where: { id }, data });

    const after = await prisma.dailyReport.findFirst({
      where: { id, tenantId },
      select: {
        businessDate: true,
        vehicleId: true,
        escortVehicleId: true,
        meterStart: true,
        meterEnd: true,
        escortOdometerStartM: true,
        escortOdometerEndM: true,
      },
    });
    if (after) {
      if (b.escortOdometerStartM !== undefined || b.escortOdometerEndM !== undefined) {
        const vid = after.escortVehicleId;
        if (vid) {
          const cand = after.escortOdometerEndM ?? after.escortOdometerStartM;
          if (cand != null) {
            const cur = await prisma.vehicle.findUnique({ where: { id: vid }, select: { currentOdometer: true } });
            if (cur?.currentOdometer !== cand) {
              await appendVehicleOdometerAndSetCurrent(prisma, {
                tenantId,
                vehicleId: vid,
                value: cand,
                source: "DAILY_REPORT",
                dailyReportId: id,
                businessDate: after.businessDate,
              });
            }
          }
        }
      }
      if (b.meterStart !== undefined || b.meterEnd !== undefined) {
        const vid = after.vehicleId;
        if (vid) {
          const cand = after.meterEnd ?? after.meterStart;
          const cur = await prisma.vehicle.findUnique({ where: { id: vid }, select: { currentOdometer: true } });
          if (cur?.currentOdometer !== cand) {
            await appendVehicleOdometerAndSetCurrent(prisma, {
              tenantId,
              vehicleId: vid,
              value: cand,
              source: "DAILY_REPORT",
              dailyReportId: id,
              businessDate: after.businessDate,
            });
          }
        }
      }
    }

    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/daily-reports/:id", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const dr = await prisma.dailyReport.findFirst({ where: { id, tenantId } });
    if (!dr) return reply.code(404).send({ error: "not found" });
    await prisma.dailyReport.delete({ where: { id } });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/daily-reports/:id/jommu-print.html", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const id = String(req.params.id || "");
    const model = await loadJommuKirokuboModelForDailyReport(tenantId, id);
    if (!model) return reply.code(404).send({ error: "not found" });
    if (!isChromiumConfiguredForPdf()) {
      return reply.code(503).send({
        error:
          "乗務記録簿の PDF にはサーバーに Chromium または Chrome が必要です。管理者に CHROMIUM_EXECUTABLE の設定を依頼してください。",
      });
    }
    try {
      const buf = await renderJommuKirokuboPdf(model);
      const safe = `jommu_${model.businessDateYmd}`.replace(/[^\w.-]+/g, "_").slice(0, 120) || "jommu";
      return reply
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${safe}.pdf"`)
        .send(buf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.error({ err: e, jommuPdf: true, message: msg }, "jommu kirokubo pdf failed");
      return reply.code(500).send({ error: userFacingJommuPdfError(e) });
    }
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
    const basics = coerceBusinessBasicsFromCustomJson(settings?.customJson);

    const specialFarePlans = await listSpecialFareTariffVersions(prisma, tenantId, prefs);

    const employees = await prisma.employee.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, familyName: true, givenName: true },
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    });
    const vehicles = await prisma.vehicle.findMany({
      where: { tenantId, active: true },
      select: { id: true, label: true, plate: true, currentOdometer: true },
      orderBy: { label: "asc" },
    });

    return {
      report,
      employees,
      vehicles,
      tariffVersions: specialFarePlans.map((sf) => ({
        id: sf.id,
        label: sf.label,
        planId: sf.specialFareId,
        version: 1,
        specialFareId: sf.specialFareId,
        regime: sf.regime,
        distance: sf.distance,
        time: sf.time,
        extraFlatYen: sf.extraFlatYen,
        nightSurchargeBps: 0,
        nightSurchargeFlatYen: 0,
        leftHandSurchargeBps: 0,
        earlyMorningFlatYen: 0,
        lateNightFlatYen: 0,
        earlyRushFlatYen: 0,
      })),
      pricingDefaults: tripSurchargeDefaults(prefs),
      pricingFeatures: prefs.features,
      pricingForTrips: {
        regime: prefs.regime,
        mainDistance: prefs.mainDistance ?? { baseFareYen: 0, includedDistanceM: 0, addEveryM: 0, addFareYen: 0 },
        mainTime: prefs.mainTime ?? { baseFareYen: 0, includedMinutes: 0, addEveryMin: 0, addFareYen: 0 },
      },
      paymentMethods: basics.paymentMethods,
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
        tripPaymentMethod: "CASH",
        tripReceiptIssued: false,
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

      const TRIP_PAYMENT = new Set(["CASH", "CARD", "PAYPAY", "RECEIVABLE", "OTHER"]);
      if (b.tripPaymentMethod !== undefined) {
        if (b.tripPaymentMethod === null || b.tripPaymentMethod === "") {
          data.tripPaymentMethod = null;
        } else {
          const u = String(b.tripPaymentMethod).trim().toUpperCase();
          if (!TRIP_PAYMENT.has(u)) return reply.code(400).send({ error: "tripPaymentMethod が不正です" });
          data.tripPaymentMethod = u;
        }
      }
      if (typeof b.tripReceiptIssued === "boolean") data.tripReceiptIssued = b.tripReceiptIssued;

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

  app.delete<{ Params: { id: string; tripId: string } }>("/daily-reports/:id/trips/:tripId", async (req, reply) => {
    const { tenantId } = jwtUser(req);
    const rid = String(req.params.id);
    const tripId = String(req.params.tripId);
    const dr = await prisma.dailyReport.findFirst({ where: { id: rid, tenantId } });
    if (!dr) return reply.code(404).send({ error: "not found" });
    const trip = await prisma.tripLeg.findFirst({ where: { id: tripId, dailyReportId: rid } });
    if (!trip) return reply.code(404).send({ error: "trip not found" });
    await prisma.tripLeg.delete({ where: { id: tripId } });
    return { ok: true };
  });
}
