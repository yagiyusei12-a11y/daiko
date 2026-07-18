-- フェーズ11: 配車リクエストのドライバー位置トラッキング
-- 実行例: mysql -u root -p portal_member < database/migrations/008_ride_driver_location.sql

USE portal_member;

ALTER TABLE ride_requests
  ADD COLUMN driver_lat DECIMAL(10, 8) NULL DEFAULT NULL COMMENT 'ドライバー現在地（緯度）' AFTER accepted_at,
  ADD COLUMN driver_lng DECIMAL(11, 8) NULL DEFAULT NULL COMMENT 'ドライバー現在地（経度）' AFTER driver_lat,
  ADD COLUMN last_location_updated_at DATETIME NULL DEFAULT NULL COMMENT '位置情報最終更新' AFTER driver_lng,
  ADD COLUMN driver_tracking_token VARCHAR(64) NULL DEFAULT NULL COMMENT 'ドライバーGPS送信認証トークン' AFTER last_location_updated_at,
  ADD COLUMN pickup_lat DECIMAL(10, 8) NULL DEFAULT NULL COMMENT 'お迎え先（緯度・任意）' AFTER driver_tracking_token,
  ADD COLUMN pickup_lng DECIMAL(11, 8) NULL DEFAULT NULL COMMENT 'お迎え先（経度・任意）' AFTER pickup_lat;

CREATE INDEX idx_ride_requests_tracking_token ON ride_requests (driver_tracking_token);
