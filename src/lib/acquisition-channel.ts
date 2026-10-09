/**
 * Catálogo de canales de adquisición.
 *
 * Eje distinto al de `source`/`medium` (`contact-medium.ts`): aquí se
 * normaliza POR QUÉ canal entró un prospecto para poder atribuir ventas y
 * calcular rentabilidad por canal. Cubre lo orgánico, lo pagado, lo directo,
 * el marketplace y lo recurrente; "desconocido" existe a propósito para no
 * inventar un origen cuando no hay datos.
 *
 * `kind` agrupa los canales para métricas agregadas:
 *   organic | paid | direct | marketplace | referral | recurring | other | unknown
 */

export const CHANNEL_KINDS = [
  "organic",
  "paid",
  "direct",
  "marketplace",
  "referral",
  "recurring",
  "other",
  "unknown",
] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  organic: "Orgánico",
  paid: "Pagado",
  direct: "Directo",
  marketplace: "Marketplace",
  referral: "Referido",
  recurring: "Recurrente",
  other: "Otro",
  unknown: "Desconocido",
};

type ChannelSeed = { key: string; name: string; kind: ChannelKind };

/** Los 16 canales del catálogo semilla, en el orden en que se presentan. */
export const ACQUISITION_CHANNELS: readonly ChannelSeed[] = [
  { key: "instagram_organico", name: "Instagram orgánico", kind: "organic" },
  { key: "facebook_organico", name: "Facebook orgánico", kind: "organic" },
  { key: "tiktok_organico", name: "TikTok orgánico", kind: "organic" },
  { key: "otras_redes_organicas", name: "Otras redes orgánicas", kind: "organic" },
  { key: "meta_ads", name: "Meta Ads", kind: "paid" },
  { key: "google_ads", name: "Google Ads", kind: "paid" },
  { key: "sitio_web", name: "Sitio web", kind: "direct" },
  { key: "catalogo_digital", name: "Catálogo digital", kind: "direct" },
  { key: "mercado_libre", name: "Mercado Libre", kind: "marketplace" },
  { key: "whatsapp_directo", name: "WhatsApp directo", kind: "direct" },
  { key: "llamadas", name: "Llamadas", kind: "direct" },
  { key: "correo_electronico", name: "Correo electrónico", kind: "direct" },
  { key: "visitas_presenciales", name: "Visitas presenciales", kind: "direct" },
  { key: "referidos", name: "Referidos", kind: "referral" },
  { key: "clientes_recurrentes", name: "Clientes recurrentes", kind: "recurring" },
  { key: "otros", name: "Otros", kind: "other" },
] as const;

/** Canal reservado para contactos sin origen conocido. */
export const UNKNOWN_CHANNEL: ChannelSeed = {
  key: "desconocido",
  name: "Desconocido",
  kind: "unknown",
};

export function channelKindLabel(kind: string | null | undefined): string | null {
  return typeof kind === "string" && (CHANNEL_KINDS as readonly string[]).includes(kind)
    ? CHANNEL_KIND_LABELS[kind as ChannelKind]
    : null;
}
