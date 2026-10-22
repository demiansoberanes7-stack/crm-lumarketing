-- 0084 — Sucursales e inventario por sucursal
--
-- branch: catálogo de sucursales del negocio.
-- branch_inventory: cantidad de un producto del catálogo en una sucursal.
--
-- No toca catalog_product.stock a propósito: ese es el stock general que usan
-- el cotizador y el agente; este es el control físico por sucursal. Un producto
-- por sucursal (índice único) y cantidad 0 = enlazado pero agotado allí.
--
-- Aditiva y re-ejecutable.

CREATE TABLE IF NOT EXISTS "branch" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "address" varchar(500),
  "phone" varchar(32),
  "notes" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch" ADD CONSTRAINT "branch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branch_org_idx" ON "branch" ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "branch_inventory" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "branch_id" varchar(255) NOT NULL,
  "product_id" varchar(255) NOT NULL,
  "quantity" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_product_id_catalog_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_product"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "branch_inventory" ADD CONSTRAINT "branch_inventory_quantity_check" CHECK ("quantity" >= 0 AND "quantity" <= 1000000);
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "branch_inventory_branch_product_uq" ON "branch_inventory" ("branch_id","product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branch_inventory_org_idx" ON "branch_inventory" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "branch_inventory_product_idx" ON "branch_inventory" ("product_id");
