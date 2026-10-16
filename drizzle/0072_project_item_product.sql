-- Fase F — Rentabilidad: project_item necesita product_id para cruzar
-- con service_cost y calcular margen por partida.
-- Aditiva: nullable, no rompe filas existentes.

ALTER TABLE "project_item" ADD COLUMN IF NOT EXISTS "product_id" varchar(255) REFERENCES "catalog_product"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_item_product_idx" ON "project_item" ("product_id");
