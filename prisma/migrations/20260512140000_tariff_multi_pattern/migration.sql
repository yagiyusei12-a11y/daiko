-- CreateEnum
CREATE TYPE "TariffDistanceMode" AS ENUM ('INITIAL_ADD', 'SEGMENTS_ONLY', 'TIERED_ADD');

CREATE TYPE "TripPassengerKind" AS ENUM ('GENERAL', 'MEMBER');

-- AlterTable TariffPlanVersion
ALTER TABLE "TariffPlanVersion" ADD COLUMN "distanceMode" "TariffDistanceMode" NOT NULL DEFAULT 'INITIAL_ADD';
ALTER TABLE "TariffPlanVersion" ADD COLUMN "waitingRuleJson" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "TariffPlanVersion" ADD COLUMN "perViaStopYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "cancellationFeeYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "nightSurchargeBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TariffPlanVersion" ADD COLUMN "leftHandSurchargeBps" INTEGER NOT NULL DEFAULT 0;

UPDATE "TariffPlanVersion"
SET "waitingRuleJson" = jsonb_build_object(
  'type', 'linear',
  'graceMin', 0,
  'perMinYen', "waitingFareYenPerMin"
);

-- AlterTable TariffSegment
ALTER TABLE "TariffSegment" ADD COLUMN "fareMemberYen" INTEGER;

-- CreateTable TariffDistanceTier
CREATE TABLE "TariffDistanceTier" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fromM" INTEGER NOT NULL,
    "untilM" INTEGER,
    "stepM" INTEGER NOT NULL,
    "addYenPerStep" INTEGER NOT NULL,

    CONSTRAINT "TariffDistanceTier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TariffDistanceTier_versionId_sortOrder_idx" ON "TariffDistanceTier"("versionId", "sortOrder");

ALTER TABLE "TariffDistanceTier" ADD CONSTRAINT "TariffDistanceTier_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TariffPlanVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable TripLeg
ALTER TABLE "TripLeg" ADD COLUMN "passengerKind" "TripPassengerKind" NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "TripLeg" ADD COLUMN "viaStopCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TripLeg" ADD COLUMN "applyNightSurcharge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TripLeg" ADD COLUMN "applyLeftHandSurcharge" BOOLEAN NOT NULL DEFAULT false;
