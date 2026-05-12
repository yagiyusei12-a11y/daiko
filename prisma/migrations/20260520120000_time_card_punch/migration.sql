-- CreateEnum
CREATE TYPE "TimeCardPunchKind" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END');

-- CreateTable
CREATE TABLE "TimeCardPunch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "kind" "TimeCardPunchKind" NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeCardPunch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeCardPunch_tenantId_businessDate_employeeId_idx" ON "TimeCardPunch"("tenantId", "businessDate", "employeeId");

-- AddForeignKey
ALTER TABLE "TimeCardPunch" ADD CONSTRAINT "TimeCardPunch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeCardPunch" ADD CONSTRAINT "TimeCardPunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
