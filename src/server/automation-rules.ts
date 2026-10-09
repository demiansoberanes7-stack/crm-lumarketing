export type AutomationChannel = "whatsapp" | "messenger" | "instagram" | "tiktok" | "email";

/** Canales de mensajería (no correo) — coinciden con `Channel` de `lib/channels.ts`. */
export const AUTOMATION_MESSAGE_CHANNELS = ["whatsapp", "messenger", "instagram", "tiktok"] as const;

export function isAutomationChannel(value: unknown): value is AutomationChannel {
  return value === "whatsapp" || value === "messenger" || value === "instagram" || value === "tiktok" || value === "email";
}

/**
 * Qué evento dispara la regla.
 *
 * El `trigger` que se guarda es TEXTO de UI (lo escribe el preset y lo ve el
 * dueño); el worker necesita una clave con la que comparar. Las dos conviven:
 * `triggers` es lo canónico y `trigger` lo que se muestra, y el texto legacy
 * se traduce con `resolveAutomationTriggers` para que las reglas guardadas
 * antes de existir las claves sigan disparando.
 */
export const AUTOMATION_TRIGGERS = ["stage_change", "inactivity", "new_lead", "no_reply"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  stage_change: "El lead cambia de etapa",
  inactivity: "El contacto deja de escribir durante la espera",
  new_lead: "Entra un lead nuevo al pipeline",
  no_reply: "No responden tras un seguimiento",
};

export function isAutomationTrigger(value: unknown): value is AutomationTrigger {
  return typeof value === "string" && (AUTOMATION_TRIGGERS as readonly string[]).includes(value);
}

export interface AutomationRuleConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  delayHours?: number;
  messageText?: string;
  channel?: AutomationChannel;
  /** Texto mostrado en la tarjeta (legacy: era el único trigger que existía). */
  trigger?: string;
  /** Claves semánticas; manda sobre `trigger` cuando existen. */
  triggers?: AutomationTrigger[];
  /** Etapa destino de `stage_change`; vacío = cualquier etapa (salvo perdida). */
  stageId?: string;
}

const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Traduce el texto del preset a claves. Cubre exactamente las tres frases que
 * la UI pinta hoy (más su variante sin comillas) y cualquier combinación de
 * esas palabras: una regla cuyo texto no reconoce queda solo con el disparo
 * manual, que es el comportamiento de antes de este módulo.
 */
export function resolveAutomationTriggers(rule: {
  trigger?: string;
  triggers?: unknown;
}): AutomationTrigger[] {
  if (Array.isArray(rule.triggers)) {
    const keys = rule.triggers.filter(isAutomationTrigger);
    if (keys.length) return [...new Set(keys)];
  }

  const text = stripAccents(rule.trigger ?? "");
  if (!text) return [];
  const found: AutomationTrigger[] = [];
  if (text.includes("nuevo lead") || (text.includes("lead") && text.includes("pipeline"))) {
    found.push("new_lead");
  }
  if (text.includes("sin respuesta")) found.push("no_reply");
  if (text.includes("etapa")) found.push("stage_change");
  if (text.includes("inactiv") || text.includes("actividad")) found.push("inactivity");
  return [...new Set(found)];
}

function parseRule(id: string, record: Record<string, unknown>): AutomationRuleConfig {
  const rule: AutomationRuleConfig = { id };
  if (typeof record.name === "string") rule.name = record.name;
  if (typeof record.enabled === "boolean") rule.enabled = record.enabled;
  if (typeof record.delayHours === "number" && Number.isFinite(record.delayHours) && record.delayHours >= 0) {
    rule.delayHours = record.delayHours;
  }
  if (typeof record.messageText === "string") rule.messageText = record.messageText;
  if (isAutomationChannel(record.channel)) rule.channel = record.channel;
  if (typeof record.trigger === "string") rule.trigger = record.trigger;
  if (Array.isArray(record.triggers)) rule.triggers = record.triggers.filter(isAutomationTrigger);
  if (typeof record.stageId === "string" && record.stageId) rule.stageId = record.stageId;
  return rule;
}

/** Validate the persisted JSON shape before automation workers consume it. */
export function findAutomationRule(value: unknown, id: string): AutomationRuleConfig | null {
  if (!Array.isArray(value)) return null;

  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record.id !== id) continue;
    return parseRule(id, record);
  }

  return null;
}

/** Todas las reglas guardadas, ya normalizadas. */
export function listAutomationRules(value: unknown): AutomationRuleConfig[] {
  if (!Array.isArray(value)) return [];
  const rules: AutomationRuleConfig[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) continue;
    rules.push(parseRule(record.id, record));
  }
  return rules;
}
