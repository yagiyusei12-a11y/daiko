-- TariffPlanVersion: pickup, distance discount, flat surcharges, notes
ALTER TABLE "TariffPlanVersion" ADD COLUMN "nightSurchargeFlatYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "lateNightFlatYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "earlyMorningFlatYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "earlyRushFlatYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "pickupRuleJson" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "distanceDiscountFromM" INTEGER;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "distanceDiscountBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "notes" TEXT;

-- TripLeg: pickup distance + flat surcharge flags
ALTER TABLE "TripLeg" ADD COLUMN "pickupFromBaseM" INTEGER;
ALTER TABLE "TripLeg" ADD COLUMN "applyNightSurchargeFlat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TripLeg" ADD COLUMN "applyLateNightFlatYen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TripLeg" ADD COLUMN "applyEarlyMorningFlatYen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TripLeg" ADD COLUMN "applyEarlyRushFlatYen" BOOLEAN NOT NULL DEFAULT false;
