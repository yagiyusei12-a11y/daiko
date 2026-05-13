-- 受講者を JSON 配列で1行にまとめる（従業員 FK は廃止）
ALTER TABLE "InstructionRecord" ADD COLUMN "recipientEmployeeIds" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "InstructionRecord" SET "recipientEmployeeIds" = jsonb_build_array("employeeId");

WITH grp AS (
  SELECT "sessionGroupId",
    jsonb_agg("employeeId" ORDER BY "employeeId") AS rids,
    (array_agg("id" ORDER BY "id"))[1] AS keep_id
  FROM "InstructionRecord"
  GROUP BY "sessionGroupId"
)
UPDATE "InstructionRecord" t
SET "recipientEmployeeIds" = grp.rids
FROM grp
WHERE t.id = grp.keep_id;

DELETE FROM "InstructionRecord"
WHERE id NOT IN (
  SELECT (array_agg(id ORDER BY id))[1]
  FROM "InstructionRecord"
  GROUP BY "sessionGroupId"
);

ALTER TABLE "InstructionRecord" DROP CONSTRAINT IF EXISTS "InstructionRecord_employeeId_fkey";

DROP INDEX IF EXISTS "InstructionRecord_tenantId_employeeId_idx";
DROP INDEX IF EXISTS "InstructionRecord_tenantId_sessionGroupId_idx";

ALTER TABLE "InstructionRecord" DROP COLUMN IF EXISTS "employeeId";
ALTER TABLE "InstructionRecord" DROP COLUMN IF EXISTS "sessionGroupId";
