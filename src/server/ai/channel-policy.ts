import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { CHANNEL_ORDER, isChannel, type Channel } from "@/lib/channels";

/**
 * `agent_profile.disabled_channels` es la lista NEGRA: los canales donde la
 * IA no responde. Vacía o ausente = todos encendidos, que es el default
 * histórico. Se guarda así, y no como lista blanca, para que un canal nuevo
 * nazca encendido sin migrar perfiles.
 */
export function normalizeDisabledChannels(value: unknown): Channel[] {
  if (!Array.isArray(value)) return [];
  const disabled = new Set<Channel>();
  for (const item of value) {
    if (typeof item === "string" && isChannel(item)) disabled.add(item);
  }
  return CHANNEL_ORDER.filter((channel) => disabled.has(channel));
}

export function isChannelAiDisabled(disabled: unknown, channel: string): boolean {
  return Array.isArray(disabled) && disabled.includes(channel);
}

export async function disabledChannelsFor(
  organizationId: string
): Promise<Channel[]> {
  const db = getDb();
  const rows = await db
    .select({ disabledChannels: schema.agentProfile.disabledChannels })
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  return normalizeDisabledChannels(rows[0]?.disabledChannels);
}

export async function isChannelAiDisabledFor(
  organizationId: string,
  channel: string
): Promise<boolean> {
  return isChannelAiDisabled(await disabledChannelsFor(organizationId), channel);
}
