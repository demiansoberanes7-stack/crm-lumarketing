-- Estructura de marketing: campañas, conjuntos de anuncios, creatividades y
-- ofertas. Plataforma discriminatoria (meta_ads, google_ads, mercado_libre,
-- manual) para que Google Ads/ML puedan persistir sin migración nueva.
CREATE TABLE IF NOT EXISTS "campaign" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "platform" varchar(30) NOT NULL,
  "name" varchar(255) NOT NULL,
  "external_id" varchar(255),
  "objective" varchar(100),
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "currency" varchar(10) NOT NULL DEFAULT 'MXN',
  "budget_planned_cents" integer,
  "start_date" timestamp,
  "end_date" timestamp,
  "raw" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_org_external_uq" ON "campaign" ("organization_id", "platform", "external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_org_idx" ON "campaign" ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_set" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "campaign_id" varchar(255) NOT NULL REFERENCES "campaign"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "external_id" varchar(255),
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_set_campaign_external_uq" ON "ad_set" ("campaign_id", "external_id") WHERE "external_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_creative" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "ad_set_id" varchar(255) REFERENCES "ad_set"("id") ON DELETE CASCADE,
  "campaign_id" varchar(255) REFERENCES "campaign"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "external_id" varchar(255),
  "creative_type" varchar(50),
  "headline" varchar(512),
  "body" text,
  "media_url" varchar(1024),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_creative_campaign_idx" ON "ad_creative" ("campaign_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offer" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "service" varchar(100),
  "discount_type" varchar(20),
  "discount_value" integer,
  "status" varchar(30) NOT NULL DEFAULT 'active',
  "start_date" timestamp,
  "end_date" timestamp,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "offer_org_idx" ON "offer" ("organization_id");
