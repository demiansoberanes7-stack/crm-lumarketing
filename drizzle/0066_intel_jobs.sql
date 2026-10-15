CREATE TABLE IF NOT EXISTS "intel_job" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "kind" varchar(20) NOT NULL,
  "term_id" varchar(255),
  "geo" varchar(10),
  "status" varchar(20) DEFAULT 'running' NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "completed" integer DEFAULT 0 NOT NULL,
  "result" jsonb,
  "error" text,
  "created_at" timestamp DEFAULT NOW() NOT NULL,
  "finished_at" timestamp
);

CREATE INDEX IF NOT EXISTS "intel_job_org_created_idx"
  ON "intel_job" ("organization_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "intel_job_active_uq"
  ON "intel_job" ("organization_id", "kind", COALESCE("term_id", ''))
  WHERE "status" = 'running';

--> statement-breakpoint
UPDATE "intel_job"
SET "status" = 'error', "error" = 'Job interrumpido por migración', "finished_at" = NOW()
WHERE "status" = 'running';
