import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { publishWebhook } from "@/server/webhooks/dispatcher";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type LeadRow = typeof schema.lead.$inferSelect;

/**
 * Webhooks de salida para lo que cambió en este PATCH.
 *
 * El catálogo prometía `lead.amount_changed` y `lead.priority_changed` desde
 * el día uno y nadie los emitía: quien integraba su sistema con el CRM veía
 * las dos casillas seleccionables y nunca llegaba nada. La comparación es
 * contra el valor ANTES del update, para que guardar el mismo monto de nuevo
 * no dispare un evento.
 */
function emitLeadFieldChanges(
  organizationId: string,
  before: LeadRow,
  after: LeadRow
): void {
  if (before.amountCents !== after.amountCents) {
    publishWebhook(organizationId, "lead.amount_changed", {
      leadId: after.id,
      contactId: after.contactId,
      from: before.amountCents,
      to: after.amountCents,
      currency: after.currency,
    });
  }
  if (before.priority !== after.priority) {
    publishWebhook(organizationId, "lead.priority_changed", {
      leadId: after.id,
      contactId: after.contactId,
      from: before.priority,
      to: after.priority,
    });
  }
}

const patchSchema = z.object({
  /**
   * Opcionales desde que el lead tiene monto: capturar dinero es un gesto
   * distinto de mover la tarjeta, y exigir la etapa para guardar un importe
   * obligaría al cliente a reenviar dónde estaba —con el riesgo de moverlo sin
   * querer si el tablero venía desfasado—. Sin `stageId` no se mueve nada.
   */
  stageId: z.string().min(1).optional(),
  position: z.number().int().min(0).optional(),
  /**
   * Obligatorio al ENTRAR a una etapa perdida. No se valida aquí sino en la
   * puerta: la regla es del dominio, no de esta ruta, y hay más caminos que
   * mueven tarjetas.
   */
  lossReason: z
    .enum([
      "precio",
      "no_es_perfil",
      "sin_presupuesto",
      "eligio_otro",
      "nunca_contesto",
      "otro",
    ])
    .optional(),
  lossNote: z.string().max(500).optional(),
  /**
   * Monto en centavos enteros. `null` explícito lo borra; ausente lo deja como
   * estaba — capturar el monto y mover la tarjeta son dos gestos distintos y
   * uno no debe pisar al otro.
   */
  amountCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  /** `null` explícito la quita; ausente la deja como estaba. */
  priority: z.enum(["alta", "media", "baja"]).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // El monto viaja en el MISMO update que el movimiento: capturarlo mientras
  // se arrastra la tarjeta no debe costar dos viajes ni dejar un estado a
  // medias si el segundo falla.
  const extra: Record<string, unknown> = {};
  if (body.data.amountCents !== undefined) {
    extra.amountCents = body.data.amountCents;
    // Sin monto no hay moneda que guardar: dejarla apuntando a un importe
    // borrado haría que el tablero contara un lead que ya no tiene número.
    extra.currency =
      body.data.amountCents === null
        ? null
        : (body.data.currency ?? (await getBranding(session.organizationId)).currency);
  }

  if (body.data.priority !== undefined) {
    extra.priority = body.data.priority;
    // La fecha acompaña al valor: sirve para saber si la decisión es de hoy o
    // de hace tres semanas, que es lo que vuelve útil mirarla.
    extra.priorityUpdatedAt = body.data.priority === null ? null : new Date();
  }

  // Se lee el lead ANTES del update: es la única forma de saber si el monto o
  // la prioridad cambiaron de verdad para disparar su webhook.
  const db = getDb();
  const [before] = await db
    .select()
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        session.organizationId,
        eq(schema.lead.id, id)
      )
    )
    .limit(1);
  if (!before) return apiError(404, "not_found", "Lead no encontrado");

  // Sin etapa: solo se actualizan los campos del lead. No pasa por la puerta
  // de la bitácora porque no hay movimiento que registrar — y el guardarraíl
  // sigue contento: aquí jamás se escribe `stageId`.
  if (!body.data.stageId) {
    if (Object.keys(extra).length === 0) {
      return apiError(422, "nothing_to_update", "No hay nada que actualizar");
    }
    await db
      .update(schema.lead)
      .set({ ...extra, updatedAt: new Date() })
      .where(
        scoped(
          schema.lead.organizationId,
          session.organizationId,
          eq(schema.lead.id, id)
        )
      );
    const [lead] = await db
      .select()
      .from(schema.lead)
      .where(
        scoped(
          schema.lead.organizationId,
          session.organizationId,
          eq(schema.lead.id, id)
        )
      )
      .limit(1);
    if (!lead) return apiError(404, "not_found", "Lead no encontrado");
    emitLeadFieldChanges(session.organizationId, before, lead);
    return Response.json({ lead });
  }

  const res = await moveLeadToStage({
    organizationId: session.organizationId,
    leadId: id,
    toStageId: body.data.stageId,
    position: body.data.position,
    actorUserId: session.userId,
    source: "dueno",
    lossReason: body.data.lossReason ?? null,
    lossNote: body.data.lossNote ?? null,
    extra,
  });

  if (!res.ok) {
    if (res.reason === "lead_not_found") {
      return apiError(404, "not_found", "Lead no encontrado");
    }
    if (res.reason === "stage_not_found") {
      return apiError(422, "invalid_stage", "Etapa inexistente");
    }
    // El tablero abre su diálogo con este código: perder un trato sin decir
    // por qué deja el embudo sin la mitad que importa.
    return apiError(
      422,
      "loss_reason_required",
      "Falta el motivo de la pérdida"
    );
  }

  emitLeadFieldChanges(session.organizationId, before, res.lead);

  // Notifica a la bandeja para que la etapa se refleje en vivo (panel de
  // detalles y punto de etapa de la lista) sin recargar.
  const convRows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.contactId, res.lead.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (convRows[0]) {
    publish(session.organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: convRows[0].id } },
    });
  }

  return Response.json({ lead: res.lead });
});
