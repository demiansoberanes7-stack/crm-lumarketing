-- 0088 — Imágenes de los productos del catálogo
--
-- product_image: metadatos de cada foto (ruta relativa dentro de MEDIA_DIR,
-- MIME verificado por firma de bytes, dimensiones, orden y cuál es la
-- principal). Los bytes NO van aquí: un `bytea` en el catálogo hincharía el
-- respaldo, y Supabase Free no hace backups automáticos.
--
-- Se añaden tres columnas a quote_item para que la foto sobreviva a que el
-- producto se borre o cambie: la cotización es un documento que se envía al
-- cliente y debe seguir viéndose igual dentro de un año. Snapshot, no FK viva.
--
-- Aditiva y re-ejecutable. No toca ninguna fila existente.

CREATE TABLE IF NOT EXISTS "product_image" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "product_id" varchar(255) NOT NULL,
  "storage_path" varchar(512) NOT NULL,
  "mime_type" varchar(32) NOT NULL,
  "bytes" integer NOT NULL,
  "width" integer,
  "height" integer,
  "alt_text" varchar(255),
  "position" integer DEFAULT 0 NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "uploaded_by" varchar(255),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_image" ADD CONSTRAINT "product_image_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Techo de integridad, no de política: 0 o negativo no puede ser un archivo y
-- 20 MB es absurdo para una foto de producto. El límite que el negocio configura
-- (`PRODUCT_IMAGE_MAX_BYTES_MB`) se aplica en el servicio, más abajo que esto.
DO $$ BEGIN
 ALTER TABLE "product_image" ADD CONSTRAINT "product_image_bytes_check" CHECK ("bytes" > 0 AND "bytes" <= 20971520);
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_image" ADD CONSTRAINT "product_image_position_check" CHECK ("position" >= 0 AND "position" <= 1000);
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_image_product_idx" ON "product_image" ("product_id","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_image_org_idx" ON "product_image" ("organization_id");
--> statement-breakpoint
-- Una sola principal por producto. Parcial: deja todas las no-principales que
-- hagan falta. Un `UPDATE ... SET is_primary = (id = …)` atómico la cambia sin
-- window en la que el producto se quede sin foto.
CREATE UNIQUE INDEX IF NOT EXISTS "product_image_primary_uq" ON "product_image" ("product_id") WHERE "is_primary";
--> statement-breakpoint
ALTER TABLE "quote_item" ADD COLUMN IF NOT EXISTS "image_storage_path" varchar(512);
--> statement-breakpoint
ALTER TABLE "quote_item" ADD COLUMN IF NOT EXISTS "image_mime_type" varchar(32);
--> statement-breakpoint
ALTER TABLE "quote_item" ADD COLUMN IF NOT EXISTS "image_bytes" integer;
