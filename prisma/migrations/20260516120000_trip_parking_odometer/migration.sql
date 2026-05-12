-- TripLeg: 駐車場立替・運行メーター記録（任意）
ALTER TABLE "TripLeg" ADD COLUMN "parkingAdvanceYen" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TripLeg" ADD COLUMN "tripMeterStartM" INTEGER;
ALTER TABLE "TripLeg" ADD COLUMN "tripMeterEndM" INTEGER;
