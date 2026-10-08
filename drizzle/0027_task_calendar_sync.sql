-- Google Calendar: sincronización opcional de Pendientes y tareas de proyecto
ALTER TABLE "google_credentials" ADD COLUMN IF NOT EXISTS "sync_tasks" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "caltodo_task" ADD COLUMN IF NOT EXISTS "google_event_id" varchar(255);
--> statement-breakpoint
ALTER TABLE "project_task" ADD COLUMN IF NOT EXISTS "google_event_id" varchar(255);
