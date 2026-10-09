-- Catálogo normalizado de motivos de pérdida. La taxonomía corta legada
-- (`precio`, `no_es_perfil`, …) sigue funcionando en `lead_stage_event`; este
-- catálogo da un conjunto configurable y más amplio para el embudo. El mapeo
-- de valores legacy vive en src/lib/loss-reason.ts.
CREATE TABLE IF NOT EXISTS "loss_reason" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "key" varchar(50) NOT NULL,
  "label" varchar(120) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loss_reason_org_key_uq" ON "loss_reason" ("organization_id", "key");
