-- AlterTable
ALTER TABLE "TariffPlanVersion" ADD COLUMN "leftHandSurchargeFlatYen" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TripLeg" ADD COLUMN "applyLeftHandSurchargeFlat" BOOLEAN NOT NULL DEFAULT false;
