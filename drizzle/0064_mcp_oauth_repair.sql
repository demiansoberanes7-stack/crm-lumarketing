-- The production database had already consumed migration index 62 from an
-- older branch. Recreate the MCP OAuth tables idempotently for that case.
CREATE TABLE IF NOT EXISTS "mcp_authorization_code" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "code_hash" varchar(64) NOT NULL UNIQUE,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "resource" text NOT NULL,
  "code_challenge" varchar(128) NOT NULL,
  "code_challenge_method" varchar(10) DEFAULT 'S256' NOT NULL,
  "scopes" text NOT NULL,
  "user_id" varchar(255) NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_auth_code_expiry_idx" ON "mcp_authorization_code" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_access_token" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "client_id" text NOT NULL,
  "resource" text NOT NULL,
  "scopes" text NOT NULL,
  "user_id" varchar(255) NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_access_token_expiry_idx" ON "mcp_access_token" USING btree ("expires_at");
