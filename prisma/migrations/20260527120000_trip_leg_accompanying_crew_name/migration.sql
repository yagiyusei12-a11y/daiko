-- 運行追加時点の同伴乗務員名（日報ペアのスナップショット）
ALTER TABLE "TripLeg" ADD COLUMN "accompanyingCrewName" TEXT NOT NULL DEFAULT '';

UPDATE "TripLeg" AS t
SET "accompanyingCrewName" = TRIM(CONCAT(e."familyName", ' ', e."givenName"))
FROM "DailyReport" AS dr
INNER JOIN "Employee" AS e ON e."id" = dr."partnerEmployeeId"
WHERE t."dailyReportId" = dr."id"
  AND dr."partnerEmployeeId" IS NOT NULL;
