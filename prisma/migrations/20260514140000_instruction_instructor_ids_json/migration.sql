-- AlterTable: 指導担当者を従業員 id 配列で保持（テキスト列は廃止）
ALTER TABLE "InstructionRecord" ADD COLUMN "instructorEmployeeIds" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "InstructionRecord" DROP COLUMN IF EXISTS "instructorNames";
