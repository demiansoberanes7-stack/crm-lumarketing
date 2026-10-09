-- Ventas de marketplace (Mercado Libre) registradas manualmente. `external_id`
-- idempotente para que, cuando exista integración API, el sync no duplique.
CREATE TABLE IF NOT EXISTS "marketplace_order" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "platform" varchar(30) NOT NULL DEFAULT 'mercado_libre',
  "external_id" varchar(255),
  "order_number" varchar(100) NOT NULL,
  "contact_id" varchar(255) REFERENCES "contact"("id") ON DELETE SET NULL,
  "item_name" varchar(255) NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "amount_cents" integer NOT NULL DEFAULT 0,
  "commission_cents" integer NOT NULL DEFAULT 0,
  "currency" varchar(10) NOT NULL DEFAULT 'MXN',
  "status" varchar(30) NOT NULL DEFAULT 'completed',
  "ordered_at" timestamp NOT NULL DEFAULT now(),
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketplace_order_org_external_uq" ON "marketplace_order" ("organization_id", "platform", "external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketplace_order_org_idx" ON "marketplace_order" ("organization_id", "ordered_at");
