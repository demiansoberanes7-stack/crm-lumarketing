-- Catálogo de canales de adquisición + referencia desde el contacto.
-- El `source`/`medium` legado se conserva intacto; el catálogo da un modelo
-- normalizado para atribución y segmentación por canal.
CREATE TABLE IF NOT EXISTS "acquisition_channel" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "kind" varchar(30) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acquisition_channel_org_name_uq" ON "acquisition_channel" ("organization_id", "name");
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "acquisition_channel_id" varchar(255) REFERENCES "acquisition_channel"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_org_acquisition_channel_idx" ON "contact" ("organization_id", "acquisition_channel_id");
