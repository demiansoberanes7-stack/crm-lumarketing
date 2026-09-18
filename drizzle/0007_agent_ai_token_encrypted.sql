ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS ai_token_cipher text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS ai_token_iv text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS ai_token_tag text;
