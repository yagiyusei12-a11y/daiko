import type { PrismaClient } from "@prisma/client";

export type VehicleOdometerSource = "DAILY_REPORT" | "SETTINGS";

/** 履歴1件追加し、車両マスタの currentOdometer を上書きする */
export async function appendVehicleOdometerAndSetCurrent(
  prisma: PrismaClient,
  params: {
    tenantId: string;
    vehicleId: string;
    value: number;
    source: VehicleOdometerSource;
    dailyReportId?: string | null;
    businessDate?: string | null;
  },
): Promise<void> {
  const v = Math.max(0, Math.floor(Number(params.value) || 0));
  const veh = await prisma.vehicle.findFirst({
    where: { id: params.vehicleId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!veh) return;

  await prisma.$transaction([
    prisma.vehicleOdometerLog.create({
      data: {
        tenantId: params.tenantId,
        vehicleId: params.vehicleId,
        value: v,
        source: params.source,
        dailyReportId: params.dailyReportId ?? null,
        businessDate: params.businessDate ?? null,
      },
    }),
    prisma.vehicle.update({
      where: { id: params.vehicleId },
      data: { currentOdometer: v },
    }),
  ]);
}
