-- Google Calendar (P2): estado pendiente del flujo OAuth con callback.
-- Aditiva: no modifica ni borra datos existentes.

CREATE TABLE IF NOT EXISTS "google_oauth_state" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "state" varchar(255) NOT NULL,
  "client_id" varchar(255) NOT NULL,
  "client_secret_cipher" varchar(1024) NOT NULL,
  "client_secret_iv" varchar(255) NOT NULL,
  "client_secret_tag" varchar(255) NOT NULL,
  "calendar_id" varchar(255) DEFAULT 'primary' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_oauth_state_uq" ON "google_oauth_state" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_oauth_state_org_idx" ON "google_oauth_state" ("organization_id");
