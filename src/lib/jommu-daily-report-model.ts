/** 日報から乗務記録簿（JommuKirokuboModel）を組み立てる。 */

import { TimeCardPunchKind } from "@prisma/client";
import { prisma } from "../db.js";
import type { JommuKirokuboModel, JommuTripRow } from "./jommu-kirokubo-html.js";

export function hmTokyo(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function viaTextFromTripRow(t: { viaStopsJson: unknown; viaNote: string | null }): string {
  const raw = t.viaStopsJson;
  if (Array.isArray(raw)) {
    const xs = raw.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
    if (xs.length > 0) return xs.join(" · ");
  }
  if (t.viaNote) {
    return t.viaNote
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

export function formatKmFromMeters(m: number): string {
  if (!Number.isFinite(m) || m < 0) return "";
  const km = m / 1000;
  const s = km.toFixed(1).replace(/\.0$/, "");
  return s;
}

export async function loadJommuKirokuboModelForDailyReport(
  tenantId: string,
  reportId: string,
): Promise<JommuKirokuboModel | null> {
  const report = await prisma.dailyReport.findFirst({
    where: { id: reportId, tenantId },
    include: {
      trips: { orderBy: { id: "asc" } },
      mainEmployee: { select: { familyName: true, givenName: true } },
      partnerEmployee: { select: { familyName: true, givenName: true } },
      escortVehicle: { select: { label: true, plate: true } },
      tenant: { select: { name: true } },
    },
  });
  if (!report) return null;

  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  const tradeName = (settings?.legalTradeName?.trim() || report.tenant.name).trim();
  const officeName = (settings?.legalMainOfficeName?.trim() || tradeName).trim();
  const safetyManagerName = settings?.legalSafetyManagerName?.trim() ?? "";

  const punches = await prisma.timeCardPunch.findMany({
    where: { tenantId, employeeId: report.mainEmployeeId, businessDate: report.businessDate },
    orderBy: { punchedAt: "asc" },
  });
  const clockInAt = punches.find((p) => p.kind === TimeCardPunchKind.CLOCK_IN)?.punchedAt ?? null;
  const clockOutPunches = punches.filter((p) => p.kind === TimeCardPunchKind.CLOCK_OUT);
  const clockOutAt = clockOutPunches.length ? clockOutPunches[clockOutPunches.length - 1]!.punchedAt : null;

  const vid = report.escortVehicleId;
  let odoStartKm: string | null = null;
  let odoEndKm: string | null = null;
  if (vid && clockInAt) {
    const startLog = await prisma.vehicleOdometerLog.findFirst({
      where: { tenantId, vehicleId: vid, createdAt: { gte: clockInAt } },
      orderBy: { createdAt: "asc" },
    });
    if (startLog) odoStartKm = String(startLog.value);
    if (clockOutAt) {
      const endLog = await prisma.vehicleOdometerLog.findFirst({
        where: { tenantId, vehicleId: vid, createdAt: { lte: clockOutAt } },
        orderBy: { createdAt: "desc" },
      });
      if (endLog) odoEndKm = String(endLog.value);
    }
  }

  let totalOdoKm: string | null = null;
  if (odoStartKm != null && odoEndKm != null) {
    const a = Number(odoStartKm);
    const b = Number(odoEndKm);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) totalOdoKm = String(b - a);
  }

  const companyCarRegNo =
    report.escortVehicle?.plate?.trim() ||
    report.escortVehicle?.label?.trim() ||
    "";

  const accompanyingCrewName = report.partnerEmployee
    ? `${report.partnerEmployee.familyName} ${report.partnerEmployee.givenName}`.trim()
    : "";

  let sumDistanceM = 0;
  let sumFare = 0;
  const tripRows: JommuTripRow[] = report.trips.map((t) => {
    sumDistanceM += t.distanceM;
    const fare = t.fareOverrideYen != null ? t.fareOverrideYen : t.fareYen;
    sumFare += fare;
    return {
      clientName: t.clientName || "",
      charterVehicleNo: t.charterVehicleNo?.trim() || "",
      origin: t.origin || "",
      departedHm: hmTokyo(t.departedAt),
      viaText: viaTextFromTripRow(t),
      destination: t.destination || "",
      arrivedHm: hmTokyo(t.arrivedAt),
      distanceKm: formatKmFromMeters(t.distanceM),
      fareYen: fare.toLocaleString("ja-JP"),
    };
  });

  const [y, m, d] = report.businessDate.split("-");
  return {
    businessDateYmd: report.businessDate,
    yParts: { y: y ?? "", m: m ?? "", d: d ?? "" },
    crewName: `${report.mainEmployee.familyName} ${report.mainEmployee.givenName}`.trim(),
    clockInHm: clockInAt ? hmTokyo(clockInAt) : null,
    clockOutHm: clockOutAt ? hmTokyo(clockOutAt) : null,
    officeName,
    companyCarRegNo,
    safetyManagerName,
    accompanyingCrewName,
    trips: tripRows,
    odoStartKm,
    odoEndKm,
    totalOdoKm,
    actualDistanceKmSum: formatKmFromMeters(sumDistanceM) || "0",
    salesTotalYen: sumFare.toLocaleString("ja-JP"),
  };
}
