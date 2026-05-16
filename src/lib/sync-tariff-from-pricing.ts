import type { PrismaClient } from "@prisma/client";
import { emptyDistanceBand, type PricingPrefsV1 } from "./pricing-prefs.js";

/** 設定→料金の深夜・早朝加算を TariffPlanVersion（料金プラン）へ同期 */
export async function syncTariffPlanFromPricingPrefs(
  prisma: PrismaClient,
  tenantId: string,
  prefs: PricingPrefsV1,
): Promise<{ planId: string; versionId: string }> {
  let plan = await prisma.tariffPlan.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
  if (!plan) {
    plan = await prisma.tariffPlan.create({
      data: { tenantId, name: "標準" },
    });
  }

  let version = await prisma.tariffPlanVersion.findFirst({
    where: { planId: plan.id, validTo: null },
    orderBy: { version: "desc" },
  });
  if (!version) {
    version = await prisma.tariffPlanVersion.findFirst({
      where: { planId: plan.id },
      orderBy: { version: "desc" },
    });
  }

  const md = prefs.mainDistance ?? emptyDistanceBand();
  const surcharge = {
    nightSurchargeBps: prefs.features.includes("nightSurcharge") ? (prefs.nightSurchargeBps ?? 0) : 0,
    nightSurchargeFlatYen: prefs.features.includes("nightSurcharge") ? (prefs.nightSurchargeFlatYen ?? 0) : 0,
    lateNightFlatYen: prefs.features.includes("nightSurcharge") ? (prefs.lateNightFlatYen ?? 0) : 0,
    earlyMorningFlatYen: prefs.features.includes("nightSurcharge") ? (prefs.earlyMorningFlatYen ?? 0) : 0,
    earlyRushFlatYen: prefs.features.includes("nightSurcharge") ? (prefs.earlyRushFlatYen ?? 0) : 0,
    leftHandSurchargeBps: prefs.features.includes("nightSurcharge") ? (prefs.leftHandSurchargeBps ?? 0) : 0,
  };

  if (!version) {
    const created = await prisma.tariffPlanVersion.create({
      data: {
        planId: plan.id,
        version: 1,
        initialDistanceM: md.includedDistanceM,
        initialFareYen: md.baseFareYen,
        addUnitDistanceM: md.addEveryM,
        addFareYen: md.addFareYen,
        ...surcharge,
      },
    });
    return { planId: plan.id, versionId: created.id };
  }

  const updated = await prisma.tariffPlanVersion.update({
    where: { id: version.id },
    data: {
      initialDistanceM: md.includedDistanceM > 0 ? md.includedDistanceM : version.initialDistanceM,
      initialFareYen: md.baseFareYen > 0 ? md.baseFareYen : version.initialFareYen,
      addUnitDistanceM: md.addEveryM > 0 ? md.addEveryM : version.addUnitDistanceM,
      addFareYen: md.addFareYen > 0 ? md.addFareYen : version.addFareYen,
      ...surcharge,
    },
  });
  return { planId: plan.id, versionId: updated.id };
}
