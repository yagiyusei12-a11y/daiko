-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "isEarlyTester" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "earlyTesterPriceYen" INTEGER;
ALTER TABLE "Tenant" ADD COLUMN "earlyTesterMarkedAt" TIMESTAMP(3);
