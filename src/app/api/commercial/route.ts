import { apiError, withAuth } from "@/lib/api";
import { queryCommercial } from "@/server/commercial/query";

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
  return Response.json(data);
});
