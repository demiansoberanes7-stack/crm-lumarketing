-- 0090 — Costos de producción: la receta de cada producto
--
-- product_cost_line guarda QUÉ lleva un producto y CUÁNTO vale eso: cantidad en
-- una medida, valor por unidad en centavos. No guarda el costo total ni el
-- porcentaje, y eso es deliberado —ninguna de las dos cosas es un dato, son
-- consecuencias de estos dos columnas. Si se guardaran, cambiar el precio de la
-- cera dejaría mientiendo cada receta del catálogo, sin aviso.
--
-- Aditiva y re-ejecutable. No toca ninguna fila existente y no le añade ninguna
-- columna a catalog_product: la receta entera vive en su tabla.
--
-- Los teches de las CHECK no son política de negocio, son aritmética de `double`
-- en JavaScript: 1 000 000 de medida × 100 000 000 de centavos = 1e14 por línea,
-- y con el tope de 60 líneas del servicio el máximo teórico es 6e15, todavía
-- por debajo de Number.MAX_SAFE_INTEGER (9.007e15). Sin estos teches una línea
-- mal escrita podría producir un costo total que deja de ser un número exacto.

CREATE TABLE IF NOT EXISTS "product_cost_line" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "product_id" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "quantity" numeric(14,4) NOT NULL,
  "unit" varchar(16) NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_cost_line" ADD CONSTRAINT "product_cost_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_cost_line" ADD CONSTRAINT "product_cost_line_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_cost_line" ADD CONSTRAINT "product_cost_line_quantity_check" CHECK ("quantity" > 0 AND "quantity" <= 1000000);
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_cost_line" ADD CONSTRAINT "product_cost_line_unit_price_cents_check" CHECK ("unit_price_cents" >= 0 AND "unit_price_cents" <= 100000000);
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_cost_line" ADD CONSTRAINT "product_cost_line_position_check" CHECK ("position" >= 0 AND "position" <= 1000);
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cost_line_product_idx" ON "product_cost_line" ("product_id","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cost_line_org_idx" ON "product_cost_line" ("organization_id");
