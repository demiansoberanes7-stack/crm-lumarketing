import { and, eq } from "drizzle-orm";
import type { LossReason } from "@/lib/types";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getBranding } from "@/server/branding";
import { publish } from "@/server/events/bus";
import { moveLeadToStage } from "@/server/leads/stage-history";
import { publishWebhook } from "@/server/webhooks/dispatcher";

/**
 * Escritura de leads — única fuente de verdad, compartida por el PATCH del
 * Pipeline y por el MCP. Mover la tarjeta, capturar el monto y cambiar la
 * prioridad son la MISMA operación en ambos caminos: mismo webhook, misma
 * bitácora de etapa y el mismo refetch en vivo de la bandeja.
 */

export type LeadRow = typeof schema.lead.$inferSelect;

export type UpdateLeadInput = {
  organizationId: string;
  actorUserId: string;
  leadId: string;
  /** Si falta, no se mueve nada (solo campos). */
  stageId?: string;
  position?: number;
  /** Obligatorio al ENTRAR a una etapa perdida (lo decide la puerta del dominio). */
  lossReason?: LossReason | null;
  lossNote?: string | null;
  /** `null` explícito lo borra; ausente lo deja como estaba. */
  amountCents?: number | null;
  currency?: string | null;
  /** `null` explícito la quita; ausente la deja como estaba. */
  priority?: "alta" | "media" | "baja" | null;
};

export type UpdateLeadResult =
  | {
      ok: true;
      lead: LeadRow;
      /** true solo cuando hubo movimiento de etapa real (no solo campos). */
      changed: boolean;
    }
  | {
      ok: false;
      code: "not_found" | "nothing_to_update" | "invalid_stage" | "loss_reason_required";
      message: string;
    };

/**
 * Webhooks de salida para lo que cambió en este update.
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

export async function updateLead(input: UpdateLeadInput): Promise<UpdateLeadResult> {
  const { organizationId, leadId } = input;

  // El monto viaja en el MISMO update que el movimiento: capturarlo mientras
  // se arrastra la tarjeta no debe costar dos viajes ni dejar un estado a
  // medias si el segundo falla.
  const extra: Record<string, unknown> = {};
  if (input.amountCents !== undefined) {
    extra.amountCents = input.amountCents;
    // Sin monto no hay moneda que guardar: dejarla apuntando a un importe
    // borrado haría que el tablero contara un lead que ya no tiene número.
    extra.currency =
      input.amountCents === null
        ? null
        : (input.currency ?? (await getBranding(organizationId)).currency);
  }

  if (input.priority !== undefined) {
    extra.priority = input.priority;
    // La fecha acompaña al valor: sirve para saber si la decisión es de hoy o
    // de hace tres semanas, que es lo que vuelve útil mirarla.
    extra.priorityUpdatedAt = input.priority === null ? null : new Date();
  }

  // Se lee el lead ANTES del update: es la única forma de saber si el monto o
  // la prioridad cambiaron de verdad para disparar su webhook.
  const db = getDb();
  const [before] = await db
    .select()
    .from(schema.lead)
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId)))
    .limit(1);
  if (!before) {
    return { ok: false, code: "not_found", message: "Lead no encontrado" };
  }

  // Sin etapa: solo se actualizan los campos del lead. No pasa por la puerta
  // de la bitácora porque no hay movimiento que registrar — y el guardarraíl
  // sigue contento: aquí jamás se escribe `stageId`.
  if (!input.stageId) {
    if (Object.keys(extra).length === 0) {
      return { ok: false, code: "nothing_to_update", message: "No hay nada que actualizar" };
    }
    await db
      .update(schema.lead)
      .set({ ...extra, updatedAt: new Date() })
      .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId)));
    const [lead] = await db
      .select()
      .from(schema.lead)
      .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.id, leadId)))
      .limit(1);
    if (!lead) {
      return { ok: false, code: "not_found", message: "Lead no encontrado" };
    }
    emitLeadFieldChanges(organizationId, before, lead);
    return { ok: true, lead, changed: false };
  }

  const res = await moveLeadToStage({
    organizationId,
    leadId,
    toStageId: input.stageId,
    position: input.position,
    actorUserId: input.actorUserId,
    source: "dueno",
    lossReason: input.lossReason ?? null,
    lossNote: input.lossNote ?? null,
    extra,
  });

  if (!res.ok) {
    if (res.reason === "lead_not_found") {
      return { ok: false, code: "not_found", message: "Lead no encontrado" };
    }
    if (res.reason === "stage_not_found") {
      return { ok: false, code: "invalid_stage", message: "Etapa inexistente" };
    }
    // El tablero abre su diálogo con este código: perder un trato sin decir
    // por qué deja el embudo sin la mitad que importa.
    return {
      ok: false,
      code: "loss_reason_required",
      message: "Falta el motivo de la pérdida",
    };
  }

  emitLeadFieldChanges(organizationId, before, res.lead);

  // Notifica a la bandeja para que la etapa se refleje en vivo (panel de
  // detalles y punto de etapa de la lista) sin recargar.
  const convRows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, res.lead.contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (convRows[0]) {
    publish(organizationId, {
      type: "conversation.updated",
      data: { conversation: { id: convRows[0].id } },
    });
  }

  return { ok: true, lead: res.lead, changed: res.changed };
}
