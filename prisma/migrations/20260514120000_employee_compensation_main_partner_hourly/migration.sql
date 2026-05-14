-- AlterTable
ALTER TABLE "EmployeeCompensationPeriod" ADD COLUMN "mainHourlyYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmployeeCompensationPeriod" ADD COLUMN "partnerHourlyYen" INTEGER NOT NULL DEFAULT 0;

UPDATE "EmployeeCompensationPeriod" SET "mainHourlyYen" = "baseHourlyYen";
