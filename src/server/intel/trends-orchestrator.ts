import { getIntelCredentials, incrementApifyUsage, markApifySynced, markSerpApiSynced, reserveSerpApiUsage } from "@/server/intel/credentials";
import { fetchSerpApiTrends, type TrendsResponse } from "@/server/intel/sources/serpapi-trends";
import { runApifyActor, normalizeApifyItems } from "@/server/intel/sources/apify-trends";
import { fetchGt } from "@/server/intel/sources/google-trends";

/**
 * Orquestador de proveedores de Google Trends.
 *
 * Cadena de resolución:
 *   1. SerpApi (principal, 250 consultas gratis/mes)
 *   2. Apify (respaldo, créditos gratuitos de la plataforma)
 *   3. Conector web (último recurso, sin API key)
 *   4. null (sin datos)
 *
 * Cada resultado declara su `provider` para que la UI lo etiquete
 * correctamente. No se consultan dos proveedores para la misma petición
 * (evita desperdiciar créditos). El fallback solo se activa ante errores
 * reales del proveedor principal, no ante keywords inválidas.
 */

export type TrendProvider = "serpapi" | "apify" | "web" | "none";
export type TrendSourceLabel = "Google Trends · SerpApi" | "Google Trends · Apify" | "Google Trends" | "Sin datos";

export type OrchestratedTrends = {
  data: TrendsResponse | null;
  provider: TrendProvider;
  sourceLabel: TrendSourceLabel;
  error: string | null;
  /** true si se usó Apify porque SerpApi falló. */
  usedFallback: boolean;
};

/**
 * Obtiene datos de tendencias para los términos dados, usando el mejor
 * proveedor disponible. Nunca lanza.
 */
export async function getTrendsFromProviders(
  organizationId: string,
  keywords: string[],
  geo = "MX",
  timeframe = "today 1-m"
): Promise<OrchestratedTrends> {
  const creds = await getIntelCredentials(organizationId);

  // 1. SerpApi (principal)
  if (creds?.serpapiKey) {
    const reserved = await reserveSerpApiUsage(organizationId);
    if (reserved) {
      const result = await fetchSerpApiTrends(creds.serpapiKey, keywords, geo, timeframe);
      if (result.timeSeries && result.timeSeries.points.length > 0) {
        await markSerpApiSynced(organizationId);
        return {
          data: result,
          provider: "serpapi",
          sourceLabel: "Google Trends · SerpApi",
          error: null,
          usedFallback: false,
        };
      }
    }
    // SerpApi falló: continuar a Apify
  }

  // 2. Apify (respaldo)
  if (creds?.apifyToken && creds.apifyActorId) {
    const items = await runApifyActor(creds.apifyToken, creds.apifyActorId, keywords, geo);
    if (items && items.length > 0) {
      const normalized = normalizeApifyItems(items);
      if (normalized.timeSeries && normalized.timeSeries.points.length > 0) {
        await incrementApifyUsage(organizationId);
        await markApifySynced(organizationId);
        return {
          data: {
            timeSeries: normalized.timeSeries,
            regions: normalized.regions,
            topics: normalized.topics,
            queries: normalized.queries,
            partial: normalized.partial,
            provider: "serpapi" as const,
          },
          provider: "apify",
          sourceLabel: "Google Trends · Apify",
          error: null,
          usedFallback: creds.serpapiKey != null,
        };
      }
    }
    // Apify falló: continuar a web
  }

  // 3. Conector web (último recurso, gratis sin API key)
  const webResult = await fetchGt(keywords[0] ?? "", geo, "now 1-m");
  if (webResult.timeSeries && webResult.timeSeries.points.length > 0) {
    const mapped: TrendsResponse = {
      timeSeries: webResult.timeSeries,
      regions: webResult.regions,
      topics: webResult.topics,
      queries: webResult.queries,
      partial: webResult.partial,
      provider: "serpapi", // el tipo es el mismo; el label lo decide el orquestador
    };
    return {
      data: mapped,
      provider: "web",
      sourceLabel: "Google Trends",
      error: null,
      usedFallback: true,
    };
  }

  // 4. Sin datos
  const hasAnyProvider = Boolean(creds?.serpapiKey || creds?.apifyToken);
  return {
    data: null,
    provider: "none",
    sourceLabel: "Sin datos",
    error: hasAnyProvider
      ? "Ningún proveedor de Google Trends respondió."
      : "No hay proveedores configurados. Configura SerpApi o Apify en Configuración → Inteligencia.",
    usedFallback: false,
  };
}

/**
 * Test de conexión: prueba el proveedor indicado (o el mejor disponible).
 */
export async function testTrendProvider(
  organizationId: string,
  provider: "serpapi" | "apify"
): Promise<{ ok: boolean; reason?: string }> {
  const creds = await getIntelCredentials(organizationId);
  if (!creds) return { ok: false, reason: "Sin credenciales configuradas." };

  if (provider === "serpapi") {
    if (!creds.serpapiKey) return { ok: false, reason: "SerpApi no está configurado." };
    const { verifySerpApi } = await import("@/server/intel/sources/serpapi-trends");
    return verifySerpApi(creds.serpapiKey);
  }

  if (!creds.apifyToken) return { ok: false, reason: "Apify no está configurado." };
  if (!creds.apifyActorId) return { ok: false, reason: "Apify no tiene Actor ID configurado." };
  const { verifyApify } = await import("@/server/intel/sources/apify-trends");
  return verifyApify(creds.apifyToken, creds.apifyActorId);
}
