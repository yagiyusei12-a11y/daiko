import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { authenticateAndBilling } from "../auth/protected-pre.js";
import { jwtUser } from "../auth/pre.js";
import { prisma } from "../db.js";
import { loadUserAccess } from "../lib/permissions.js";

const MAX_TRIP_LEGS = 50;

function parseCsvIds(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  const s = Array.isArray(raw) ? raw.join(",") : String(raw);
  return [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
}

function parseViaStopsJson(raw: unknown, viaNote: string | null): string[] {
  if (Array.isArray(raw)) {
    const xs = raw.filter((x): x is string => typeof x === "string").map((v) => v.trim()).filter(Boolean);
    if (xs.length > 0) return xs;
  }
  if (viaNote?.trim()) {
    return viaNote
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function empDisplay(e: { id: string; familyName: string; givenName: string }): { id: string; name: string } {
  return { id: e.id, name: `${e.familyName} ${e.givenName}`.trim() };
}

export async function registerTripLegRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticateAndBilling);

  app.get("/trip-legs", async (req) => {
    const { tenantId, sub: userId } = jwtUser(req);
    const access = await loadUserAccess(userId, tenantId);
    const q = req.query as Record<string, unknown>;

    const clientName = String(q.clientName ?? "").trim();
    const charterVehicleNo = String(q.charterVehicleNo ?? "").trim();
    const tripReceiptIssuedRaw = String(q.tripReceiptIssued ?? "").trim().toLowerCase();

    const mainEmployeeIds = parseCsvIds(q.mainEmployeeIds);
    const partnerEmployeeIds = parseCsvIds(q.partnerEmployeeIds);
    const escortVehicleIds = parseCsvIds(q.escortVehicleIds);
    const tripPaymentMethods = parseCsvIds(q.tripPaymentMethods);

    const reportWhere: Prisma.DailyReportWhereInput = { tenantId };

    if (access.isStaffShiftOnly && access.employeeId) {
      reportWhere.mainEmployeeId = access.employeeId;
    } else {
      if (mainEmployeeIds.length > 0) {
        reportWhere.mainEmployeeId = { in: mainEmployeeIds };
      }
      if (partnerEmployeeIds.length > 0) {
        reportWhere.partnerEmployeeId = { in: partnerEmployeeIds };
      }
    }

    if (escortVehicleIds.length > 0) {
      reportWhere.escortVehicleId = { in: escortVehicleIds };
    }

    const tripWhere: Prisma.TripLegWhereInput = {
      dailyReport: reportWhere,
    };

    if (clientName) {
      tripWhere.clientName = { contains: clientName, mode: "insensitive" };
    }
    if (charterVehicleNo) {
      tripWhere.charterVehicleNo = { contains: charterVehicleNo, mode: "insensitive" };
    }
    if (tripPaymentMethods.length > 0) {
      tripWhere.tripPaymentMethod = { in: tripPaymentMethods };
    }
    if (tripReceiptIssuedRaw === "true") {
      tripWhere.tripReceiptIssued = true;
    } else if (tripReceiptIssuedRaw === "false") {
      tripWhere.tripReceiptIssued = false;
    }

    const legs = await prisma.tripLeg.findMany({
      where: tripWhere,
      orderBy: [{ departedAt: "desc" }, { id: "desc" }],
      take: MAX_TRIP_LEGS,
      include: {
        dailyReport: {
          select: {
            id: true,
            businessDate: true,
            mainEmployee: { select: { id: true, familyName: true, givenName: true } },
            partnerEmployee: { select: { id: true, familyName: true, givenName: true } },
            escortVehicle: { select: { id: true, label: true } },
          },
        },
      },
    });

    return {
      trips: legs.map((t) => ({
        id: t.id,
        dailyReportId: t.dailyReportId,
        businessDate: t.dailyReport.businessDate,
        departedAt: t.departedAt.toISOString(),
        arrivedAt: t.arrivedAt.toISOString(),
        clientName: t.clientName,
        charterVehicleNo: t.charterVehicleNo,
        origin: t.origin,
        destination: t.destination,
        viaStops: parseViaStopsJson(t.viaStopsJson, t.viaNote),
        fareYen: t.fareYen,
        parkingAdvanceYen: t.parkingAdvanceYen,
        tripPaymentMethod: t.tripPaymentMethod,
        tripReceiptIssued: t.tripReceiptIssued,
        accompanyingCrewName: t.accompanyingCrewName,
        mainEmployee: empDisplay(t.dailyReport.mainEmployee),
        partnerEmployee: t.dailyReport.partnerEmployee ? empDisplay(t.dailyReport.partnerEmployee) : null,
        escortVehicle: t.dailyReport.escortVehicle
          ? { id: t.dailyReport.escortVehicle.id, label: t.dailyReport.escortVehicle.label }
          : null,
      })),
    };
  });
}
