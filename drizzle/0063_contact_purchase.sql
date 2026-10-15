-- Contactos: detalle de la compra junto a la fuente ("Compra")
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "purchase_product" varchar(255);
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "purchase_date" timestamp;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "purchase_amount_cents" integer;
