-- Ciclo comercial (P1): cotización aceptada → proyecto → orden de servicio.
-- Aditiva: no modifica ni borra datos existentes.

CREATE TABLE IF NOT EXISTS "project_quote" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "project_id" varchar(255) NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "quote_id" varchar(255) NOT NULL REFERENCES "quote"("id") ON DELETE CASCADE,
  "linked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_quote_org_quote_uq" ON "project_quote" ("organization_id","quote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_quote_project_idx" ON "project_quote" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_quote_org_idx" ON "project_quote" ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_order" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "code" varchar(50) NOT NULL,
  "project_id" varchar(255) NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "quote_id" varchar(255) REFERENCES "quote"("id") ON DELETE SET NULL,
  "contact_id" varchar(255) REFERENCES "contact"("id") ON DELETE SET NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "status" varchar(20) DEFAULT 'pendiente' NOT NULL,
  "priority" varchar(20),
  "assigned_user_id" varchar(255) REFERENCES "user"("id") ON DELETE SET NULL,
  "start_date" timestamp,
  "due_date" timestamp,
  "delivered_at" timestamp,
  "notes" text,
  "created_by" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_org_code_uq" ON "service_order" ("organization_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_org_quote_uq" ON "service_order" ("organization_id","quote_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_order_org_idx" ON "service_order" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_order_project_idx" ON "service_order" ("project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_order_event" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "service_order_id" varchar(255) NOT NULL REFERENCES "service_order"("id") ON DELETE CASCADE,
  "from_status" varchar(20),
  "to_status" varchar(20) NOT NULL,
  "actor_id" varchar(255),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_order_event_org_idx" ON "service_order_event" ("organization_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_order_event_order_idx" ON "service_order_event" ("service_order_id","created_at");
