/**
 * Bandera del módulo de inteligencia de mercado (INTEL).
 *
 * Mismo criterio que AGENDA/GOOGLE_BUSINESS (ADR-001, módulos 015/016): el
 * código viaja siempre en main y lo que decide si EXISTE para el usuario es
 * una variable de despliegue. Sin la bandera, toda la superficie
 * (/inteligencia, /api/intel/*, la tarjeta de Conexiones) responde 404 y no
 * se le piden credenciales a nadie. La migración se aplica igual: tablas
 * vacías son inertes.
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseIntelFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/** Se lee de `process.env` directo, igual que `agendaEnabled()`. */
export function intelEnabled(): boolean {
  return parseIntelFlag(process.env.INTEL);
}

/**
 * Bandera de Google Trends (ADR-001, dentro de INTEL). Si está apagada, la
 * fuente GT se ignora y el módulo usa el fallback YouTube sin avisar al
 * usuario (degradación elegante). La ingesta GT simplemente no corre.
 */
export function gtEnabled(): boolean {
  return parseIntelFlag(process.env.INTEL_GT);
}

/**
 * Respuesta para superficie apagada. 404 y no 403 a propósito: si el módulo
 * no está encendido, ese endpoint no existe en esta instancia.
 */
export function intelDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
