import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
import { reactToInbound, SendError, sendText } from "@/server/inbox/send";
import {
  agentActionSchema,
  degradeAction,
  resolveStage,
  type AgentActionType,
} from "@/server/ai/actions";
import { isChannelAiDisabled } from "@/server/ai/channel-policy";
import { formatAgentReply } from "@/server/ai/reply-format";
import { matchesHandoffIntent, matchesPipelineKeyword } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { renderInventoryResults, searchInventory } from "@/server/ai/inventory";
import { agendaEnabled } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";
import { bookSlot, offerSlots } from "@/server/agenda/agent";
import { getOffers, mapaDeHuecosParaModelo } from "@/server/agenda/offers";
import { getBusinessSettings } from "@/server/business-settings";
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

/**
 * TODO silencio se reporta. Un turno que no responde sin dejar rastro es
 * indistinguible de una IA rota: el dueño escribe "no contesta", y auditoría
 * tiene que adivinar entre cinco puertas. El motivo va en el log, no en la
 * interfaz, porque la interfaz no puede saber lo que el turno decidió.
 */
function silentTurn(
  conversationId: string,
  organizationId: string,
  reason: string
): void {
  console.info(
    `[agente] turno sin respuesta (${reason}) en ${conversationId} (org ${organizationId})`
  );
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
  if (conversation.handoffAt || !conversation.aiEnabled) {
    silentTurn(
      conversationId,
      organizationId,
      conversation.handoffAt
        ? `handoff:${conversation.handoffReason ?? "activo"}`
        : "ia_apagada_en_conversacion"
    );
    return;
  }

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) {
    silentTurn(conversationId, organizationId, "sin_perfil_de_agente");
    return;
  }
  const agentRules = normalizeAgentRules(profile.rules);
  // Ajustes → Agente → Respuesta: canales apagados de raíz. Manda sobre el
  // interruptor del chat: si el canal está apagado, ningún chat responde.
  if (
    !conversation.isTest &&
    isChannelAiDisabled(profile.disabledChannels, conversation.channel)
  ) {
    silentTurn(
      conversationId,
      organizationId,
      `canal_apagado:${conversation.channel}`
    );
    return;
  }
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
  if (!lastInbound) {
    silentTurn(conversationId, organizationId, "sin_mensaje_entrante");
    return;
  }

  /**
   * «Activo en conversaciones nuevas» (Ajustes → Agente → Respuesta).
   *
   * Apagado, el agente no entra hasta que UNA PERSONA haya hablado la
   * conversación: el dueño quiere saludar él mismo al cliente nuevo y que el bot
   * se sume después. Se busca en toda la conversación, no en la ventana de 20 de
   * arriba —si no, un chat largo abierto por un humano volvería a parecer
   * "nuevo" y el agente se quedaría fuera para siempre.
   */
  if (!conversation.isTest && !profile.activeInNewConversations) {
    const atendida = await db
      .select({ id: schema.message.id })
      .from(schema.message)
      .where(
        and(
          eq(schema.message.conversationId, conversationId),
          eq(schema.message.direction, "out"),
          eq(schema.message.aiGenerated, false)
        )
      )
      .limit(1);
    if (atendida.length === 0) {
      silentTurn(conversationId, organizationId, "conversacion_nueva_para_humano");
      return;
    }
  }

  // Ventana cerrada: no hay mensaje reciente del cliente que responder. NO se
  // hace handoff (eso dejaba la conversación muda para siempre); el agente se
  // activa solo cuando el cliente vuelve a escribir.
  if (!conversation.isTest && (replyWindowMs === null || !isWindowOpenFor(conversation.lastInboundAt, replyWindowMs))) {
    silentTurn(conversationId, organizationId, "ventana_cerrada");
    return;
  }

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (agentRules.handoffOnRequest && lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    silentTurn(conversationId, organizationId, "handoff_patron_previo");
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
    .where(eq(schema.catalogProduct.organizationId, organizationId))
    .orderBy(asc(schema.catalogProduct.name));
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
        // El atajo también debe la espera y el emoji configurados: antes los
        // saltaba, así que «Espera máxima» solo funcionaba en las respuestas
        // que pasaban por el modelo.
        await observeEtiquette(
          conversation,
          profile,
          lastInbound.waMessageId ?? lastInbound.providerMessageId
        );
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

  /**
   * Nombre del negocio y horario. Se leen aquí porque el modelo los necesita
   * para responder "de qué negocio me hablas" y "¿atendéis los sábados?": el
   * dueño los tiene configurados en Datos de Empresa y en Ajustes → Agenda, y
   * hasta ahora ninguna de las dos llegaba al prompt.
   */
  const business = await getBusinessSettings(organizationId);
  const businessHours = agenda
    ? await getSettings(organizationId)
    : null;

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({
        profile,
        kb,
        catalog,
        stages,
        agenda,
        businessHours,
        businessName: business.companyName,
        channel: conversation.channel as Channel,
      }),
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

  /**
   * Consulta de inventario en dos fases: el modelo pide una búsqueda, el
   * servidor la ejecuta contra el catálogo y el modelo recibe los resultados
   * para decidir con IDs reales. Sin este paso, un catálogo grande o acotado
   * empuja al modelo a inventar IDs. Máximo dos búsquedas por turno.
   */
  const MAX_INVENTORY_SEARCHES = 2;
  let result = await chatJson(agentActionSchema(agenda), messages, {
    organizationId,
  });
  let action: AgentActionType | null = null;
  for (
    let searches = 0;
    result.ok && result.data.action === "search_inventory";
  ) {
    if (!agentRules.sendProductQuotes || searches >= MAX_INVENTORY_SEARCHES) {
      action = degradeAction(result.data);
      break;
    }
    searches += 1;
    const query = result.data.query;
    const hits = await searchInventory(organizationId, query);
    messages.push({
      role: "system",
      content: [
        `RESULTADOS DE INVENTARIO para "${query}":`,
        renderInventoryResults(hits),
        hits.length > 0
          ? "Usa el ID exacto del producto que corresponda. Si ninguno coincide, dilo o pide más detalles; no inventes productos, precios ni existencias."
          : "No hay coincidencias. No inventes productos: pide más detalles u ofrece solo lo que sí aparece en el catálogo.",
      ].join("\n"),
    });
    result = await chatJson(agentActionSchema(agenda), messages, {
      organizationId,
    });
  }
  if (!action) {
    if (!result.ok) {
      if (result.error === "not_configured") {
        // Falta clave o modelo: el turno muere sin llamada al proveedor. Es lo
        // único que deja muda a UNA organización con el resto funcionando, y
        // sin este log nadie lo ve.
        console.warn(
          `[agente] IA sin configurar para esta organización (${result.detail}): el turno no responde (org ${organizationId})`
        );
        return;
      }
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
    action = result.data;
  }

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

  // Zorro Tech — la espera humana y la reacción con emoji, justo antes de
  // contestar. Viven en un helper porque las dos son costumbres de TODA
  // respuesta, no solo de la que sale del modelo.
  if (action.action !== "none") {
    await observeEtiquette(
      conversation,
      profile,
      lastInbound.waMessageId ?? lastInbound.providerMessageId
    );
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
    case "none": {
      /**
       * El modelo calla ante mensajes sueltos ("Prueba 1", "hola" repetido) y el
       * cliente se queda sin ninguna señal: quien prueba su propio negocio lee
       * "la IA no contesta" — y con razón, porque no hay ni un rastro del
       * silencio. Si NADIE ha respondido jamás en esta conversación, el saludo
       * del negocio cubre el turno; si ya fue atendida, se respeta el `none`.
       */
      silentTurn(conversationId, organizationId, "modelo_eligio_no_responder");
      if (conversation.isTest) return;
      const [atendida] = await db
        .select({ id: schema.message.id })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.conversationId, conversationId),
            eq(schema.message.direction, "out"),
            ne(schema.message.status, "failed")
          )
        )
        .limit(1);
      if (atendida) return;
      await deliverReply(
        conversation,
        profile.greeting?.trim() || "¡Hola! Gracias por escribir. ¿En qué te puedo ayudar?"
      );
      return;
    }
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
        text += renderProductCard(product);
      } else {
        text += "No pude encontrar ese producto en el catálogo.";
      }

      await deliverReply(conversation, text.trim());
      return;
    }
    case "create_quote": {
      const requested = action.items?.length
        ? action.items
        : action.item_id
          ? [{ item_id: action.item_id, quantity: action.quantity }]
          : [];
      if (requested.length === 0) {
        await deliverReply(
          conversation,
          action.reply ?? "Necesito saber qué producto quieres cotizar. ¿Me dices cuál?"
        );
        return;
      }

      // Varias líneas del mismo producto se suman: el stock se valida contra la
      // cantidad total, no contra cada línea por separado.
      const quantities = new Map<string, number>();
      for (const line of requested) {
        quantities.set(line.item_id, (quantities.get(line.item_id) ?? 0) + (line.quantity ?? 1));
      }
      const ids = [...quantities.keys()];
      const products = await getDb()
        .select()
        .from(schema.catalogProduct)
        .where(
          scoped(
            schema.catalogProduct.organizationId,
            organizationId,
            inArray(schema.catalogProduct.id, ids)
          )
        );
      const byId = new Map(products.map((product) => [product.id, product]));

      if (ids.some((id) => !byId.get(id))) {
        await deliverReply(
          conversation,
          "No encontré en el catálogo el producto que quieres cotizar. ¿Me confirmas el nombre exacto?"
        );
        return;
      }
      const unavailable = ids.filter((id) => !byId.get(id)!.available);
      if (unavailable.length > 0) {
        const names = unavailable.map((id) => `"${byId.get(id)!.name}"`).join(", ");
        await deliverReply(
          conversation,
          `No puedo cotizar ${names} porque ${unavailable.length === 1 ? "ya no está disponible" : "ya no están disponibles"}. ¿Quieres que busque una alternativa?`
        );
        return;
      }
      if (ids.some((id) => byId.get(id)!.currency !== "MXN")) {
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

      // Inventario antes de crear: el servicio también valida, pero aquí el
      // cliente recibe una respuesta conversacional en vez de un error.
      const shortages = ids
        .map((id) => {
          const product = byId.get(id)!;
          return { product, quantity: quantities.get(id)!, stock: product.stock };
        })
        .filter((entry): entry is { product: (typeof products)[number]; quantity: number; stock: number } =>
          entry.stock !== null && entry.quantity > entry.stock
        );
      if (shortages.length === 1) {
        const { product, stock } = shortages[0]!;
        await deliverReply(
          conversation,
          stock <= 0
            ? `El producto "${product.name}" está agotado por el momento. ¿Quieres que te avise cuando vuelva o prefieres ver alternativas?`
            : `Del producto "${product.name}" solo quedan ${stock} pieza${stock === 1 ? "" : "s"}. ¿Genero la cotización con esa cantidad?`
        );
        return;
      }
      if (shortages.length > 1) {
        const detail = shortages
          .map(({ product, quantity, stock }) =>
            stock <= 0
              ? `"${product.name}" está agotado`
              : `de "${product.name}" solo quedan ${stock} pieza${stock === 1 ? "" : "s"} (pediste ${quantity})`
          )
          .join("; ");
        await deliverReply(conversation, `No puedo cotizar todo lo pedido: ${detail}. ¿Ajusto la cotización a lo disponible?`);
        return;
      }

      const { createQuote, getQuote, sendQuote } = await import("@/server/quotes/service");
      try {
        // «Sin IVA» es una petición del cliente, no un antojo del modelo: solo
        // se baja el impuesto cuando la acción lo trae explícitamente en false.
        const sinIva = action.iva === false;
        const quoteId = await createQuote(organizationId, {
          contactId: conversation.contactId,
          items: ids.map((id) => {
            const product = byId.get(id)!;
            return {
              productId: product.id,
              name: product.name,
              description: product.shortDescription ?? undefined,
              quantity: quantities.get(id)!,
              unitPrice: product.price,
            };
          }),
          taxRate: sinIva ? 0 : undefined,
        }, undefined, { agentSourceMessageId: lastInbound.id });
        const quote = await getQuote(organizationId, quoteId);
        if (!quote) throw new Error("La cotización no quedó disponible después de crearla");

        if (quote.status === "draft") {
          await sendQuote(organizationId, quoteId, {
            channel: quoteChannel,
            conversationId: conversation.id,
          });
        }

        const total = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(quote.total / 100);
        const impuesto = quote.taxRate === 0 ? " sin IVA" : "";
        const reply = quote.status === "draft"
          ? `Te comparto la cotización ${quote.quoteNumber} por ${total} MXN${impuesto}.`
          : `La cotización ${quote.quoteNumber} ya está registrada${impuesto} con estado ${quote.status}.`;
        await deliverReply(conversation, action.reply ? `${action.reply}\n\n${reply}` : reply);
      } catch (error) {
        console.error(`[agente] no se pudo enviar la cotización: ${error}`);
        await deliverReply(conversation, "No pude completar el envío de la cotización desde este chat. Un asesor puede retomarla desde el cotizador.");
      }
      return;
    }
    case "handoff": {
      // `handoffOnRequest` off no le quita al cliente el derecho a un humano:
      // apaga el atajo por patrón y su línea en el prompt, pero si el modelo
      // decide escalar porque el cliente lo pidió, aquí se acata.
      if (action.farewell) {
        await deliverReply(conversation, action.farewell);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;
type AgentProfileRow = typeof schema.agentProfile.$inferSelect;

/**
 * Las dos costumbres que Ajustes → Agente configura antes de cada respuesta:
 * la espera «humana» (`maxResponseWaitSeconds`) y la reacción con emoji.
 * Decorativas ambas: si el canal no admite reacciones, `reactToInbound` no hace
 * nada y el turno sigue. El Laboratorio no espera — evalúa el modelo.
 */
async function observeEtiquette(
  conversation: Conversation,
  profile: AgentProfileRow,
  inboundMessageId: string | null
): Promise<void> {
  if (conversation.isTest) return;
  if (profile.maxResponseWaitSeconds > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, profile.maxResponseWaitSeconds * 1000)
    );
  }
  if (profile.reactWithEmoji) {
    await reactToInbound({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      messageId: inboundMessageId,
      emoji: "👍",
    });
  }
}

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string
): Promise<void> {
  // Un solo embudo de formato: el prompt pide renglones, aquí se cumple. Se
  // aplica también al sandbox para que el Laboratorio vea el texto real.
  const formatted = formatAgentReply(
    text,
    conversation.channel as Channel
  ).trim();
  if (!formatted) {
    silentTurn(conversation.id, conversation.organizationId, "respuesta_vacia");
    return;
  }
  if (conversation.isTest) {
    await persistTestOutbound(conversation, formatted);
    return;
  }
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text: formatted,
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
    .orderBy(desc(schema.lead.isPrimary), desc(schema.lead.lastActivityAt))
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
