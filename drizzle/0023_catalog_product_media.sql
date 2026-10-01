-- Fase 1: Catálogo enriquecido para cotizaciones por WhatsApp
-- Agrega imagen, descripción corta y descripción larga a catalog_product
ALTER TABLE "catalog_product" ADD COLUMN IF NOT EXISTS "short_description" varchar(500);--> statement-breakpoint
ALTER TABLE "catalog_product" ADD COLUMN IF NOT EXISTS "long_description" text;--> statement-breakpoint
ALTER TABLE "catalog_product" ADD COLUMN IF NOT EXISTS "image_url" varchar(1024);
