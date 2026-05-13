-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN "escortVehicleId" TEXT,
ADD COLUMN "escortOdometerStartM" INTEGER,
ADD COLUMN "escortOdometerEndM" INTEGER;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_escortVehicleId_fkey" FOREIGN KEY ("escortVehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
