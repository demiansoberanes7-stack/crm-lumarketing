import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { getAiDbToken } from "@/server/ai/credentials";
import { normalizeAgentFichaFields, normalizeAgentRules, AGENT_FICHA_KEY_PATTERN } from "@/lib/agent-config";
import { CHANNEL_ORDER, isAgentCapableChannel, isChannel } from "@/lib/channels";
import { enabledChannels } from "@/server/channels/enabled";
import { agendaEnabled } from "@/server/agenda/flag";
import { normalizeDisabledChannels } from "@/server/ai/channel-policy";

export const dynamic = "force-dynamic";

export const GET = withOwner(async (session) => {
  const db = getDb();
  if (!db) return apiError(500, "db_error", "Base de datos no disponible");
  const rows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const p = rows[0];
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      pipelineKeywords: p.pipelineKeywords,
      fichaFields: normalizeAgentFichaFields(p.fichaFields),
      rules: normalizeAgentRules(p.rules),
      // Zorro Tech — configuraciones extra
      maxResponseWaitSeconds: p.maxResponseWaitSeconds,
      responseLanguage: p.responseLanguage,
      fallbackLanguage: p.fallbackLanguage,
      reactWithEmoji: p.reactWithEmoji,
      activeInNewConversations: p.activeInNewConversations,
      disabledChannels: normalizeDisabledChannels(p.disabledChannels),
      businessIndustry: p.businessIndustry,
      businessLocation: p.businessLocation,
      businessDescription: p.businessDescription,
    },
    // Canales donde la IA puede responder: los que esta instancia tiene
    // encendidos Y tienen camino de agente. Listar comentarios o Google
    // Business dejaba un interruptor que no apagaba nada.
    channels: CHANNEL_ORDER.filter(
      (channel) => enabledChannels().has(channel) && isAgentCapableChannel(channel)
    ),
    // Ajustes → Agente enlaza el horario de atención a la pantalla de Agenda,
    // que no existe si la instancia no corre con AGENDA.
    agenda: agendaEnabled(),
    // Clave de IA: variable de entorno O la guardada desde Configuración.
    aiConfigured: isAiConfigured((await getAiDbToken(session.organizationId)) ?? undefined),
  });
});

const putSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
  pipelineKeywords: z.string().max(2000).nullable().optional(),
  fichaFields: z.array(z.object({
    key: z.string().regex(AGENT_FICHA_KEY_PATTERN, "La clave debe empezar con letra y contener solo minúsculas, números o _ (máximo 40 caracteres)"),
    label: z.string().trim().min(1).max(60),
  })).min(1).max(12).refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, "Las claves de ficha no se pueden repetir").optional(),
  rules: z.object({
    captureLeadData: z.boolean(),
    sendProductQuotes: z.boolean(),
    handoffOnRequest: z.boolean(),
    moveStageOnIntent: z.boolean(),
    strictKnowledgeBase: z.boolean(),
  }).optional(),
  // Zorro Tech — configuraciones extra del bot
  maxResponseWaitSeconds: z.number().int().min(0).max(60).optional(),
  responseLanguage: z.enum(["auto", "es", "en", "pt", "fr"]).optional(),
  fallbackLanguage: z.enum(["es", "en", "pt", "fr"]).optional(),
  reactWithEmoji: z.boolean().optional(),
  activeInNewConversations: z.boolean().optional(),
  disabledChannels: z
    .array(z.string().refine(isChannel, "Canal desconocido"))
    .max(CHANNEL_ORDER.length)
    .optional(),
  businessIndustry: z.string().trim().max(100).nullable().optional(),
  businessLocation: z.string().trim().max(255).nullable().optional(),
  businessDescription: z.string().trim().max(2000).nullable().optional(),
});

export const PUT = withOwner(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  if (!db) return apiError(500, "db_error", "Base de datos no disponible");

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, val] of Object.entries(body.data)) {
    if (val !== undefined) {
      patch[key] = key === "rules"
        ? normalizeAgentRules(val)
        : key === "fichaFields"
          ? normalizeAgentFichaFields(val)
          : key === "disabledChannels"
            ? normalizeDisabledChannels(val)
            : val;
    }
  }

  await db
    .update(schema.agentProfile)
    .set(patch)
    .where(scoped(schema.agentProfile.organizationId, session.organizationId));
  return Response.json({ ok: true });
});
