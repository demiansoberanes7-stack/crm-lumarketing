import type { schema } from "@/lib/db";
import { normalizeAgentFichaFields, normalizeAgentRules } from "@/lib/agent-config";
import { renderKb } from "@/server/ai/prompts";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;

/**
 * Payload del perfil del agente para un cerebro externo.
 *
 * `enabled` NO viaja: ese flag gobierna la IA in-process de Vocero; el bot
 * externo se pausa por conversación (`aiEnabled` del contexto y los handoffs),
 * no por este endpoint. `resources` nace vacío para que el shape del consumidor
 * no cambie cuando existan recursos alternativos reales.
 */
export function serializeBotProfile(profile: AgentProfile, kb: KbEntry[]) {
  return {
    profile: {
      name: profile.name,
      tone: profile.tone ?? null,
      instructions: profile.instructions ?? null,
      escalationRules: profile.escalationRules ?? null,
      greeting: profile.greeting ?? null,
      fichaFields: normalizeAgentFichaFields(profile.fichaFields),
      rules: normalizeAgentRules(profile.rules),
      /**
       * Lo que Ajustes → Agente guarda y el cerebro externo también necesita
       * para hablar como el negocio: rubro, idioma y tiempos. Viajan aquí
       * porque `buildAgentSystemPrompt` ya los usa internamente; sin ellos el
       * bot externo respondía con un perfil más pobre que el propio.
       */
      businessIndustry: profile.businessIndustry ?? null,
      businessLocation: profile.businessLocation ?? null,
      businessDescription: profile.businessDescription ?? null,
      responseLanguage: profile.responseLanguage,
      fallbackLanguage: profile.fallbackLanguage,
      maxResponseWaitSeconds: profile.maxResponseWaitSeconds,
      pipelineKeywords: profile.pipelineKeywords ?? null,
    },
    kb: renderKb(kb),
    resources: [] as { label: string; url: string }[],
  };
}
