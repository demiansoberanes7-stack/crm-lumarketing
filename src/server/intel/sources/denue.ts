import { normalizeText } from "@/server/intel/stats";

/**
 * Conector DENUE (INEGI): directorio público de unidades económicas de
 * México. Token gratis por email.
 *
 * Documentación oficial: https://www.inegi.org.mx/servicios/api_denue.html
 * Método `BuscarEntidad`:
 *   GET /app/api/denue/v1/consulta/BuscarEntidad/{condicion}/{entidad}/{ini}/{fin}/{token}
 *   - condicion: palabras a buscar (todas las entidades = entidad "00")
 *   - registro inicial/final: ventana paginada; NO devuelve total.
 *
 * El conteo se reporta como proxy de competencia y con censo honesto: si la
 * ventana de 10 viene llena, el número que se muestra es "≥10" (no se inventa
 * un total que la API no entrega).
 */

const DENUE_BASE = "https://www.inegi.org.mx/app/api/denue/v1/consulta";

export type DenueCount = {
  /** Establecimientos coincidentes (censurado a 10 cuando la ventana llena). */
  count: number;
  /** true = la ventana devolvió 10 registros: el total real es ≥10. */
  censored: boolean;
};

/** Resultado de la prueba: ok con conteo, o fallo con el motivo real de INEGI. */
export type DenueResult =
  | (DenueCount & { ok: true })
  | { ok: false; reason: string };

/**
 * Resuelve el texto crudo de INEGI en un mensaje accionable. La API devuelve
 * 200 incluso con token inválido, en texto plano y sin estructura JSON.
 */
function denueFailure(status: number, raw: string, timedOut = false): DenueResult {
  if (timedOut) {
    return { ok: false, reason: "DENUE no respondió a tiempo (timeout de 15 s)." };
  }
  const lower = raw.toLowerCase();
  if (lower.includes("no autorizado") || lower.includes("clave")) {
    return {
      ok: false,
      reason:
        "DENUE rechazó el token: «No autorizado. Utilice una clave válida». Verifica que sea el token de 32 caracteres de tu cuenta INEGI.",
    };
  }
  if (status >= 500) {
    return { ok: false, reason: `DENUE (INEGI) respondió error ${status}. Intenta más tarde.` };
  }
  if (status !== 200) {
    return { ok: false, reason: `DENUE respondió ${status}.` };
  }
  return {
    ok: false,
    reason: `DENUE respondió algo inesperado: ${raw.slice(0, 160)}`,
  };
}

export async function queryEstablishments(
  token: string,
  keywords: string[],
  entidad = "00"
): Promise<DenueResult> {
  const condicion = keywords
    .map((k) => normalizeText(k).trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  if (!condicion) return { ok: false, reason: "Falta la palabra clave a buscar." };
  const url = `${DENUE_BASE}/BuscarEntidad/${encodeURIComponent(condicion)}/${entidad}/1/10/${encodeURIComponent(token)}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return denueFailure(0, "", true);
  }
  const raw = (await response.text().catch(() => "")) as string;
  if (!response.ok) return denueFailure(response.status, raw);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // 200 con cuerpo no-JSON = casi siempre el texto "No autorizado…".
    return denueFailure(response.status, raw);
  }
  if (!Array.isArray(payload)) return denueFailure(response.status, raw);
  return { ok: true, count: payload.length, censored: payload.length >= 10 };
}

/** API legacy que solo necesita el conteo (null si falla). */
export async function countEstablishments(
  token: string,
  keywords: string[],
  entidad = "00"
): Promise<DenueCount | null> {
  const result = await queryEstablishments(token, keywords, entidad);
  if (!result.ok) return null;
  return { count: result.count, censored: result.censored };
}
