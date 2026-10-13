CREATE TABLE IF NOT EXISTS "copilot_settings" (
  "organization_id" varchar(255) PRIMARY KEY NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "access_mode" varchar(20) NOT NULL DEFAULT 'selected',
  "data_sources" jsonb NOT NULL DEFAULT '["metrics","pipeline","contacts","agenda"]'::jsonb,
  "updated_by" varchar(255) REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
