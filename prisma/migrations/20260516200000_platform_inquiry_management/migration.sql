-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MarketingInquiryReply" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByEmail" TEXT NOT NULL,

    CONSTRAINT "MarketingInquiryReply_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "MarketingInquiry" ADD COLUMN "lastRepliedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MarketingInquiryReply_inquiryId_sentAt_idx" ON "MarketingInquiryReply"("inquiryId", "sentAt");

-- AddForeignKey
ALTER TABLE "MarketingInquiryReply" ADD CONSTRAINT "MarketingInquiryReply_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "MarketingInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
