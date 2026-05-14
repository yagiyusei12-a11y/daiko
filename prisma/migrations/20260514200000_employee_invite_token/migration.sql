-- CreateTable
CREATE TABLE "EmployeeInviteToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "hiredOn" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "EmployeeInviteToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeInviteToken_tenantId_idx" ON "EmployeeInviteToken"("tenantId");

-- AddForeignKey
ALTER TABLE "EmployeeInviteToken" ADD CONSTRAINT "EmployeeInviteToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
