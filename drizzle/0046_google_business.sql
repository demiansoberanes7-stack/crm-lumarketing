CREATE TABLE IF NOT EXISTS "google_business_credentials" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"client_id" varchar(512) NOT NULL,
	"client_secret_cipher" text NOT NULL,
	"client_secret_iv" text NOT NULL,
	"client_secret_tag" text NOT NULL,
	"refresh_token_cipher" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gb_credentials_org_uq" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_business_location" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"average_rating" numeric(3, 2),
	"review_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "google_business_review" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"location_id" varchar(255) NOT NULL,
	"review_name" varchar(255) NOT NULL,
	"reviewer_name" varchar(255),
	"rating" integer NOT NULL,
	"comment" text,
	"create_time" timestamp NOT NULL,
	"update_time" timestamp,
	"reply_comment" text,
	"replied_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_business_credentials" ADD CONSTRAINT "google_business_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_business_location" ADD CONSTRAINT "google_business_location_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_business_review" ADD CONSTRAINT "google_business_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "google_business_review" ADD CONSTRAINT "google_business_review_location_id_google_business_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."google_business_location"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gb_location_org_name_uq" ON "google_business_location" USING btree ("organization_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gb_location_org_idx" ON "google_business_location" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gb_review_org_name_uq" ON "google_business_review" USING btree ("organization_id","review_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gb_review_org_location_idx" ON "google_business_review" USING btree ("organization_id","location_id");
