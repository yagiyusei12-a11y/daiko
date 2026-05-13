-- CreateTable
CREATE TABLE "TenantLineChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "lineChannelId" TEXT NOT NULL,
    "lineChannelSecret" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantLineChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantLineChannel_lineChannelId_idx" ON "TenantLineChannel"("lineChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantLineChannel_tenantId_lineChannelId_key" ON "TenantLineChannel"("tenantId", "lineChannelId");

-- AddForeignKey
ALTER TABLE "TenantLineChannel" ADD CONSTRAINT "TenantLineChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
