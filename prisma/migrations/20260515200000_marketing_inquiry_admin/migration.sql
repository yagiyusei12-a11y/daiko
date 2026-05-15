-- AlterTable
ALTER TABLE "MarketingInquiry" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "MarketingInquiry" ADD COLUMN "adminNotes" TEXT;
ALTER TABLE "MarketingInquiry" ADD COLUMN "emailNotifiedAt" TIMESTAMP(3);
ALTER TABLE "MarketingInquiry" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "MarketingInquiry_status_createdAt_idx" ON "MarketingInquiry"("status", "createdAt");
