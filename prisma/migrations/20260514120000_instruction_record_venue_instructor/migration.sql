-- AlterTable
ALTER TABLE "InstructionRecord" ADD COLUMN     "sessionGroupId" TEXT,
ADD COLUMN     "instructionVenue" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "instructorNames" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "InstructionRecord_tenantId_sessionGroupId_idx" ON "InstructionRecord"("tenantId", "sessionGroupId");

-- 既存行は行ごとに独立したグループとして扱う
UPDATE "InstructionRecord" SET "sessionGroupId" = "id" WHERE "sessionGroupId" IS NULL;
