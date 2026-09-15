-- Add AI provider columns to agent_profile
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS ai_token text;
ALTER TABLE agent_profile ADD COLUMN IF NOT EXISTS ai_model varchar(255);
