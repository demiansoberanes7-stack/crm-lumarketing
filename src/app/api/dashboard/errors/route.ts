import { withAuth } from "@/lib/api";
import { queryErrorDetails } from "@/server/dashboard/errors";

export const dynamic = "force-dynamic";

/**
 * Detalle de "Infraestructura · Calidad": a QUIÉN le falló cada mensaje y
 * QUÉ evento de Conversions API falló (más webhooks y automatizaciones).
 * Los contadores viven en /api/dashboard; esto solo expande el detalle.
 */
export const GET = withAuth(async (session) => {
  const details = await queryErrorDetails(session.organizationId);
  return Response.json(details);
});
