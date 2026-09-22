ALTER TABLE "caltodo_settings" DROP CONSTRAINT IF EXISTS "caltodo_settings_organization_id_key";
ALTER TABLE "caltodo_settings" DROP CONSTRAINT IF EXISTS "caltodo_settings_user_id_key";
ALTER TABLE "caltodo_settings" DROP CONSTRAINT IF EXISTS "caltodo_settings_organization_id_unique";
ALTER TABLE "caltodo_settings" DROP CONSTRAINT IF EXISTS "caltodo_settings_user_id_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "caltodo_settings_org_user_unique" ON "caltodo_settings" ("organization_id", "user_id");
DROP INDEX IF EXISTS "caltodo_settings_org_user_idx";
