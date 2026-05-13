-- AlterTable: 日報作成時に客車を未入力にできるようにする
ALTER TABLE "DailyReport" ALTER COLUMN "vehicleId" DROP NOT NULL;
