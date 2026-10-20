-- 0079 — Procesos de proyecto configurables por negocio
--
-- project_template: cada proceso (pasos + tareas iniciales) vive como un
-- documento JSONB por organización. Los tres procesos base se siembran de
-- forma perezosa desde la aplicación: en el negocio principal quedan como
-- `is_system` (solo lectura) y en los demás como copias editables.
-- El borrado es lógico para no romper proyectos ya creados.
--
-- project.project_type_label congela el nombre del proceso al crear el
-- proyecto; project_step.definition congela los campos de cada paso.
-- Aditiva y re-ejecutable.

CREATE TABLE IF NOT EXISTS "project_template" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "key" varchar(50) NOT NULL,
  "label" varchar(255) NOT NULL,
  "description" text,
  "icon" varchar(50) DEFAULT 'layers' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "is_system" boolean DEFAULT false NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template" ADD CONSTRAINT "project_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template" ADD CONSTRAINT "project_template_steps_array" CHECK (jsonb_typeof("steps") = 'array');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_template" ADD CONSTRAINT "project_template_tasks_array" CHECK (jsonb_typeof("tasks") = 'array');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_template_org_key_uq" ON "project_template" USING btree ("organization_id","key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_template_org_position_idx" ON "project_template" USING btree ("organization_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_template_org_default_uq" ON "project_template" USING btree ("organization_id") WHERE "is_default" = true AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "project_type_label" varchar(255);
--> statement-breakpoint
UPDATE "project"
SET "project_type_label" = CASE "project_type"
  WHEN 'marketing' THEN 'Marketing'
  WHEN 'maintenance' THEN 'Mantenimiento'
  WHEN 'web_service' THEN 'Servicio Web'
END
WHERE "project_type_label" IS NULL
  AND "project_type" IN ('marketing','maintenance','web_service');
--> statement-breakpoint
ALTER TABLE "project_step" ADD COLUMN IF NOT EXISTS "definition" jsonb;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_step" ADD CONSTRAINT "project_step_definition_object" CHECK ("definition" IS NULL OR jsonb_typeof("definition") = 'object');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
