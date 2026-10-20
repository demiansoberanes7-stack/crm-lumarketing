import type { schema } from "@/lib/db";
import { normalizeAgentFichaFields, normalizeAgentRules } from "@/lib/agent-config";

type AgentProfile = typeof schema.agentProfile.$inferSelect;
type KbEntry = typeof schema.kbEntry.$inferSelect;
type CatalogProduct = typeof schema.catalogProduct.$inferSelect;

/** Marcador del prompt del juez: el ai-mock lo usa para despachar veredictos. */
export const JUDGE_MARKER = "[JUEZ]";

export function renderKb(entries: KbEntry[]): string {
  if (entries.length === 0) return "(knowledge base vacío)";
  return entries
    .map((e) =>
      e.kind === "qa"
        ? `P: ${e.question}\nR: ${e.answer}`
        : (e.content ?? "")
    )
    .filter(Boolean)
    .join("\n\n");
}

/**
 * El prompt no puede crecer con el catálogo: por encima de este tope se
 * muestran solo nombres, precio y existencias (sin descripciones largas) y el
 * modelo debe usar `search_inventory` para encontrar el resto.
 */
export const CATALOG_PROMPT_LIMIT = 60;

export function renderCatalog(
  products: CatalogProduct[],
  limit = CATALOG_PROMPT_LIMIT,
  searchHint = true
): string {
  const available = products.filter((p) => p.available);
  if (available.length === 0) return "(catálogo vacío)";
  const shown = available.slice(0, limit);
  const compact = available.length > limit;
  const body = shown
    .map((p) => {
      const price = `$${(p.price / 100).toFixed(2)} ${p.currency}`;
      const stock = p.stock === null ? "consultar" : `${p.stock} pieza${p.stock === 1 ? "" : "s"}`;
      if (compact) {
        return `- ID: ${p.id} | ${p.name} | ${price} | Inventario: ${stock}`;
      }
      const shortDesc = p.shortDescription ? `\n  Descripción: ${p.shortDescription}` : "";
      const longDesc = p.longDescription ? `\n  Ficha técnica: ${p.longDescription}` : "";
      const website = p.websiteUrl ? `\n  Sitio: ${p.websiteUrl}` : "";
      return `- ID: ${p.id} | ${p.name} | ${price} | Inventario: ${stock}${shortDesc}${longDesc}${website}`;
    })
    .join("\n");
  return compact
    ? `${body}\n(Hay ${available.length} productos disponibles y aquí solo aparecen ${limit}.${searchHint ? " Usa search_inventory para encontrar cualquier otro; no inventes IDs." : ""})`
    : body;
}

/**
 * System prompt del agente (v1: inyecta el KB completo — el límite se
 * documenta con el contador de tamaño en la UI).
 */
export function buildAgentSystemPrompt(input: {
  profile: AgentProfile;
  kb: KbEntry[];
  catalog: CatalogProduct[];
  stages: { name: string }[];
  /**
   * 015 — ¿esta instancia tiene agenda? Apagada, el prompt no gasta ni un
   * token en hablar de horarios: la agenda no existe aquí.
   */
  agenda?: boolean;
}): string {
  const { profile } = input;
  const stageNames = input.stages.map((s) => s.name).join(" | ");
  const rules = normalizeAgentRules(profile.rules);
  const fichaFields = normalizeAgentFichaFields(profile.fichaFields);
  const fichaFieldList = fichaFields.map((field) => `${field.key} (${field.label})`).join(" · ");
  const agendaLines = input.agenda
    ? [
        '- {"action":"offer_slots","reply":"..."} — ofrecer horarios para agendar (reply es solo la frase de entrada; los horarios los pone el sistema).',
        '- {"action":"book_slot","startUtc":"<uno de los horarios que el sistema ofreció, en ISO UTC>","reply":"..."} — agendar el horario que el cliente eligió.',
      ]
    : [];
  const agendaRules = input.agenda
    ? [
        "- NUNCA escribas tú los horarios ni los inventes: usa offer_slots y el sistema pega los reales.",
        "- book_slot solo acepta un horario que el sistema ofreció antes en ESTA conversación. Si el cliente pide otro, vuelve a ofrecer con offer_slots.",
        "- Si el cliente quiere CANCELAR una cita → handoff: esa decisión no es tuya.",
      ]
    : [];
  const actionLines = [
    "En cada turno respondes ÚNICAMENTE un objeto JSON con UNA acción:",
    '- {"action":"none"} — no responder nada.',
    '- {"action":"reply","text":"..."} — responder al cliente.',
    rules.captureLeadData
      ? `- {"action":"update_lead","note":"...","ficha":{"${fichaFields[0]?.key ?? "interes"}":"..."},"reply":"..."} — guardar una nota y los datos concretos revelados (ficha y reply opcionales).`
      : '- {"action":"update_lead","note":"...","reply":"..."} — guardar una nota de contexto (reply opcional).',
    ...(rules.sendProductQuotes
      ? [
          '- {"action":"search_inventory","query":"..."} — buscar en el inventario por nombre o descripción. El sistema te devuelve productos con su ID exacto, precio y existencias; úsalo antes de cotizar algo que no aparezca en el catálogo.',
          '- {"action":"send_quote","item_id":"<ID del producto>","reply":"..."} — enviar la ficha oficial de un producto del catálogo.',
        ]
      : []),
    ...(rules.sendProductQuotes
      ? [
          '- {"action":"create_quote","item_id":"<ID del producto>","quantity":1,"reply":"..."} — crear y enviar una cotización formal de UN producto por el chat actual.',
          '- {"action":"create_quote","items":[{"item_id":"<ID>","quantity":1},{"item_id":"<ID>","quantity":2}],"reply":"..."} — cotizar VARIOS productos en una sola cotización (máximo 10).',
        ]
      : []),
    ...(rules.moveStageOnIntent
      ? ['- {"action":"move_stage","stage":"<nombre exacto de etapa>","reply":"..."} — mover el lead (reply opcional).']
      : []),
    '- {"action":"handoff","reason":"...","farewell":"..."} — escalar a un humano según las reglas del negocio.',
    ...agendaLines,
  ];

  const configuredRules = [
    ...(rules.captureLeadData
      ? [`- Guarda datos explícitos del cliente en ficha usando solo estos campos: ${fichaFieldList}. No inventes valores ni borres campos no mencionados; resume también el contexto en note.`]
      : []),
    ...(rules.sendProductQuotes
      ? [
          "- Si el cliente pide precio, disponibilidad o información de un producto, usa send_quote para compartir su ficha oficial (el sistema arma el mensaje con precio, inventario, descripción, ficha técnica y sitio).",
          "- Si el producto que pide el cliente no está en el catálogo mostrado o no estás seguro de su ID, usa PRIMERO search_inventory con las palabras del cliente. Usa después el ID exacto que te devuelva el sistema; nunca inventes IDs, precios ni existencias.",
          "- Si el cliente solicita explícitamente una cotización, presupuesto formal o propuesta de compra, usa create_quote con productos disponibles del catálogo y la cantidad indicada (por defecto 1). Para varios productos usa items; no inventes descuentos ni cantidades mayores al inventario reportado.",
        ]
      : []),
    ...(rules.handoffOnRequest
      ? ["- Si el cliente pide hablar con una persona, humano o asesor, usa handoff."]
      : []),
    ...(rules.strictKnowledgeBase
      ? ["- El conocimiento configurado es la única fuente de verdad: si algo no está ahí ni en el catálogo, no inventes; di que lo confirmarás o escala."]
      : []),
    ...(rules.moveStageOnIntent
      ? [`- Si detectas intención clara de compra, usa move_stage con el nombre exacto de una etapa disponible (${stageNames || "sin etapas configuradas"}); si no hay una etapa adecuada, responde sin inventar una.`]
      : []),
  ];

  const languageLine = (() => {
    switch (profile.responseLanguage) {
      case "en":
        return "You are ALWAYS responding in English, with short natural chat messages.";
      case "pt":
        return "Você responde SEMPRE em português, com mensagens curtas e naturais para chat.";
      case "fr":
        return "Vous répondez TOUJOURS en français, avec des messages courts et naturels pour le chat.";
      case "auto":
      default:
        return profile.fallbackLanguage === "en"
          ? "Respond in the customer's language; if unsure, respond in English. Keep messages short and natural for chat."
          : profile.fallbackLanguage === "pt"
            ? "Responda no idioma do cliente; se não tiver certeza, responda em português. Mensagens curtas e naturais."
            : profile.fallbackLanguage === "fr"
              ? "Répondez dans la langue du client ; en cas de doute, répondez en français. Messages courts et naturels."
              : "Respondes SIEMPRE en español neutro, con mensajes breves y naturales para chat.";
    }
  })();

  const businessLines = [
    profile.businessIndustry ? `Industria del negocio: ${profile.businessIndustry}` : null,
    profile.businessLocation ? `Ubicación del negocio: ${profile.businessLocation}` : null,
    profile.businessDescription ? `Descripción del negocio:\n${profile.businessDescription}` : null,
  ].filter(Boolean);

  return [
    `Eres "${profile.name}", el asistente de WhatsApp de este negocio. ${languageLine}`,
    ...businessLines,
    profile.tone ? `Tono: ${profile.tone}` : null,
    profile.instructions ? `Instrucciones del negocio:\n${profile.instructions}` : null,
    profile.escalationRules
      ? `Reglas de escalado a humano:\n${profile.escalationRules}`
      : null,
    profile.greeting ? `Saludo sugerido para conversaciones nuevas: ${profile.greeting}` : null,
    rules.strictKnowledgeBase
      ? `CONOCIMIENTO DEL NEGOCIO (tu única fuente de verdad; si algo no está aquí, NO lo inventes — di que lo confirmarás con el equipo o escala):\n${renderKb(input.kb)}`
      : `CONOCIMIENTO DEL NEGOCIO (información de referencia):\n${renderKb(input.kb)}`,
    rules.captureLeadData
      ? `CAMPOS DISPONIBLES EN LA FICHA DEL CONTACTO (usa exactamente estas claves): ${fichaFieldList}`
      : null,
    input.catalog.length > 0
      ? `CATÁLOGO DE PRODUCTOS (precios ya expresados en pesos; "Inventario: consultar" = sin control de stock):\n${renderCatalog(input.catalog, CATALOG_PROMPT_LIMIT, rules.sendProductQuotes)}`
      : null,
    `Etapas del pipeline disponibles: ${stageNames}`,
    [...actionLines, ...(configuredRules.length ? ["Reglas configuradas:", ...configuredRules] : []), ...agendaRules, "JSON puro, sin markdown ni texto adicional."].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Prompt del juez del Laboratorio: UNA llamada por conversación (FR-032). */
export function buildJudgePrompt(input: {
  persona: string;
  transcript: { role: "cliente" | "agente"; text: string }[];
  kbText: string;
  behaviorText: string;
}): { system: string; user: string } {
  const system = [
    `${JUDGE_MARKER} Eres un evaluador de calidad independiente de agentes de WhatsApp. Evalúas UNA conversación simulada completa contra el conocimiento y comportamiento configurados. Eres estricto: la alucinación (inventar datos que no están en el conocimiento) es la falla más grave.`,
    "Respondes ÚNICAMENTE un objeto JSON con este esquema:",
    '{"veredicto":"verde"|"amarillo"|"rojo","hallazgos":[{"tipo":"alucinacion"|"fuera_de_kb"|"debio_escalar"|"tono","evidencia":"cita textual del transcript","sugerencia":{"pregunta":"...","respuesta":"..."}}]}',
    "- verde: sin problemas relevantes. amarillo: mejorable. rojo: falla grave.",
    "- `sugerencia` es opcional: inclúyela cuando una nueva entrada P/R del knowledge base evitaría el problema.",
    "- Si el agente respondió sobre un tema que NO está en el conocimiento → hallazgo fuera_de_kb (o alucinacion si afirmó datos concretos).",
    "- Si el cliente pidió un humano y no hubo escalado → debio_escalar.",
  ].join("\n");

  const transcript = input.transcript
    .map((t) => `${t.role === "cliente" ? "CLIENTE" : "AGENTE"}: ${t.text}`)
    .join("\n");

  const user = [
    `PERSONA SIMULADA: ${input.persona}`,
    `COMPORTAMIENTO CONFIGURADO:\n${input.behaviorText || "(sin configurar)"}`,
    `CONOCIMIENTO CONFIGURADO:\n${input.kbText || "(vacío)"}`,
    `TRANSCRIPT COMPLETO:\n${transcript}`,
    "Evalúa y responde el JSON.",
  ].join("\n\n");

  return { system, user };
}
