CREATE TABLE IF NOT EXISTS "mcp_action_audit" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" varchar(255) NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "action" varchar(128) NOT NULL,
  "domain" varchar(64) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "scope" varchar(64) NOT NULL,
  "status" varchar(16) NOT NULL,
  "input" text,
  "result_summary" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_action_audit_org_created_idx" ON "mcp_action_audit" USING btree ("organization_id","created_at");
--> statement-breakpoint
ALTER TABLE "mcp_oauth_client" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;
