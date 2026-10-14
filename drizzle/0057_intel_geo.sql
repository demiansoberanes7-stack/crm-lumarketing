CREATE TABLE IF NOT EXISTS "intel_geo_snapshot" (
	"id" varchar(255) PRIMARY KEY,
	"organization_id" varchar(255) NOT NULL,
	"term_id" varchar(255) NOT NULL,
	"state" varchar(2) NOT NULL,
	"count" integer NOT NULL,
	"censored" boolean DEFAULT false NOT NULL,
	"day" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_geo_snapshot" ADD CONSTRAINT "intel_geo_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_geo_snapshot" ADD CONSTRAINT "intel_geo_snapshot_term_id_intel_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."intel_term"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intel_geo_term_state_day_uq" ON "intel_geo_snapshot" USING btree ("term_id","state","day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_geo_org_day_idx" ON "intel_geo_snapshot" USING btree ("organization_id","day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_geo_org_term_idx" ON "intel_geo_snapshot" USING btree ("organization_id","term_id");
