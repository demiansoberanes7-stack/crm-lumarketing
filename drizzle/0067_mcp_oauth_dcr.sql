CREATE TABLE IF NOT EXISTS "mcp_oauth_client" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL UNIQUE,
  "client_name" text,
  "redirect_uris" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
