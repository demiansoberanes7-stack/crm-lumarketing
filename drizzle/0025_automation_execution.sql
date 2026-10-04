CREATE TABLE IF NOT EXISTS "automation_execution" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"conversation_id" varchar(255) NOT NULL,
	"rule_id" varchar(80) NOT NULL,
	"triggered_by" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"started_at" timestamp,
	"sent_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_execution" ADD CONSTRAINT "automation_execution_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "automation_execution" ADD CONSTRAINT "automation_execution_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_execution_due_idx" ON "automation_execution" ("status","scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_execution_org_sent_idx" ON "automation_execution" ("organization_id","sent_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_execution_conversation_idx" ON "automation_execution" ("conversation_id","created_at");
