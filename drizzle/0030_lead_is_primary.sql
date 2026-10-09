-- lead: preparación para múltiples oportunidades por contacto.
-- `is_primary` marca el lead que las rutas 1:1 existentes (webhook, ficha,
-- pipeline) siguen tratando como el lead del contacto. El índice único
-- `lead_contact_uq` se MANTIENE por ahora: habilitar segundas oportunidades
-- exige soltarlo por un índice parcial y añadir la UI/API que las crea; eso
-- es un incremento aparte y probado por separado para no inestabilizar la
-- creación de leads por webhook.
ALTER TABLE "lead" ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT true;
