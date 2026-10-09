-- Actividades comerciales de prospección: llamadas, correos, visitas,
-- reuniones, seguimientos, respuestas, propuestas. Base de tiempos de
-- respuesta y productividad por responsable.
CREATE TABLE IF NOT EXISTS "activity_event" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "contact_id" varchar(255) REFERENCES "contact"("id") ON DELETE SET NULL,
  "lead_id" varchar(255) REFERENCES "lead"("id") ON DELETE SET NULL,
  "conversation_id" varchar(255) REFERENCES "conversation"("id") ON DELETE SET NULL,
  "type" varchar(30) NOT NULL,
  "direction" varchar(10) NOT NULL DEFAULT 'outbound',
  "outcome" varchar(50),
  "duration_minutes" integer,
  "actor_user_id" varchar(255) REFERENCES "user"("id") ON DELETE SET NULL,
  "notes" text,
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_event_org_contact_idx" ON "activity_event" ("organization_id", "contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_event_org_occurred_idx" ON "activity_event" ("organization_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_event_org_type_idx" ON "activity_event" ("organization_id", "type", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_event_org_actor_idx" ON "activity_event" ("organization_id", "actor_user_id");
