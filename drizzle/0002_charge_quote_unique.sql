CREATE UNIQUE INDEX "charge_quote_uq" ON "charge" USING btree ("organization_id","quote_id");--> statement-breakpoint
