-- Credenciales de integraciones (Meta Ads, Google Ads, GA4) en reposo cifradas.
-- Mismo patrón AES-256-GCM que 0007: triple cipher/iv/tag. El jsonb legado
-- sigue en pie como fallback de lectura hasta correr scripts/encrypt-integrations.mjs.
ALTER TABLE integration ADD COLUMN IF NOT EXISTS credentials_cipher text;
ALTER TABLE integration ADD COLUMN IF NOT EXISTS credentials_iv text;
ALTER TABLE integration ADD COLUMN IF NOT EXISTS credentials_tag text;
