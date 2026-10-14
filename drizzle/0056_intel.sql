CREATE TABLE IF NOT EXISTS "intel_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"youtube_key_cipher" text NOT NULL,
	"youtube_key_iv" text NOT NULL,
	"youtube_key_tag" text NOT NULL,
	"denue_token_cipher" text,
	"denue_token_iv" text,
	"denue_token_tag" text,
	"last_ingest_at" timestamp,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intel_credentials_org_uq" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_term" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"keywords" jsonb NOT NULL,
	"geo" varchar(2) DEFAULT 'MX' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intel_term_org_name_uq" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_snapshot" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"term_id" varchar(255) NOT NULL,
	"day" varchar(10) NOT NULL,
	"value" bigint NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"source" varchar(40) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intel_snapshot_term_day_uq" UNIQUE("term_id","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_video" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"term_id" varchar(255) NOT NULL,
	"video_id" varchar(40) NOT NULL,
	"title" varchar(300),
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" bigint DEFAULT 0 NOT NULL,
	"day" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intel_video_term_video_day_uq" UNIQUE("term_id","video_id","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intel_search_log" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"query" varchar(200) NOT NULL,
	"term_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intel_credentials" ADD CONSTRAINT "intel_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intel_term" ADD CONSTRAINT "intel_term_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intel_snapshot" ADD CONSTRAINT "intel_snapshot_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intel_snapshot" ADD CONSTRAINT "intel_snapshot_term_id_intel_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."intel_term"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intel_video" ADD CONSTRAINT "intel_video_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intel_video" ADD CONSTRAINT "intel_video_term_id_intel_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."intel_term"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intel_search_log" ADD CONSTRAINT "intel_search_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "intel_search_log" ADD CONSTRAINT "intel_search_log_term_id_intel_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."intel_term"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_term_org_active_idx" ON "intel_term" USING btree ("organization_id","active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_snapshot_org_day_idx" ON "intel_snapshot" USING btree ("organization_id","day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_snapshot_org_term_idx" ON "intel_snapshot" USING btree ("organization_id","term_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_video_org_term_idx" ON "intel_video" USING btree ("organization_id","term_id","day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intel_search_log_org_idx" ON "intel_search_log" USING btree ("organization_id","created_at");
