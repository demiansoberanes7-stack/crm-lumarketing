-- quote_item: cerrar el hueco de aislamiento de tenant.
-- Única tabla de dominio sin organization_id; se backfillea desde su quote.
ALTER TABLE "quote_item" ADD COLUMN IF NOT EXISTS "organization_id" varchar(255);
--> statement-breakpoint
UPDATE "quote_item" qi
SET "organization_id" = q."organization_id"
FROM "quote" q
WHERE qi."quote_id" = q."id" AND qi."organization_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "quote_item" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_item_org_idx" ON "quote_item" ("organization_id");
