-- AlterTable
ALTER TABLE "DispatchReservation" ADD COLUMN     "driverEmployeeId" TEXT,
ADD COLUMN     "detailJson" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "DispatchReservation_tenantId_driverEmployeeId_idx" ON "DispatchReservation"("tenantId", "driverEmployeeId");

-- AddForeignKey
ALTER TABLE "DispatchReservation" ADD CONSTRAINT "DispatchReservation_driverEmployeeId_fkey" FOREIGN KEY ("driverEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
