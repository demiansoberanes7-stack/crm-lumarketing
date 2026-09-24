CREATE TABLE IF NOT EXISTS "supplier" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"trade_name" varchar(255),
	"contact_name" varchar(255),
	"phone" varchar(30),
	"email" varchar(254),
	"rfc" varchar(20),
	"address" varchar(500),
	"website" varchar(254),
	"category" varchar(50),
	"payment_terms" varchar(100),
	"rating" integer,
	"notes" text,
	"archived_at" timestamp,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "supplier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_org_idx" ON "supplier" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_org_name_idx" ON "supplier" ("organization_id","name");
