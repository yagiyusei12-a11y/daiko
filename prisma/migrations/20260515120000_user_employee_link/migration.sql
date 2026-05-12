-- AlterTable
ALTER TABLE "User" ADD COLUMN "employeeId" TEXT;

-- CreateIndex
CREATE INDEX "User_tenantId_employeeId_idx" ON "User"("tenantId", "employeeId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
