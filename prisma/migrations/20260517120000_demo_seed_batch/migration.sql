-- CreateTable
CREATE TABLE "DemoSeedBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoSeedBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemoSeedBatch_tenantId_createdAt_idx" ON "DemoSeedBatch"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "DemoSeedBatch" ADD CONSTRAINT "DemoSeedBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
