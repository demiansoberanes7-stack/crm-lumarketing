/**
 * 014 — El canal, en un solo lugar y sin dependencias de servidor.
 *
 * Vive en `lib/` y no en `server/` porque la interfaz también necesita saber
 * qué canales existen y cómo se llaman. Antes el tipo estaba declarado dos
 * veces (en `server/inbox/identity.ts` y otra vez a mano dentro del DTO de
 * `lib/types.ts`): agregar un canal obligaba a acordarse de los dos sitios, y
 * olvidarse de uno no rompía la compilación — solo dejaba una pantalla
 * mintiendo.
 */

export type Channel =
  | "whatsapp"
  | "instagram"
  | "messenger"
  | "tiktok"
  /**
   * Reseñas de Google Business Profile: cada reseña es un hilo en la Bandeja
   * y la respuesta del operador se publica como reply público del negocio.
   * Detrás de la bandera GOOGLE_BUSINESS.
   */
  | "google_business"
  /**
   * Comentarios públicos de publicaciones (Instagram / Facebook / TikTok).
   * Cada autor sobre un post forma su propia hebra; la respuesta del operador
   * se publica como reply al comentario. Meta usa poller; TikTok usa Zernio,
   * webhook en tiempo real y poller de respaldo. Detrás de CHANNELS.
   */
  | "comments"
  /**
   * Mensajes post-venta de Mercado Libre (packs/órdenes). Poller propio contra
   * la Messaging API oficial; cada comprador es un contacto y cada pack un hilo
   * en la Bandeja. Detrás de CHANNELS.
   */
  | "mercado_libre";

/**
 * Orden en que los canales se presentan al operador. WhatsApp primero: es el
 * canal que toda instancia tiene encendido.
 */
export const CHANNEL_ORDER: readonly Channel[] = [
  "whatsapp",
  "instagram",
  "messenger",
  "tiktok",
  "google_business",
  "comments",
  "mercado_libre",
];

/** Nombre visible del canal, para la interfaz y para los errores del operador. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  // 017: los mensajes de la página de Facebook. "Messenger" y no "Facebook"
  // porque es lo que el cliente ve en su teléfono cuando escribe.
  messenger: "Messenger",
  tiktok: "TikTok",
  google_business: "Google Business",
  comments: "Comentarios",
  mercado_libre: "Mercado Libre",
};

export function isChannel(value: string): value is Channel {
  return (CHANNEL_ORDER as readonly string[]).includes(value);
}
