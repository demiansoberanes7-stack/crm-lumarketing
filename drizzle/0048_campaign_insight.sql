-- 0048 — Insights diarios de campañas de anuncios (Meta Ads).
--
-- El presupuesto "planeado" del CRM no reflejaba el gasto real y las métricas
-- de publicidad (ROAS/CAC/inversión) salían en N/D o con datos falsos. Esta
-- tabla persiste los componentes atómicos que devuelve Meta Ads Insights a
-- nivel campaña (gasto, impresiones, alcance, clics, conversiones y video/
-- reels). Las razones (CTR, CPC, CPM, ROAS, frecuencia, retención) se
-- recalculan al consultar para que la agregación por selección múltiple sea
-- correcta.

CREATE TABLE IF NOT EXISTS "campaign_insight" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"platform" varchar(30) DEFAULT 'meta_ads' NOT NULL,
	"campaign_external_id" varchar(255) NOT NULL,
	"campaign_name" varchar(500),
	"campaign_objective" varchar(100),
	"status" varchar(30),
	"date_start" date,
	"date_stop" date,
	"currency" varchar(10) DEFAULT 'MXN' NOT NULL,
	"spend_cents" bigint DEFAULT 0 NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"unique_clicks" bigint DEFAULT 0 NOT NULL,
	"conversions" bigint DEFAULT 0 NOT NULL,
	"conversion_value_cents" bigint DEFAULT 0 NOT NULL,
	"video_views" bigint DEFAULT 0 NOT NULL,
	"thruplay" bigint DEFAULT 0 NOT NULL,
	"avg_watch_time_ms" bigint DEFAULT 0 NOT NULL,
	"video_p25" bigint DEFAULT 0 NOT NULL,
	"video_p50" bigint DEFAULT 0 NOT NULL,
	"video_p75" bigint DEFAULT 0 NOT NULL,
	"video_p100" bigint DEFAULT 0 NOT NULL,
	"actions" jsonb,
	"raw" jsonb,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_insight_org_platform_camp_day_uq" UNIQUE("organization_id","platform","campaign_external_id","date_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_insight_org_date_idx" ON "campaign_insight" ("organization_id","date_start");
--> statement-breakpoint
ALTER TABLE "campaign_insight" ADD CONSTRAINT "campaign_insight_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
