-- 0050 — Métricas de video de Meta Ads para el explorador de campañas.
--
-- El explorador debe entregar exactamente: Reproducciones (video plays),
-- Espectadores (visualizadores únicos) y Reproducciones de video continuas de
-- 2 segundos, además de las métricas de rendimiento/interacción ya existentes.
-- Estas tres no estaban en Insights; se agregan como columnas atómicas que el
-- poller persiste y la consulta agrega.

ALTER TABLE "campaign_insight" ADD COLUMN IF NOT EXISTS "video_plays" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaign_insight" ADD COLUMN IF NOT EXISTS "unique_video_views" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "campaign_insight" ADD COLUMN IF NOT EXISTS "video_plays_2s" bigint DEFAULT 0 NOT NULL;
