export type AgentFichaField = { key: string; label: string };

export const DEFAULT_AGENT_FICHA_FIELDS: AgentFichaField[] = [
  { key: "interes", label: "Interés" },
  { key: "presupuesto", label: "Presupuesto" },
  { key: "ubicacion", label: "Ubicación" },
  { key: "plazo", label: "Plazo" },
  { key: "preferencias", label: "Preferencias" },
];

export const DEFAULT_AGENT_RULES = {
  captureLeadData: true,
  sendProductQuotes: true,
  handoffOnRequest: true,
  moveStageOnIntent: true,
  strictKnowledgeBase: true,
};

export type AgentRules = typeof DEFAULT_AGENT_RULES;
export type AgentRuleKey = keyof AgentRules;

export const AGENT_RULE_OPTIONS: {
  key: AgentRuleKey;
  title: string;
  description: string;
}[] = [
  {
    key: "captureLeadData",
    title: "Guardar datos del cliente en su ficha",
    description: "Al detectar información explícita, guardar los datos en los campos configurados y resumir el contexto en una nota.",
  },
  {
    key: "sendProductQuotes",
    title: "Enviar fichas o cotizaciones del catálogo",
    description: "Cuando pregunten por un producto o servicio, enviar la ficha oficial del catálogo.",
  },
  {
    key: "handoffOnRequest",
    title: "Escalar cuando el cliente pida una persona",
    description: "Transferir la conversación a atención humana si el cliente pide hablar con un asesor.",
  },
  {
    key: "moveStageOnIntent",
    title: "Mover la etapa ante intención de compra",
    description: "Aplicar las palabras clave configuradas y mover el lead cuando exprese intención clara de compra.",
  },
  {
    key: "strictKnowledgeBase",
    title: "Responder solo con información del negocio",
    description: "Si la respuesta no está en el conocimiento o catálogo configurado, reconocerlo en lugar de inventar datos.",
  },
];

export const AGENT_FICHA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export function fichaFieldKeyFromLabel(label: string): string {
  const key = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return AGENT_FICHA_KEY_PATTERN.test(key) ? key : "campo_nuevo";
}

export function normalizeAgentRules(value: unknown): AgentRules {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    captureLeadData: typeof record.captureLeadData === "boolean" ? record.captureLeadData : DEFAULT_AGENT_RULES.captureLeadData,
    sendProductQuotes: typeof record.sendProductQuotes === "boolean" ? record.sendProductQuotes : DEFAULT_AGENT_RULES.sendProductQuotes,
    handoffOnRequest: typeof record.handoffOnRequest === "boolean" ? record.handoffOnRequest : DEFAULT_AGENT_RULES.handoffOnRequest,
    moveStageOnIntent: typeof record.moveStageOnIntent === "boolean" ? record.moveStageOnIntent : DEFAULT_AGENT_RULES.moveStageOnIntent,
    strictKnowledgeBase: typeof record.strictKnowledgeBase === "boolean" ? record.strictKnowledgeBase : DEFAULT_AGENT_RULES.strictKnowledgeBase,
  };
}

export function normalizeAgentFichaFields(value: unknown): AgentFichaField[] {
  if (!Array.isArray(value)) return DEFAULT_AGENT_FICHA_FIELDS;
  const fields = value
    .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === "object" && !Array.isArray(field))
    .map((field) => ({
      key: typeof field.key === "string" ? field.key.trim() : "",
      label: typeof field.label === "string" ? field.label.trim() : "",
    }))
    .filter((field) => AGENT_FICHA_KEY_PATTERN.test(field.key) && field.label.length > 0)
    .slice(0, 12);

  if (fields.length === 0) return DEFAULT_AGENT_FICHA_FIELDS;
  const keys = new Set<string>();
  for (const field of fields) {
    if (keys.has(field.key)) return DEFAULT_AGENT_FICHA_FIELDS;
    keys.add(field.key);
  }
  return fields;
}

export function filterAgentFichaToConfiguredFields(
  ficha: Record<string, unknown>,
  configuredFields: unknown
): Record<string, unknown> {
  const allowedKeys = new Set(normalizeAgentFichaFields(configuredFields).map((field) => field.key));
  return Object.fromEntries(Object.entries(ficha).filter(([key]) => allowedKeys.has(key)));
}
