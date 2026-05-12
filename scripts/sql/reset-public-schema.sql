-- 本番 DB を「テナント含む業務データなし」に戻す（public 内を全削除）
-- 実行後は prisma migrate deploy でマイグレーションを再適用する想定。
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
