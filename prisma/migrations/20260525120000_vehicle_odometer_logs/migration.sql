-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN "currentOdometer" INTEGER;

-- CreateTable
CREATE TABLE "VehicleOdometerLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "dailyReportId" TEXT,
    "businessDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleOdometerLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VehicleOdometerLog_tenantId_vehicleId_createdAt_idx" ON "VehicleOdometerLog"("tenantId", "vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "VehicleOdometerLog_tenantId_idx" ON "VehicleOdometerLog"("tenantId");

-- AddForeignKey
ALTER TABLE "VehicleOdometerLog" ADD CONSTRAINT "VehicleOdometerLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOdometerLog" ADD CONSTRAINT "VehicleOdometerLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleOdometerLog" ADD CONSTRAINT "VehicleOdometerLog_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
