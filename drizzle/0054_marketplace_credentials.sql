-- 0054 — Credenciales OAuth de Mercado Libre (canal `mercado_libre`).
-- Patrón idempotente (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS):
-- re-ejecutable en cualquier entorno, como 0051/0052/0053.

CREATE TABLE IF NOT EXISTS "marketplace_credentials" (
  "id" varchar(255) PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "user_id" varchar(64),
  "site_id" varchar(16),
  "client_id" varchar(255) NOT NULL,
  "client_secret_cipher" text NOT NULL,
  "client_secret_iv" text NOT NULL,
  "client_secret_tag" text NOT NULL,
  "refresh_token_cipher" text NOT NULL,
  "refresh_token_iv" text NOT NULL,
  "refresh_token_tag" text NOT NULL,
  "access_token_cipher" text,
  "access_token_iv" text,
  "access_token_tag" text,
  "access_token_expires_at" timestamp,
  "status" varchar(20) DEFAULT 'connected' NOT NULL,
  "last_polled_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "marketplace_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "ml_credentials_org_uq" ON "marketplace_credentials" ("organization_id");
