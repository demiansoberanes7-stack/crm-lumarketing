/**
 * Bandera del módulo de reseñas de Google Business Profile.
 *
 * Mismo patrón que AGENDA/ATRIBUCION (ADR-001/002): el código viaja siempre en
 * main y lo que decide si EXISTE para el usuario es una variable de despliegue.
 * Apagado por defecto: sin `GOOGLE_BUSINESS=on`, la superficie responde 404,
 * la pestaña no aparece y el poller no barre. La migración se aplica igual —
 * tablas vacías son inertes.
 */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseGoogleBusinessFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function googleBusinessEnabled(): boolean {
  return parseGoogleBusinessFlag(process.env.GOOGLE_BUSINESS);
}

/** Superficie apagada = 404 (no 403): no hay nada que revelar. */
export function googleBusinessDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
