CREATE TABLE IF NOT EXISTS "intel_gt_snapshot" (
	"id" varchar(255) PRIMARY KEY,
	"organization_id" varchar(255) NOT NULL,
	"term_id" varchar(255) NOT NULL,
	"day" varchar(10) NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_gt_snapshot" ADD CONSTRAINT "intel_gt_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_gt_snapshot" ADD CONSTRAINT "intel_gt_snapshot_term_id_intel_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."intel_term"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intel_gt_snapshot_term_day_uq" ON "intel_gt_snapshot" USING btree ("term_id","day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_gt_snapshot_org_term_idx" ON "intel_gt_snapshot" USING btree ("organization_id","term_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_gt_region" (
	"id" varchar(255) PRIMARY KEY,
	"organization_id" varchar(255) NOT NULL,
	"term_id" varchar(255) NOT NULL,
	"state" varchar(2) NOT NULL,
	"value" integer NOT NULL,
	"day" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_gt_region" ADD CONSTRAINT "intel_gt_region_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_gt_region" ADD CONSTRAINT "intel_gt_region_term_id_intel_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."intel_term"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intel_gt_region_term_state_day_uq" ON "intel_gt_region" USING btree ("term_id","state","day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_gt_region_org_term_idx" ON "intel_gt_region" USING btree ("organization_id","term_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_gt_related" (
	"id" varchar(255) PRIMARY KEY,
	"organization_id" varchar(255) NOT NULL,
	"term_id" varchar(255) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"label" varchar(300) NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"pct" integer,
	"is_breakout" boolean DEFAULT false NOT NULL,
	"day" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_gt_related" ADD CONSTRAINT "intel_gt_related_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intel_gt_related" ADD CONSTRAINT "intel_gt_related_term_id_intel_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."intel_term"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intel_gt_related_term_kind_label_day_uq" ON "intel_gt_related" USING btree ("term_id","kind","label","day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_gt_related_org_term_idx" ON "intel_gt_related" USING btree ("organization_id","term_id");
