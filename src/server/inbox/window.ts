/**
 * Ventana base de servicio de 24 horas (WhatsApp, Instagram y Messenger).
 * Los canales con otra duración declaran su ventana en capabilities.ts.
 * Una conversación sin entrantes (p. ej. creada a mano) tiene la ventana cerrada.
 */

export const WINDOW_MS = 24 * 60 * 60 * 1000;
/** TikTok permite responder durante 48 h (hasta 10 mensajes), sin etiqueta. */
export const TIKTOK_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Los canales con `outsideWindow: "human_agent_tag"` (Instagram y Messenger)
 * aceptan respuesta de agente humano OUTSIDE las 24 h mientras dure
 * el periodo que Meta otorga con la etiqueta HUMAN_AGENT: 7 días desde el
 * último entrante. Pasado eso, la ventana está realmente cerrada.
 */
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  return isWindowOpenFor(lastInboundAt, WINDOW_MS, now);
}

/** Ventana normal de un canal cuando su duración no es la predeterminada de 24 h. */
export function isWindowOpenFor(
  lastInboundAt: Date | null,
  windowMs: number,
  now: Date = new Date()
): boolean {
  if (!lastInboundAt) return false;
  const age = now.getTime() - lastInboundAt.getTime();
  return age >= 0 && age < windowMs;
}

/** ¿Estamos dentro del periodo de respuesta con etiqueta HUMAN_AGENT (7 días)? */
export function isHumanAgentWindowOpen(
  lastInboundAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!lastInboundAt) return false;
  const age = now.getTime() - lastInboundAt.getTime();
  return age >= 0 && age < HUMAN_AGENT_WINDOW_MS;
}

/** Milisegundos restantes de ventana (0 si está cerrada). */
export function windowRemainingMs(
  lastInboundAt: Date | null,
  now: Date = new Date()
): number {
  return windowRemainingMsFor(lastInboundAt, WINDOW_MS, now);
}

export function windowRemainingMsFor(
  lastInboundAt: Date | null,
  windowMs: number,
  now: Date = new Date()
): number {
  if (!lastInboundAt) return 0;
  const age = now.getTime() - lastInboundAt.getTime();
  if (age < 0) return 0;
  const remaining = windowMs - age;
  return Math.max(0, remaining);
}
