-- 0080 — Plantillas de WhatsApp y consentimiento de marketing
--
-- Meta solo permite iniciar conversaciones fuera de la ventana de 24 h con
-- plantillas aprobadas y, en el caso de las de categoría MARKETING, con opt-in
-- previo del contacto. El CRM guarda ese consentimiento por contacto y la
-- categoría de la plantilla usada por la campaña para poder aplicar la regla
-- en la cola de envíos.
--
-- Aditiva y re-ejecutable.

ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_marketing_opt_in_at" timestamp;
--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "wa_marketing_opt_in_source" varchar(40);
--> statement-breakpoint
ALTER TABLE "broadcast_campaign" ADD COLUMN IF NOT EXISTS "template_category" varchar(20);
--> statement-breakpoint
ALTER TABLE "broadcast_campaign" ADD COLUMN IF NOT EXISTS "template_header_format" varchar(20);
--> statement-breakpoint
ALTER TABLE "broadcast_campaign" ADD COLUMN IF NOT EXISTS "template_header_media_url" varchar(2048);
