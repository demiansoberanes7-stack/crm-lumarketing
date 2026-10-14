/**
 * Sugerencias de Google (autocompletado público, sin API key).
 *
 * Endpoint público `suggestqueries.google.com` que alimenta el
 * autocompletado de Google/YouTube. Es UNPROBADO (no es una API oficial):
 * por eso es degradación obligatoria — si falla o cambia, el módulo sigue
 * funcionando sin palabras relacionadas (camino sin dependencia externa,
 * regla de soberanía). Se cachea por sesión en memoria.
 *
 * Ref: mismo endpoint que usa el buscador público de Google.
 */

const SUGGEST_URL = "https://suggestqueries.google.com/complete/search";

const cache = new Map<string, { at: number; items: string[] }>();
const TTL_MS = 10 * 60 * 1000;

function cacheKey(q: string, yt: boolean): string {
  return `${yt ? "yt" : "web"}:${q}`;
}

async function suggestOnce(q: string, yt: boolean): Promise<string[]> {
  const params = new URLSearchParams({
    client: "firefox",
    q,
    hl: "es",
    gl: "mx",
  });
  if (yt) params.set("ds", "yt");
  let response: Response;
  try {
    response = await fetch(`${SUGGEST_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json" },
    });
  } catch {
    return [];
  }
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as unknown;
  // Formato: [consulta, [sugerencia, sugerencia, …]]
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];
  return (payload[1] as unknown[]).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
}

/**
 * Sugiere términos relacionados. `yt=true` restringe al dominio de YouTube.
 * Nunca lanza: cualquier fallo devuelve lista vacía (sin datos > error).
 */
export async function fetchSuggestions(q: string, yt = false): Promise<string[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const key = cacheKey(query, yt);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  const items = await suggestOnce(query, yt);
  if (items.length > 0) cache.set(key, { at: Date.now(), items });
  return items;
}
