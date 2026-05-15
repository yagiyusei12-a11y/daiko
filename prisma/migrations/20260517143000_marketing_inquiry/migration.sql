-- CreateTable
CREATE TABLE "MarketingInquiry" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "clientIp" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingInquiry_createdAt_idx" ON "MarketingInquiry"("createdAt");
