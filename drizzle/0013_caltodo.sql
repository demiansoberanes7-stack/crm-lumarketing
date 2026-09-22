CREATE TABLE IF NOT EXISTS "caltodo_task" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL,
  "user_id" varchar(255) NOT NULL,
  "title" varchar(200) NOT NULL,
  "details" text,
  "urgent" boolean NOT NULL DEFAULT false,
  "duration" integer,
  "scheduled_start" timestamp,
  "scheduled_end" timestamp,
  "completed" boolean NOT NULL DEFAULT false,
  "completed_at" timestamp,
  "priority" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "caltodo_task_org_idx" ON "caltodo_task" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "caltodo_task_completed_idx" ON "caltodo_task" ("completed");

CREATE TABLE IF NOT EXISTS "caltodo_settings" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL UNIQUE,
  "user_id" varchar(255) NOT NULL UNIQUE,
  "work_start_hour" integer NOT NULL DEFAULT 9,
  "work_end_hour" integer NOT NULL DEFAULT 17,
  "timezone" varchar(64) NOT NULL DEFAULT 'America/Mexico_City',
  "default_duration" integer NOT NULL DEFAULT 60
);

CREATE INDEX IF NOT EXISTS "caltodo_settings_org_user_idx" ON "caltodo_settings" ("organization_id", "user_id");
