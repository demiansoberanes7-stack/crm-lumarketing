export type AutomationChannel = "whatsapp" | "email";

export interface AutomationRuleConfig {
  id: string;
  name?: string;
  enabled?: boolean;
  delayHours?: number;
  messageText?: string;
  channel?: AutomationChannel;
}

/** Validate the persisted JSON shape before automation workers consume it. */
export function findAutomationRule(value: unknown, id: string): AutomationRuleConfig | null {
  if (!Array.isArray(value)) return null;

  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record.id !== id) continue;

    const rule: AutomationRuleConfig = { id };
    if (typeof record.name === "string") rule.name = record.name;
    if (typeof record.enabled === "boolean") rule.enabled = record.enabled;
    if (typeof record.delayHours === "number" && Number.isFinite(record.delayHours) && record.delayHours >= 0) {
      rule.delayHours = record.delayHours;
    }
    if (typeof record.messageText === "string") rule.messageText = record.messageText;
    if (record.channel === "whatsapp" || record.channel === "email") rule.channel = record.channel;
    return rule;
  }

  return null;
}
