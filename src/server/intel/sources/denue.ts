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

export async function countEstablishments(
  token: string,
  keywords: string[],
  entidad = "00"
): Promise<DenueCount | null> {
  const condicion = keywords
    .map((k) => normalizeText(k).trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  if (!condicion) return null;
  const url = `${DENUE_BASE}/BuscarEntidad/${encodeURIComponent(condicion)}/${entidad}/1/10/${encodeURIComponent(token)}`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) return null;
  return { count: payload.length, censored: payload.length >= 10 };
}
