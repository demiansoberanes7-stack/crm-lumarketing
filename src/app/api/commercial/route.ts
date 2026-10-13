import { apiError, withAuth } from "@/lib/api";
import { queryCommercial } from "@/server/commercial/query";
import { getIntegration } from "@/server/integrations";
import { parseGa4Credentials, readGa4Metrics } from "@/server/analytics/ga4";
import { available, unavailable, type MetricValue } from "@/server/metrics/compute";

export const dynamic = "force-dynamic";

/**
 * Plataforma de control comercial: agrega las 10 categorías (resumen, ventas,
 * embudo, publicidad, tráfico, adquisición, rentabilidad, experimentos,
 * operaciones, calidad) desde datos reales del CRM y las tablas nuevas.
 * Cada métrica viaja con su disponibilidad; "no disponible" jamás es 0.
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "30d";
  if (!["7d", "30d", "90d", "1y"].includes(period)) {
    return apiError(422, "invalid_period", "Período inválido");
  }
  const channelId = url.searchParams.get("channelId")?.trim() || null;
  const campaignId = url.searchParams.get("campaignId")?.trim() || null;
  const service = url.searchParams.get("service")?.trim() || null;

  const data = await queryCommercial(session.organizationId, {
    period,
    channelId,
    campaignId,
    service,
  });

  // Sesión→prospecto necesita GA4 (sesiones) + el CRM (nuevos prospectos).
  // Se resuelve aquí, donde ya están ambas capas; el fallo de GA4 jamás
  // bloquea el resto de la plataforma comercial. El objeto del query es
  // readonly (as const), así que se reconstruye en vez de mutarse.
  const newLeads =
    data.resumen.newLeads.availability === "available" ? (data.resumen.newLeads.value ?? 0) : 0;
  let trafico: Record<string, MetricValue> = { ...data.trafico };
  try {
    const ga4Integration = await getIntegration(session.organizationId, "ga4");
    const ga4Parsed = parseGa4Credentials(ga4Integration?.credentials ?? {});
    if (ga4Parsed && newLeads > 0) {
      const ga4 = await readGa4Metrics(ga4Parsed, period);
      trafico = {
        ...trafico,
        sessions: available(ga4.sessions),
        sessionToLead: ga4.sessions > 0 ? available((newLeads / ga4.sessions) * 100) : unavailable("no_data"),
      };
    } else if (ga4Parsed) {
      trafico = { ...trafico, sessions: available(0) };
    }
  } catch {
    trafico = { ...trafico, sessionToLead: unavailable("pending") };
  }

  return Response.json({ ...data, trafico });
});
