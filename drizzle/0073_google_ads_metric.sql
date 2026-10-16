-- Fase G — Google Ads métricas.
-- Tabla para almacenar las métricas de Google Ads (impresiones, clics, costo,
-- conversiones, CTR, CPC, ROAS) por campaña, grupo de anuncios y fecha.
-- Aditiva: no rompe filas existentes.

CREATE TABLE "google_ads_metric" (
  "id" varchar(255) NOT NULL PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "campaign_id" varchar(255) NOT NULL,
  "ad_group_id" varchar(255),
  "date" date NOT NULL,
  "impressions" integer NOT NULL DEFAULT 0,
  "clicks" integer NOT NULL DEFAULT 0,
  "cost_cents" integer NOT NULL DEFAULT 0,
  "conversions" integer NOT NULL DEFAULT 0,
  "currency" varchar(10) NOT NULL DEFAULT 'MXN',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Índices de consulta habituales: por organización, campaña y fecha.
CREATE INDEX "google_ads_metric_org_idx" ON "google_ads_metric" ("organization_id");
CREATE INDEX "google_ads_metric_campaign_idx" ON "google_ads_metric" ("campaign_id");
CREATE INDEX "google_ads_metric_date_idx" ON "google_ads_metric" ("date");