-- Módulo de Proyectos: tipo de proyecto, workflow y pasos del expediente.
-- Idempotente: seguro de re-ejecutar (convención del repo).

ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "project_type" varchar(50) NOT NULL DEFAULT 'marketing';
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'borrador';
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "start_date" timestamp;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "end_date" timestamp;
--> statement-breakpoint
-- Backfill de proyectos existentes: cerrados → completado, con avance → en proceso.
UPDATE "project"
   SET "status" = CASE
         WHEN "estado" = 'cerrado' THEN 'completado'
         WHEN "avance" > 0 THEN 'en_proceso'
         ELSE 'borrador'
       END
 WHERE "status" = 'borrador'
   AND ("estado" = 'cerrado' OR "avance" > 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_org_type_idx" ON "project" ("organization_id","project_type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_step" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"project_id" varchar(255) NOT NULL,
	"step_key" varchar(100) NOT NULL,
	"position" integer NOT NULL,
	"status" varchar(20) NOT NULL DEFAULT 'pendiente',
	"data" jsonb NOT NULL DEFAULT '{}',
	"completed_at" timestamp,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "project_step_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "project_step_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_step_project_key_uq" ON "project_step" ("project_id","step_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_step_org_idx" ON "project_step" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_step_project_idx" ON "project_step" ("project_id");
