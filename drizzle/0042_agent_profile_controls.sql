ALTER TABLE agent_profile
  ADD COLUMN IF NOT EXISTS ficha_fields jsonb NOT NULL DEFAULT '[{"key":"interes","label":"Interés"},{"key":"presupuesto","label":"Presupuesto"},{"key":"ubicacion","label":"Ubicación"},{"key":"plazo","label":"Plazo"},{"key":"preferencias","label":"Preferencias"}]'::jsonb,
  ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '{"captureLeadData":true,"sendProductQuotes":true,"handoffOnRequest":true,"moveStageOnIntent":true,"strictKnowledgeBase":true}'::jsonb;
