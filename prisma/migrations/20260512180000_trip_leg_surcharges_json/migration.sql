-- AlterTable
ALTER TABLE "TripLeg" ADD COLUMN "legSurchargesJson" JSONB NOT NULL DEFAULT '{}';
