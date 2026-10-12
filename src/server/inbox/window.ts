/**
 * Ventana de servicio de 24 horas de WhatsApp: solo se puede enviar texto
 * libre dentro de las 24h siguientes al último mensaje ENTRANTE. Una
 * conversación sin entrantes (p. ej. creada a mano) tiene la
 * ventana cerrada.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Los canales con `outsideWindow: "human_agent_tag"` (Instagram, Messenger,
 * TikTok) aceptan respuesta de agente humano OUTSIDE las 24 h mientras dure
 * el periodo que Meta otorga con la etiqueta HUMAN_AGENT: 7 días desde el
 * último entrante. Pasado eso, la ventana está realmente cerrada.
 */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

/** ¿Estamos dentro del periodo de respuesta con etiqueta HUMAN_AGENT (7 días)? */
export function isHumanAgentWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < HUMAN_AGENT_WINDOW_MS;
}

/** Milisegundos restantes de ventana (0 si está cerrada). */
export function windowRemainingMs(
  lastInboundAt: Date | null,
  now: Date = new Date()
): number {
  if (!lastInboundAt) return 0;
  const remaining = WINDOW_MS - (now.getTime() - lastInboundAt.getTime());
  return Math.max(0, remaining);
}
