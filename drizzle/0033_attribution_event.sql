-- Eventos de atribución de adquisición: first/last touch por contacto.
-- `attribution_type` distingue verificada/declarada/inferida/desconocida para
-- no presentar un origen deducido como si fuera un hecho confirmado.
CREATE TABLE IF NOT EXISTS "attribution_event" (
  "id" varchar(255) PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "contact_id" varchar(255) REFERENCES "contact"("id") ON DELETE SET NULL,
  "conversation_id" varchar(255) REFERENCES "conversation"("id") ON DELETE SET NULL,
  "channel_id" varchar(255) REFERENCES "acquisition_channel"("id") ON DELETE SET NULL,
  "campaign_id" varchar(255) REFERENCES "campaign"("id") ON DELETE SET NULL,
  "offer_id" varchar(255) REFERENCES "offer"("id") ON DELETE SET NULL,
  "creative_id" varchar(255) REFERENCES "ad_creative"("id") ON DELETE SET NULL,
  "touch_type" varchar(10) NOT NULL,
  "attribution_type" varchar(20) NOT NULL,
  "source" varchar(100),
  "medium" varchar(100),
  "campaign_name" varchar(255),
  "utm_source" varchar(255),
  "utm_medium" varchar(255),
  "utm_campaign" varchar(255),
  "utm_content" varchar(255),
  "utm_term" varchar(255),
  "click_id" varchar(255),
  "occurred_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_event_org_contact_idx" ON "attribution_event" ("organization_id", "contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_event_org_occurred_idx" ON "attribution_event" ("organization_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_event_org_touch_idx" ON "attribution_event" ("organization_id", "touch_type", "occurred_at");
