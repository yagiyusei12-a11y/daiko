-- AlterTable
ALTER TABLE "Employee" ADD COLUMN "adminMaster" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "safetyDrivingManager" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConfirmedShiftDay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "dutiesJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfirmedShiftDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConfirmedShiftDay_tenantId_employeeId_businessDate_key" ON "ConfirmedShiftDay"("tenantId", "employeeId", "businessDate");

CREATE INDEX "ConfirmedShiftDay_tenantId_businessDate_idx" ON "ConfirmedShiftDay"("tenantId", "businessDate");

ALTER TABLE "ConfirmedShiftDay" ADD CONSTRAINT "ConfirmedShiftDay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConfirmedShiftDay" ADD CONSTRAINT "ConfirmedShiftDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
