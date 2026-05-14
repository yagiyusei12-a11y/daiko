-- AlterTable
ALTER TABLE "TripLeg" ADD COLUMN "tripPaymentMethod" TEXT,
ADD COLUMN "tripReceiptIssued" BOOLEAN NOT NULL DEFAULT false;
