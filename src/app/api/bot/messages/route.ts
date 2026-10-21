import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import type { Channel } from "@/lib/channels";
import { formatAgentReply, fitsChannel } from "@/server/ai/reply-format";
import { isChannelAiDisabledFor } from "@/server/ai/channel-policy";
import { SendError, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1).max(4096),
});

/**
 * Envío del cerebro externo A TRAVÉS del CRM: el token de WhatsApp nunca sale
 * de aquí. Usa el mismo camino que el composer de la bandeja (`sendText`), así
 * que el mensaje queda en el hilo marcado como IA, respeta la ventana de 24 h
 * y hereda el guard de sandbox del Laboratorio.
 *
 * 409 tipados: ai_paused (un humano tomó la conversación) · window_closed ·
 * sandbox_violation.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "Esta instancia no tiene una única organización para el cerebro externo");
  }

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Gate de handoff: el bot JAMÁS habla sobre una conversación pausada. Se
  // relee aquí porque entre que el bot pidió el contexto y armó su respuesta
  // (segundos de un LLM) el dueño pudo haber tomado la conversación.
  const db = getDb();
  const convs = await db
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      channel: schema.conversation.channel,
    })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (
    !conv.aiEnabled ||
    conv.handoffAt ||
    (await isChannelAiDisabledFor(organizationId, conv.channel))
  ) {
    return apiError(
      409,
      "ai_paused",
      "La IA está en pausa en esta conversación o en su canal"
    );
  }

  try {
    // El mismo embudo que el agente incluido: un cerebro externo que manda el
    // párrafo amontonado produce el mismo problema en el móvil del dueño, y un
    // texto de 4096 caracteres reventaba contra el tope del canal sin entregar
    // nada. Formatear y ajustar aquí, antes de `sendText`.
    const channel = conv.channel as Channel;
    const result = await sendText({
      conversationId: body.data.conversationId,
      organizationId,
      text: fitsChannel(formatAgentReply(body.data.text, channel).trim(), channel).trim(),
      aiGenerated: true,
    });
    return Response.json({ messageId: result.messageId });
  } catch (err) {
    if (err instanceof SendError) {
      if (err.code === "window_closed") {
        return apiError(409, "window_closed", err.message);
      }
      if (err.code === "sandbox_violation") {
        return apiError(409, "sandbox_violation", err.message);
      }
      return apiError(502, err.code, err.message);
    }
    throw err;
  }
}
