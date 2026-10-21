import { z } from "zod";

/**
 * Acción tipada del agente: exactamente UNA por turno (FR-021).
 * El servidor valida cada acción contra sus allowlists (etapas de la org);
 * lo que no valida se degrada, nunca se ejecuta a ciegas.
 */
const baseActions = [
  z.object({ action: z.literal("none") }),
  z.object({ action: z.literal("reply"), text: z.string().min(1) }),
  z.object({
    action: z.literal("update_lead"),
    note: z.string().min(1),
    ficha: z.record(z.unknown()).optional(),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("move_stage"),
    stage: z.string().min(1),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("handoff"),
    reason: z.string().optional(),
    farewell: z.string().optional(),
  }),
  z.object({
    action: z.literal("send_quote"),
    /**
     * Una ficha o varias. `item_id` sigue siendo válido porque el modelo ya lo
     * usa y el historial del Laboratorio está lleno de esa forma; `item_ids`
     * existe para el turno en que el cliente pregunta por varios productos de
     * una vez. Sin ella, el agente solo podía mandar UNA ficha por turno y el
     * resto de la pregunta quedaba sin respuesta.
     */
    item_id: z.string().min(1).optional(),
    item_ids: z.array(z.string().min(1)).min(1).max(5).optional(),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("search_inventory"),
    query: z.string().min(1).max(100),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("create_quote"),
    item_id: z.string().min(1).optional(),
    quantity: z.number().int().positive().max(100).optional(),
    items: z
      .array(
        z.object({
          item_id: z.string().min(1),
          quantity: z.number().int().positive().max(100).optional(),
        })
      )
      .min(1)
      .max(10)
      .optional(),
    /**
     * `false` solo cuando el cliente lo pidió con palabras («sin IVA»,
     * «sin impuestos»). Se exige el valor explícito porque el default del
     * cotizador es 16% y bajarlo por iniciativa del modelo sería inventar.
     */
    iva: z.boolean().optional(),
    reply: z.string().optional(),
  }),
] as const;

/**
 * 015 — Las dos acciones de agenda. Solo se registran si esta instancia tiene
 * la bandera encendida: donde no hay agenda, el modelo ni siquiera puede
 * nombrarlas.
 *
 * `reply` es una introducción opcional, NO la lista de horarios: los horarios
 * los pega el motor con las etiquetas reales. Y `startUtc` tiene que ser
 * exactamente uno de los que el sistema ofreció — si no, el motor lo rechaza y
 * se re-ofrece.
 */
const agendaActions = [
  z.object({
    action: z.literal("offer_slots"),
    reply: z.string().optional(),
  }),
  z.object({
    action: z.literal("book_slot"),
    startUtc: z.string().min(1),
    reply: z.string().optional(),
  }),
] as const;

export const AgentAction = z.discriminatedUnion("action", [
  ...baseActions,
  ...agendaActions,
]);

/** El esquema que se le exige al modelo en ESTE turno. */
export function agentActionSchema(agenda: boolean) {
  return agenda
    ? AgentAction
    : z.discriminatedUnion("action", [...baseActions]);
}

export type AgentActionType = z.infer<typeof AgentAction>;

/**
 * Resuelve el nombre de etapa devuelto por el modelo contra las etapas reales
 * de la organización (exacto → lower-case). Sin match: degradar a reply/none.
 */
export function resolveStage(
  requested: string,
  stages: { id: string; name: string }[]
): { id: string; name: string } | null {
  const exact = stages.find((s) => s.name === requested.trim());
  if (exact) return exact;
  const lower = requested.trim().toLowerCase();
  return stages.find((s) => s.name.toLowerCase() === lower) ?? null;
}

/** Degrada una acción que no se pudo ejecutar (FR-021 / contrato ai.md). */
export function degradeAction(action: AgentActionType): AgentActionType {
  if (
    action.action === "move_stage" ||
    action.action === "create_quote" ||
    action.action === "search_inventory" ||
    action.action === "offer_slots" ||
    action.action === "book_slot"
  ) {
    return action.reply
      ? { action: "reply", text: action.reply }
      : { action: "none" };
  }
  return action;
}
