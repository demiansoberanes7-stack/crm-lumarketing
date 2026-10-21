-- 0081 — IA por canal
--
-- `disabled_channels` guarda los canales donde el agente NO responde (lista
-- vacía = todos encendidos). El interruptor por conversación sigue mandando
-- dentro de cada chat; este lo apaga para todos los chats de un canal.
--
-- Aditiva y re-ejecutable.

ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "disabled_channels" jsonb NOT NULL DEFAULT '[]'::jsonb;
