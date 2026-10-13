import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Channel } from "@/lib/channels";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { filterAgentFichaToConfiguredFields, normalizeAgentRules } from "@/lib/agent-config";
import { moveLeadToStage as moveLeadThroughHistory } from "@/server/leads/stage-history";
import { getEnv, isAiConfigured } from "@/lib/env";
import { chatJson, resolveAiConfig, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { isWindowOpenFor } from "@/server/inbox/window";
import { capabilitiesFor } from "@/server/channels/capabilities";
import { SendError, sendText } from "@/server/inbox/send";
import {
  agentActionSchema,
  degradeAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { matchesHandoffIntent, matchesPipelineKeyword } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { agendaEnabled } from "@/server/agenda/flag";
import { bookSlot, offerSlots } from "@/server/agenda/agent";
import { getOffers, mapaDeHuecosParaModelo } from "@/server/agenda/offers";
import { upsertFicha } from "@/server/bot/ficha";

/**
 * Turno del agente (FR-021..FR-025).
 *
 * Coalesce + lock in-process por conversación: ráfagas de mensajes → UNA
 * respuesta; nunca dos turnos simultáneos; lo que llega durante un turno
 * re-encola exactamente un turno más. Suficiente para el monolito de una
 * instancia (sin colas externas — Constitución II).
 */

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForAgent = globalThis as unknown as {
  __agentCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForAgent.__agentCoalesce) {
    globalForAgent.__agentCoalesce = new Map();
  }
  return globalForAgent.__agentCoalesce;
}

/** Punto de entrada con debounce (mensajes entrantes reales). */
export function scheduleAgentTurn(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true; // se re-encola al terminar el turno actual
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  const delay = getEnv().AGENT_COALESCE_MS;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeTurn(conversationId);
  }, delay);
}

async function executeTurn(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  try {
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      void executeTurn(conversationId);
    } else {
      map.delete(conversationId);
    }
  }
}

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(conversationId: string): Promise<void> {
  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  let conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  const aiConfig = await resolveAiConfig(organizationId);
  if (!isAiConfigured(aiConfig.token)) {
    console.warn(
      `[agente] sin OPENROUTER_API_TOKEN en el runtime: los mensajes entran pero nadie responde (org ${organizationId})`
    );
    return;
  }

  // Un handoff por 'ventana' no debe dejar la conversación muda para siempre:
  // cuando el cliente vuelve a escribir (ventana reabierta) el agente se
  // reactiva solo, en cualquier canal.
  const replyWindowMs = capabilitiesFor(conversation.channel as Channel).windowMs;
  if (
    conversation.handoffAt &&
    conversation.handoffReason === "ventana" &&
    replyWindowMs !== null &&
    isWindowOpenFor(conversation.lastInboundAt, replyWindowMs)
  ) {
    await db
      .update(schema.conversation)
      .set({ handoffAt: null, handoffReason: null, updatedAt: new Date() })
      .where(eq(schema.conversation.id, conversationId));
    conversation = { ...conversation, handoffAt: null, handoffReason: null };
  }

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  const agentRules = normalizeAgentRules(profile.rules);
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) {
    console.warn(
      `[agente] el agente está APAGADO en Ajustes → Agente: la conversación ${conversationId} queda sin respuesta (org ${organizationId})`
    );
    return;
  }

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return;

  // Ventana cerrada: no hay mensaje reciente del cliente que responder. NO se
  // hace handoff (eso dejaba la conversación muda para siempre); el agente se
  // activa solo cuando el cliente vuelve a escribir.
  if (!conversation.isTest && (replyWindowMs === null || !isWindowOpenFor(conversation.lastInboundAt, replyWindowMs))) {
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (agentRules.handoffOnRequest && lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const catalog = await db
    .select()
    .from(schema.catalogProduct)
    .where(eq(schema.catalogProduct.organizationId, organizationId));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  // Pipeline keywords: si el mensaje contiene una keyword configurada,
  // mover directamente a la etapa sin pasar por el LLM.
  if (agentRules.moveStageOnIntent && lastInbound.text && profile.pipelineKeywords) {
    const targetStage = matchesPipelineKeyword(lastInbound.text, profile.pipelineKeywords);
    if (targetStage) {
      const stage = resolveStage(targetStage, stages);
      if (stage) {
        await moveLeadToStage(organizationId, conversation.contactId, stage.id);
        publish(organizationId, {
          type: "conversation.updated",
          data: { conversation: { id: conversationId } },
        });
        await deliverReply(conversation, `Listo, tu solicitud ha sido registrada en "${targetStage}".`);
        return;
      }
    }
  }

  const agenda = agendaEnabled();

  /**
   * 015 — Los huecos vigentes, con su instante exacto.
   *
   * `book_slot` exige el `startUtc` y `findOffered` compara por epoch, sin
   * tolerancia. Pero al modelo solo le llegaban el prompt y el historial de
   * TEXTO, donde están las etiquetas que leyó el cliente —«lun 7 sep, 11:00»—
   * sin año, sin zona y sin la fecha de hoy. Con eso, acertar el instante era
   * cuestión de suerte: el rechazo caía siempre en `slot_not_offered`, cuyo
   * texto es fijo, y la conversación se quedaba en bucle repitiendo la lista.
   *
   * Es un agujero de INTEGRACIÓN: las pruebas de contrato pasan porque
   * inyectan el ISO correcto, que es justo lo que el modelo no tenía.
   *
   * Sin oferta vigente no se añade nada, así que el modelo sigue obligado a
   * ofrecer antes de reservar. Se entrega el catálogo COMPLETO, no solo los
   * tres que se enseñaron: si el cliente pide otro día, ese hueco ya estaba
   * registrado como ofrecido y ahora el modelo también lo conoce.
   *
   * Reportado por @Diony7004 en #50, con el diagnóstico ya hecho.
   */
  const ofertas = agenda ? await getOffers(organizationId, conversationId) : [];
  const mapaDeHuecos = mapaDeHuecosParaModelo(ofertas);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({ profile, kb, catalog, stages, agenda }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
    /**
     * Va AL FINAL, después del historial: es el estado de AHORA, y ponerlo
     * antes lo dejaría enterrado bajo la conversación en cuanto esta crezca.
     */
    ...(mapaDeHuecos
      ? [{ role: "system" as const, content: mapaDeHuecos }]
      : []),
  ];

  const result = await chatJson(agentActionSchema(agenda), messages, {
    organizationId,
  });
  if (!result.ok) {
    if (result.error === "not_configured") return;
    console.error(`[agente] fallo del proveedor (raw): ${result.detail}`);
    /**
     * Escalar (FR-022) solo cuando un humano DEBE intervenir:
     * - `invalid_output`: el modelo devolvió basura repetidamente en ESTA
     *   conversación (se reintentó y no hubo forma).
     * - Error de autenticación/config del proveedor (401/403): alguien tiene
     *   que arreglar la configuración.
     *
     * Un 5xx transitorio, timeout o rate limit NO apaga el agente: antes
     * fijaba `handoffAt` en TODAS las conversaciones activas de la org de
     * golpe y nada lo limpiaba solo. Un hipo del proveedor nunca tumba el
     * turno: falla este turno, se loguea, y el siguiente mensaje reintenta.
     */
    const esErrorDeConfig =
      /\b(401|403|unauthorized|forbidden|invalid.?api.?key)\b/i.test(result.detail);
    if (result.error === "invalid_output" || esErrorDeConfig) {
      await applyHandoff(conversationId, organizationId, "error");
    }
    throw new Error(result.detail || "El proveedor de IA no pudo completar el turno");
  }

  let action: AgentActionType = result.data;

  // El servidor hace cumplir las preferencias aunque el modelo devuelva una
  // acción desactivada por configuración.
  if (!agentRules.sendProductQuotes && (action.action === "send_quote" || action.action === "create_quote")) {
    action = action.reply ? { action: "reply", text: action.reply } : { action: "none" };
  }
  if (!agentRules.moveStageOnIntent && action.action === "move_stage") {
    action = degradeAction(action);
  }
  if (!agentRules.captureLeadData && action.action === "update_lead" && action.ficha) {
    action = { ...action, ficha: undefined };
  }

  // LUMARK — espera humana antes de responder (solo conversaciones reales).
  // El Laboratorio (is_test) no espera: su objetivo es evaluar el modelo, no
  // simular tiempos de escritura.
  if (!conversation.isTest && profile.maxResponseWaitSeconds > 0 && action.action !== "none") {
    await new Promise((resolve) => setTimeout(resolve, profile.maxResponseWaitSeconds * 1000));
  }

  // 015 — Agenda. Un fallo del motor degrada el turno (el agente responde sin
  // agendar), nunca lo tumba: quedarse callado es peor que no agendar.
  if (action.action === "offer_slots" || action.action === "book_slot") {
    if (!agenda) {
      action = degradeAction(action);
    } else {
      try {
        const turn =
          action.action === "offer_slots"
            ? await offerSlots({
                organizationId,
                conversationId,
                intro: action.reply,
              })
            : await bookSlot({
                organizationId,
                conversationId,
                startUtc: action.startUtc,
                confirmation: action.reply,
              });
        await deliverReply(conversation, turn.text);
        if (turn.ok) {
          publish(organizationId, {
            type: "conversation.updated",
            data: { conversation: { id: conversationId } },
          });
        }
        return;
      } catch (err) {
        console.error(`[agente] el motor de agenda falló: ${err}`);
        action = degradeAction(action);
      }
    }
  }

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      // El seguimiento automático de etapa no vive aquí: lo decide la regla
      // con su propio trigger (`stage_change`, ver `automation-events.ts`), y
      // este gancho exigía el nombre literal "Cotizado", que ninguna etapa
      // tenía — por eso nunca disparó nada.

      if (action.reply) {
        await deliverReply(conversation, action.reply);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      const ficha = action.ficha && agentRules.captureLeadData
        ? filterAgentFichaToConfiguredFields(action.ficha, profile.fichaFields)
        : {};
      if (Object.keys(ficha).length > 0) {
        await upsertFicha({
          organizationId,
          contactId: conversation.contactId,
          ficha,
        });
      }
      if (action.reply) await deliverReply(conversation, action.reply);
      return;
    }
    case "send_quote": {
      const db = getDb();
      const rows = await db
        .select()
        .from(schema.catalogProduct)
        .where(
          scoped(
            schema.catalogProduct.organizationId,
            organizationId,
            eq(schema.catalogProduct.id, action.item_id),
            eq(schema.catalogProduct.available, true)
          )
        )
        .limit(1);
      const product = rows[0];

      let text = action.reply ? `${action.reply}\n\n` : "";
      if (product) {
        const { renderProductCard } = await import("@/server/ai/product-card");
        text += renderProductCard(product, process.env.MAIN_URL || "https://crm.zorrotech.com");
      } else {
        text += "No pude encontrar ese producto en el catálogo.";
      }

      await deliverReply(conversation, text.trim());
      return;
    }
    case "create_quote": {
      const [product] = await getDb()
        .select()
        .from(schema.catalogProduct)
        .where(scoped(
          schema.catalogProduct.organizationId,
          organizationId,
          eq(schema.catalogProduct.id, action.item_id),
          eq(schema.catalogProduct.available, true)
        ))
        .limit(1);
      if (!product) {
        await deliverReply(conversation, action.reply ?? "No pude generar la cotización porque el producto no está disponible en el catálogo.");
        return;
      }
      if (product.currency !== "MXN") {
        await deliverReply(conversation, "No puedo generar una cotización formal para ese producto porque su moneda no es MXN. Un asesor puede ayudarte con el tipo de cambio.");
        return;
      }
      if (conversation.isTest) {
        await deliverReply(conversation, "En una conversación real prepararía y enviaría la cotización formal desde el sistema de cotizaciones.");
        return;
      }
      const quoteChannel = conversation.channel === "whatsapp" || conversation.channel === "instagram" || conversation.channel === "messenger"
        ? conversation.channel
        : null;
      if (!quoteChannel) {
        await deliverReply(conversation, "Puedo enviar cotizaciones formales por WhatsApp, Instagram o Messenger. Un asesor puede continuar contigo por uno de esos canales.");
        return;
      }

      const { createQuote, getQuote, sendQuote } = await import("@/server/quotes/service");
      const quantity = action.quantity ?? 1;
      // Inventario antes de crear: el servicio también valida, pero aquí el
      // cliente recibe una respuesta conversacional en vez de un error.
      if (product.stock !== null && quantity > product.stock) {
        await deliverReply(
          conversation,
          product.stock <= 0
            ? `El producto "${product.name}" está agotado por el momento. ¿Quieres que te avise cuando vuelva o prefieres ver alternativas?`
            : `Del producto "${product.name}" solo quedan ${product.stock} pieza${product.stock === 1 ? "" : "s"}. ¿Genero la cotización con esa cantidad?`
        );
        return;
      }
      try {
        const quoteId = await createQuote(organizationId, {
          contactId: conversation.contactId,
          items: [{
            productId: product.id,
            name: product.name,
            description: product.shortDescription ?? undefined,
            quantity,
            unitPrice: product.price,
          }],
        }, undefined, { agentSourceMessageId: lastInbound.id });
        const quote = await getQuote(organizationId, quoteId);
        if (!quote) throw new Error("La cotización no quedó disponible después de crearla");

        if (quote.status === "draft") {
          await sendQuote(organizationId, quoteId, quoteChannel, conversation.id);
        }

        const total = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(quote.total / 100);
        const reply = quote.status === "draft"
          ? `Te comparto la cotización ${quote.quoteNumber} por ${total} MXN.`
          : `La cotización ${quote.quoteNumber} ya está registrada con estado ${quote.status}.`;
        await deliverReply(conversation, action.reply ? `${action.reply}\n\n${reply}` : reply);
      } catch (error) {
        console.error(`[agente] no se pudo enviar la cotización: ${error}`);
        await deliverReply(conversation, "No pude completar el envío de la cotización desde este chat. Un asesor puede retomarla desde el cotizador.");
      }
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
    });
  } catch (err) {
    if (err instanceof SendError && err.code === "window_closed") {
      await applyHandoff(conversation.id, conversation.organizationId, "ventana");
      return;
    }
    throw err;
  }
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
    origin: "ai",
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId));
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  const leadId = rows[0]?.id;
  if (!leadId) return;

  // Por la puerta única: el agente mueve tarjetas igual que el dueño, y su
  // movimiento tiene que quedar en la bitácora o el embudo mentirá sobre
  // quién hizo avanzar cada lead.
  await moveLeadThroughHistory({
    organizationId,
    leadId,
    toStageId: stageId,
    source: "bot",
    extra: { lastActivityAt: new Date() },
    // El agente no clasifica pérdidas: si su etapa destino resultara ser la
    // perdida, la puerta lo rechaza y el lead se queda donde está — mejor eso
    // que un motivo inventado.
  });
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const stamped = `[IA] ${note}`;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.contact)
      .set({
        notes: sql`CASE
          WHEN ${schema.contact.notes} IS NULL OR ${schema.contact.notes} = '' THEN ${stamped}
          ELSE ${schema.contact.notes} || E'\\n' || ${stamped}
        END`,
        updatedAt: new Date(),
      })
      .where(
        scoped(
          schema.contact.organizationId,
          organizationId,
          eq(schema.contact.id, contactId)
        )
      )
      .returning({ id: schema.contact.id });
    if (!updated[0]) return;
    await tx.insert(schema.contactNote).values({
      id: newId("contactNote"),
      organizationId,
      contactId,
      body: note,
      source: "ai",
    });
  });
}
