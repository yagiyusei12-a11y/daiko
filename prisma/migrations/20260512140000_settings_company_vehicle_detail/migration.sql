-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN "legalPostalCode" TEXT;
ALTER TABLE "TenantSettings" ADD COLUMN "legalPrefecture" TEXT;
ALTER TABLE "TenantSettings" ADD COLUMN "legalStreetAddress" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "detailJson" JSONB NOT NULL DEFAULT '{}';
