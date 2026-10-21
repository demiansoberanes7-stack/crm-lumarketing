import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { isChannelAiDisabledFor } from "@/server/ai/channel-policy";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import {
  createSessionBooking,
  rescheduleForConversation,
} from "@/server/agenda/service";
import { bookingErrorResponse, bookingPayload } from "@/server/agenda/http";

export const dynamic = "force-dynamic";

/**
 * 015 — Reservar y mover citas, para quien conduce la conversación.
 *
 * CONTRATO: crear responde **201**, mover responde **200**. No es purismo: en
 * un sistema real un cliente que validaba `status === 200` dejó a TODOS los
 * leads sin poder agendar durante horas, y los mocks no lo detectaron porque
 * respondían 200. Si escribes un cliente, acepta 2xx.
 *
 * Y el sobre del error va ANIDADO (`{"error":{"code":…}}`) con `slots` como
 * hermano: un mock con la forma plana escondió el camino de re-oferta durante
 * semanas en ese mismo sistema.
 */

const createSchema = z.object({
  conversationId: z.string().min(1),
  startUtc: z.string().min(1),
  notes: z.string().nullish(),
});

const rescheduleSchema = z.object({
  conversationId: z.string().min(1),
  startUtc: z.string().min(1),
});

export async function POST(req: Request) {
  const gate = await guard(req);
  if ("response" in gate) return gate.response;

  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const convDenied = await assertConversationActive(
    gate.organizationId,
    body.data.conversationId
  );
  if (convDenied) return convDenied;

  try {
    const result = await createSessionBooking({
      organizationId: gate.organizationId,
      conversationId: body.data.conversationId,
      startUtc: body.data.startUtc,
      notes: body.data.notes ?? null,
      source: "ai",
      // La regla innegociable: el agente solo reserva lo que ya ofreció.
      requireOffer: true,
    });
    return Response.json(bookingPayload(result), { status: 201 });
  } catch (err) {
    return bookingErrorResponse(err);
  }
}

export async function PATCH(req: Request) {
  const gate = await guard(req);
  if ("response" in gate) return gate.response;

  const body = await parseBody(req, rescheduleSchema);
  if (!body.ok) return body.response;

  const convDenied = await assertConversationActive(
    gate.organizationId,
    body.data.conversationId
  );
  if (convDenied) return convDenied;

  try {
    const result = await rescheduleForConversation({
      organizationId: gate.organizationId,
      conversationId: body.data.conversationId,
      startUtc: body.data.startUtc,
    });
    // 200 y no 201: mover una cita no crea un recurso nuevo.
    return Response.json(bookingPayload(result));
  } catch (err) {
    return bookingErrorResponse(err);
  }
}

/* Cancelar NO existe por esta superficie a propósito: esa decisión es del
 * dueño del negocio, no del agente. El camino es el handoff. */

type Gate = { organizationId: string } | { response: Response };

/**
 * El cerebro externo obedece las MISMAS banderas que el agente in-process:
 * si la IA está apagada en la conversación o hay handoff activo, el dueño
 * tiene la palabra y el bot no debe agendar ni mover citas por su cuenta.
 */
async function assertConversationActive(
  organizationId: string,
  conversationId: string
): Promise<Response | null> {
  const [conv] = await getDb()
    .select({
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      channel: schema.conversation.channel,
    })
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  if (!conv) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  if (
    !conv.aiEnabled ||
    conv.handoffAt ||
    (await isChannelAiDisabledFor(organizationId, conv.channel))
  ) {
    return apiError(
      409,
      "handoff_active",
      "La conversación está en manos de un humano o su canal tiene la IA apagada; el agente no agenda"
    );
  }
  return null;
}

async function guard(req: Request): Promise<Gate> {
  if (!agendaEnabled()) return { response: agendaDisabledResponse() };
  const denied = requireBotKey(req);
  if (denied) return { response: denied };
  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return {
      response: apiError(409, "no_org", "Esta instancia no tiene una única organización para el cerebro externo"),
    };
  }
  return { organizationId };
}

