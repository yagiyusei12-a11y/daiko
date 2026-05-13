-- CreateTable
CREATE TABLE "InstructionRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "instructionItems" TEXT NOT NULL,
    "specialNotes" TEXT NOT NULL,
    "remarks" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstructionRecord_tenantId_date_idx" ON "InstructionRecord"("tenantId", "date");

-- CreateIndex
CREATE INDEX "InstructionRecord_tenantId_employeeId_idx" ON "InstructionRecord"("tenantId", "employeeId");

-- AddForeignKey
ALTER TABLE "InstructionRecord" ADD CONSTRAINT "InstructionRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructionRecord" ADD CONSTRAINT "InstructionRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
