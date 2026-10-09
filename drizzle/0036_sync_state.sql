-- Estado de sincronización por proveedor de integración (meta_ads,
-- google_ads, ga4, mercado_libre). Rastrea último sync, periodo, registros
-- importados, duplicados y errores para trazabilidad e idempotencia.
CREATE TABLE IF NOT EXISTS "sync_state" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "provider" varchar(50) NOT NULL,
  "last_sync_at" timestamp,
  "last_status" varchar(20),
  "last_error" text,
  "period_start" timestamp,
  "period_end" timestamp,
  "records_imported" integer NOT NULL DEFAULT 0,
  "duplicates_detected" integer NOT NULL DEFAULT 0,
  "currency" varchar(10),
  "detail" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_state_org_provider_uq" ON "sync_state" ("organization_id", "provider");
