-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "defaultOrigin" TEXT NOT NULL DEFAULT '',
    "defaultDestination" TEXT NOT NULL DEFAULT '',
    "defaultTariffVersionId" TEXT,
    "specialFareYen" INTEGER,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralSource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memo" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountsReceivableEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "amountYen" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "collectedAt" TIMESTAMP(3),
    "referenceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountsReceivableEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_tenantId_displayName_idx" ON "Customer"("tenantId", "displayName");

-- CreateIndex
CREATE INDEX "ReferralSource_tenantId_name_idx" ON "ReferralSource"("tenantId", "name");

-- CreateIndex
CREATE INDEX "DispatchReservation_tenantId_startsAt_idx" ON "DispatchReservation"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "AccountsReceivableEntry_tenantId_status_idx" ON "AccountsReceivableEntry"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_defaultTariffVersionId_fkey" FOREIGN KEY ("defaultTariffVersionId") REFERENCES "TariffPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralSource" ADD CONSTRAINT "ReferralSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchReservation" ADD CONSTRAINT "DispatchReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchReservation" ADD CONSTRAINT "DispatchReservation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountsReceivableEntry" ADD CONSTRAINT "AccountsReceivableEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN     "paymentCashYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyReport" ADD COLUMN     "paymentCashNoReceiptYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyReport" ADD COLUMN     "paymentCardYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyReport" ADD COLUMN     "paymentPayPayYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DailyReport" ADD COLUMN     "paymentReceivableYen" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TripLeg" ADD COLUMN     "customerId" TEXT;
ALTER TABLE "TripLeg" ADD COLUMN     "referralSourceId" TEXT;
ALTER TABLE "TripLeg" ADD COLUMN     "fareOverrideYen" INTEGER;
ALTER TABLE "TripLeg" ADD COLUMN     "excludeFromOfficialPrint" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_referralSourceId_fkey" FOREIGN KEY ("referralSourceId") REFERENCES "ReferralSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
