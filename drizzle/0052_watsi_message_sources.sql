ALTER TABLE "watsi_message"
  ADD COLUMN IF NOT EXISTS "sources" jsonb;
