ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
--> statement-breakpoint
-- Renombrar etapas: Campaña → Terminación de Entregable, Contenido → Entregable
UPDATE project_stage SET name = 'Calendario de Entregable' WHERE name = 'Calendario de Contenido';
--> statement-breakpoint
UPDATE project_stage SET name = 'Creación de Entregable' WHERE name = 'Creación de Contenido';
--> statement-breakpoint
UPDATE project_stage SET name = 'Terminación de Entregable' WHERE name = 'Campaña';
