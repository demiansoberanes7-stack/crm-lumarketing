import { apiError, withAuth } from "@/lib/api";
import { queryOps } from "@/server/dashboard/ops";

export const dynamic = "force-dynamic";

/**
 * Panel de operaciones del Inicio: serie diaria IA vs manual, estado del
 * agente, cola de tareas programadas y actividad reciente. Separado de
 * `/api/dashboard` porque esa consulta es una CTE única y cacheada por
 * período; esta se refresca con el mismo periodo pero con otro TTL.
 */
export const GET = withAuth(async (session, req: Request) => {
  const period = new URL(req.url).searchParams.get("period") ?? "30d";
  if (!["7d", "30d", "90d", "1y"].includes(period)) {
    return apiError(422, "invalid_period", "Período inválido");
  }
  const data = await queryOps(session.organizationId, period);
  return Response.json(data);
});
