-- LUMARK — configuraciones extra del bot
ALTER TABLE agent_profile
  ADD COLUMN IF NOT EXISTS max_response_wait_seconds integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS response_language varchar(20) NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS fallback_language varchar(20) NOT NULL DEFAULT 'es',
  ADD COLUMN IF NOT EXISTS react_with_emoji boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_in_new_conversations boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS business_industry varchar(100),
  ADD COLUMN IF NOT EXISTS business_location varchar(255),
  ADD COLUMN IF NOT EXISTS business_description text;
