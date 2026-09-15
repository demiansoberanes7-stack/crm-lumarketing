CREATE TABLE IF NOT EXISTS "project_stage" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_stage_id_pipeline_stage_id_fk";
--> statement-breakpoint
ALTER TABLE "project_stage_event" DROP CONSTRAINT IF EXISTS "project_stage_event_from_stage_id_pipeline_stage_id_fk";
--> statement-breakpoint
ALTER TABLE "project_stage_event" DROP CONSTRAINT IF EXISTS "project_stage_event_to_stage_id_pipeline_stage_id_fk";
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_stage" ADD CONSTRAINT "project_stage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_stage_org_position_uq" ON "project_stage" USING btree ("organization_id","position");--> statement-breakpoint
-- Conserva la posición mostrada antes de separar el pipeline comercial.
INSERT INTO project_stage (id, organization_id, name, position)
SELECT 'pst_' || o.id || '_' || s.position, o.id, s.name, s.position
FROM organization o CROSS JOIN (VALUES
  (0, 'Activación'), (1, 'Diagnóstico'), (2, 'Calendario de Entregable'),
  (3, 'Creación de Entregable'), (4, 'Terminación de Entregable'), (5, 'Reporte de Resultados'), (6, 'Renovación')
) AS s(position, name)
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
UPDATE project SET stage_id = 'pst_' || organization_id || '_' || LEAST(6, GREATEST(0, round(avance * 6.0 / 100)::integer));--> statement-breakpoint
UPDATE project SET avance = CASE WHEN estado = 'cerrado' AND avance = 100 THEN 100
  ELSE round(LEAST(6, GREATEST(0, round(avance * 6.0 / 100)::integer)) * 100.0 / 7)::integer END;--> statement-breakpoint
-- Las referencias históricas comerciales se conservan como nombres de auditoría.
UPDATE project_stage_event e SET from_stage_name = COALESCE(e.from_stage_name, s.name)
FROM pipeline_stage s WHERE s.id = e.from_stage_id;--> statement-breakpoint
UPDATE project_stage_event SET from_stage_id = NULL, to_stage_id = NULL;--> statement-breakpoint
UPDATE project_task SET estado = CASE WHEN estado IN ('completada', 'completado') THEN 'terminado' ELSE 'pendiente' END
WHERE estado NOT IN ('no_empezado', 'pendiente', 'terminado');--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project" ADD CONSTRAINT "project_stage_id_project_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."project_stage"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_stage_event" ADD CONSTRAINT "project_stage_event_from_stage_id_project_stage_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."project_stage"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_stage_event" ADD CONSTRAINT "project_stage_event_to_stage_id_project_stage_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."project_stage"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
