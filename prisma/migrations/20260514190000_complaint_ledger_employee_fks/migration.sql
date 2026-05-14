-- AlterTable
ALTER TABLE "ComplaintLedger" ADD COLUMN "receivedByEmployeeId" TEXT,
ADD COLUMN "handlerEmployeeId" TEXT;

-- CreateIndex
CREATE INDEX "ComplaintLedger_receivedByEmployeeId_idx" ON "ComplaintLedger"("receivedByEmployeeId");

CREATE INDEX "ComplaintLedger_handlerEmployeeId_idx" ON "ComplaintLedger"("handlerEmployeeId");

-- AddForeignKey
ALTER TABLE "ComplaintLedger" ADD CONSTRAINT "ComplaintLedger_receivedByEmployeeId_fkey" FOREIGN KEY ("receivedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ComplaintLedger" ADD CONSTRAINT "ComplaintLedger_handlerEmployeeId_fkey" FOREIGN KEY ("handlerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
