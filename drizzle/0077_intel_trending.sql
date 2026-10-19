-- Inteligencia de mercado: dos huecos del flujo de datos.
--
-- 1) `intel_gt_related` no distinguía la lista «Principal» (índice 0–100) de
--    «Subiendo» (% de alza) y el índice único era (término, tipo, etiqueta,
--    día). Google publica el mismo tema en ambas listas: el segundo upsert del
--    día pisaba la fila del primero y se perdía una de las dos medidas.
-- 2) No había dónde guardar «Tendencias actuales» (qué se busca ahora mismo en
--    el país), que es otra fuente: volumen, hora de inicio y desglose, no una
--    serie histórica del nicho.
--
-- Todo aditivo, IF NOT EXISTS y re-ejecutable.

ALTER TABLE "intel_gt_related"
  ADD COLUMN IF NOT EXISTS "list" varchar(10) NOT NULL DEFAULT 'top';

-- Backfill: si la fila trajo % de alza o viene marcada «breakout», nació en la
-- lista «Subiendo»; cualquier otra salió de «Principal».
UPDATE "intel_gt_related"
  SET "list" = 'rising'
  WHERE ("pct" IS NOT NULL OR "is_breakout" = TRUE)
    AND "list" = 'top';

DROP INDEX IF EXISTS "intel_gt_related_term_kind_label_day_uq";

-- La unicidad anterior ya garantiza que no existan duplicados al añadir la
-- columna, así que este índice no puede fallar por datos viejos.
CREATE UNIQUE INDEX IF NOT EXISTS "intel_gt_related_term_kind_list_label_day_uq"
  ON "intel_gt_related" ("term_id", "kind", "list", "label", "day");

CREATE TABLE IF NOT EXISTS "intel_gt_trending" (
  "id" varchar(255) NOT NULL PRIMARY KEY,
  "organization_id" varchar(255) NOT NULL REFERENCES "organization" ("id") ON DELETE CASCADE,
  "geo" varchar(2) NOT NULL DEFAULT 'MX',
  "day" varchar(10) NOT NULL,
  "title" varchar(300) NOT NULL,
  "volume" integer,
  "increase_pct" integer,
  "started_at" timestamp,
  "active" boolean NOT NULL DEFAULT true,
  "category" varchar(120),
  "trend_type" varchar(30),
  "breakdown" jsonb,
  "source" varchar(40) NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Único por organización: sin ella, la segunda org que ingiriera la misma
-- tendencia del día actualizaría la fila de la primera y no obtendría dato.
CREATE UNIQUE INDEX IF NOT EXISTS "intel_gt_trending_org_geo_day_title_uq"
  ON "intel_gt_trending" ("organization_id", "geo", "day", "title");

CREATE INDEX IF NOT EXISTS "intel_gt_trending_org_geo_day_idx"
  ON "intel_gt_trending" ("organization_id", "geo", "day");
