-- Costo de prestación por servicio/producto, con vigencia. Base de la
-- contribución y el margen real; sin esto la rentabilidad es una estimación.
CREATE TABLE IF NOT EXISTS "service_cost" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "catalog_product_id" varchar(255) REFERENCES "catalog_product"("id") ON DELETE SET NULL,
  "service" varchar(100),
  "name" varchar(255) NOT NULL,
  "cost_cents" integer NOT NULL DEFAULT 0,
  "currency" varchar(10) NOT NULL DEFAULT 'MXN',
  "effective_from" timestamp,
  "effective_to" timestamp,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_cost_org_idx" ON "service_cost" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_cost_org_service_idx" ON "service_cost" ("organization_id", "service");
