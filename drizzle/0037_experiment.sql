-- Experimentos A/B: hipótesis, variantes y observaciones diarias con
-- métricas, muestra e intervalo de confianza. `evidence_status` distingue
-- "concluyente" de "inconcluso" para no decretar ganador con datos pobres.
CREATE TABLE IF NOT EXISTS "experiment" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "hypothesis" text,
  "problem" text,
  "service" varchar(100),
  "channel_id" varchar(255) REFERENCES "acquisition_channel"("id") ON DELETE SET NULL,
  "campaign_id" varchar(255) REFERENCES "campaign"("id") ON DELETE SET NULL,
  "offer_id" varchar(255) REFERENCES "offer"("id") ON DELETE SET NULL,
  "primary_metric" varchar(50),
  "status" varchar(20) NOT NULL DEFAULT 'borrador',
  "evidence_status" varchar(20) NOT NULL DEFAULT 'inconcluso',
  "conclusion" text,
  "budget_planned_cents" integer,
  "start_date" timestamp,
  "end_date" timestamp,
  "created_by" varchar(255) REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiment_org_idx" ON "experiment" ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_variant" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "experiment_id" varchar(255) NOT NULL REFERENCES "experiment"("id") ON DELETE CASCADE,
  "key" varchar(10) NOT NULL,
  "name" varchar(255) NOT NULL,
  "creative_id" varchar(255) REFERENCES "ad_creative"("id") ON DELETE SET NULL,
  "offer_id" varchar(255) REFERENCES "offer"("id") ON DELETE SET NULL,
  "message" text,
  "is_control" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_variant_exp_key_uq" ON "experiment_variant" ("experiment_id", "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experiment_observation" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "experiment_id" varchar(255) NOT NULL REFERENCES "experiment"("id") ON DELETE CASCADE,
  "variant_id" varchar(255) NOT NULL REFERENCES "experiment_variant"("id") ON DELETE CASCADE,
  "observed_on" date NOT NULL,
  "impressions" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "leads" integer NOT NULL DEFAULT 0,
  "qualified_leads" integer NOT NULL DEFAULT 0,
  "quotes" integer NOT NULL DEFAULT 0,
  "sales" integer NOT NULL DEFAULT 0,
  "revenue_cents" integer NOT NULL DEFAULT 0,
  "cost_cents" integer NOT NULL DEFAULT 0,
  "contribution_cents" integer NOT NULL DEFAULT 0,
  "sample_size" integer,
  "confidence_low" numeric,
  "confidence_high" numeric,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "experiment_observation_unique_idx" ON "experiment_observation" ("experiment_id", "variant_id", "observed_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experiment_observation_org_idx" ON "experiment_observation" ("organization_id", "observed_on");
