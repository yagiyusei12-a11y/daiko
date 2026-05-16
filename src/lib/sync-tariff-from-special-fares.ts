import type { PrismaClient } from "@prisma/client";
import {
  emptyDistanceBand,
  emptyTimeBand,
  type PricingPrefsV1,
  type SpecialFareEntry,
} from "./pricing-prefs.js";

export type SpecialFareTariffLink = { specialFareId: string; tariffVersionId: string };

export function specialFareIdFromTariffNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  try {
    const o = JSON.parse(notes) as { specialFareId?: unknown };
    return typeof o.specialFareId === "string" && o.specialFareId.trim() ? o.specialFareId.trim() : null;
  } catch {
    return null;
  }
}

function planNameForSpecialFare(sf: SpecialFareEntry): string {
  return `特別:${sf.name}`.slice(0, 120);
}

function tariffNotesForSpecialFare(sf: SpecialFareEntry): string {
  return JSON.stringify({
    specialFareId: sf.id,
    regime: sf.regime,
    extraFlatYen: sf.extraFlatYen ?? 0,
  });
}

/** 設定の特別料金一覧 → 料金プラン（TariffPlanVersion）へ同期し、日報の選択肢用 id を返す */
export async function syncTariffPlansFromSpecialFares(
  prisma: PrismaClient,
  tenantId: string,
  prefs: PricingPrefsV1,
): Promise<SpecialFareTariffLink[]> {
  if (!prefs.features.includes("specialFare") || prefs.specialFares.length === 0) {
    return [];
  }

  const links: SpecialFareTariffLink[] = [];

  for (const sf of prefs.specialFares) {
    const name = planNameForSpecialFare(sf);
    let plan = await prisma.tariffPlan.findFirst({ where: { tenantId, name } });
    if (!plan) {
      plan = await prisma.tariffPlan.create({ data: { tenantId, name } });
    }

    const allVersions = await prisma.tariffPlanVersion.findMany({
      where: { planId: plan.id },
      orderBy: { version: "desc" },
    });
    let version = allVersions.find((v) => specialFareIdFromTariffNotes(v.notes) === sf.id);

    const md = sf.distance ?? emptyDistanceBand();
    const notes = tariffNotesForSpecialFare(sf);
    const versionData = {
      initialDistanceM: md.includedDistanceM,
      initialFareYen: md.baseFareYen,
      addUnitDistanceM: md.addEveryM,
      addFareYen: md.addFareYen,
      cancellationFeeYen: Math.max(0, sf.extraFlatYen ?? 0),
      notes,
      nightSurchargeBps: 0,
      nightSurchargeFlatYen: 0,
      lateNightFlatYen: 0,
      earlyMorningFlatYen: 0,
      earlyRushFlatYen: 0,
      leftHandSurchargeBps: 0,
    };

    if (!version) {
      const nextVer = (allVersions[0]?.version ?? 0) + 1;
      version = await prisma.tariffPlanVersion.create({
        data: { planId: plan.id, version: nextVer, ...versionData },
      });
    } else {
      version = await prisma.tariffPlanVersion.update({
        where: { id: version.id },
        data: versionData,
      });
    }

    links.push({ specialFareId: sf.id, tariffVersionId: version.id });
  }

  return links;
}

export async function listSpecialFareTariffVersions(
  prisma: PrismaClient,
  tenantId: string,
  prefs: PricingPrefsV1,
): Promise<
  Array<{
    id: string;
    label: string;
    specialFareId: string;
    regime: SpecialFareEntry["regime"];
    distance: NonNullable<SpecialFareEntry["distance"]>;
    time: NonNullable<SpecialFareEntry["time"]>;
    extraFlatYen: number;
  }>
> {
  if (!prefs.features.includes("specialFare") || prefs.specialFares.length === 0) {
    return [];
  }

  await syncTariffPlansFromSpecialFares(prisma, tenantId, prefs);

  const versions = await prisma.tariffPlanVersion.findMany({
    where: { plan: { tenantId } },
    select: { id: true, notes: true, plan: { select: { name: true } } },
    orderBy: [{ plan: { name: "asc" } }, { version: "desc" }],
  });

  const bySfId = new Map<string, (typeof versions)[0]>();
  for (const v of versions) {
    const sfId = specialFareIdFromTariffNotes(v.notes);
    if (sfId && !bySfId.has(sfId)) bySfId.set(sfId, v);
  }

  const out: Array<{
    id: string;
    label: string;
    specialFareId: string;
    regime: SpecialFareEntry["regime"];
    distance: NonNullable<SpecialFareEntry["distance"]>;
    time: NonNullable<SpecialFareEntry["time"]>;
    extraFlatYen: number;
  }> = [];

  for (const sf of prefs.specialFares) {
    const tv = bySfId.get(sf.id);
    if (!tv) continue;
    out.push({
      id: tv.id,
      label: sf.name,
      specialFareId: sf.id,
      regime: sf.regime,
      distance: sf.distance ?? emptyDistanceBand(),
      time: sf.time ?? emptyTimeBand(),
      extraFlatYen: sf.extraFlatYen ?? 0,
    });
  }

  return out;
}
