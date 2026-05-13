-- AlterTable
ALTER TABLE "TripLeg" ADD COLUMN "viaStopsJson" JSONB NOT NULL DEFAULT '[]';

-- 既存の複数行 viaNote を JSON 配列へ取り込む
UPDATE "TripLeg"
SET "viaStopsJson" = COALESCE(
  (
    SELECT jsonb_agg(to_jsonb(trim(both FROM seg)) ORDER BY ord)
    FROM unnest(string_to_array(replace(COALESCE("viaNote", ''), E'\r\n', E'\n'), E'\n')) WITH ORDINALITY AS u(seg, ord)
    WHERE trim(both FROM seg) <> ''
  ),
  '[]'::jsonb
)
WHERE COALESCE(trim(both FROM "viaNote"), '') <> '';
