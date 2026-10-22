-- 0085 — Envíos masivos por correo
--
-- Las campañas de correo reutilizan broadcast_campaign / broadcast_recipient
-- (canal 'email'): el worker, la pausa/reanudación y las métricas ya existen.
-- Aquí solo se guarda el destinatario de correo, que no tenía columna propia
-- porque las campañas anteriores eran de chat.
--
-- Aditiva y re-ejecutable.

ALTER TABLE "broadcast_recipient" ADD COLUMN IF NOT EXISTS "email" varchar(320);
--> statement-breakpoint
ALTER TABLE "broadcast_recipient" ADD COLUMN IF NOT EXISTS "recipient_name" varchar(255);
--> statement-breakpoint
-- Un correo no puede repetirse dentro de la misma campaña. Los destinatarios
-- de chat tienen email NULL y Postgres admite múltiples NULL en un índice único.
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_recipient_campaign_email_uq"
  ON "broadcast_recipient" ("campaign_id", "email");
