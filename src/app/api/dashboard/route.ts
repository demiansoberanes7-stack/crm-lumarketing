import { apiError, withAuth } from "@/lib/api";
import { queryDashboard } from "@/server/dashboard/query";

export const dynamic = "force-dynamic";
export const GET = withAuth(async (session, req: Request) => {
  const period = new URL(req.url).searchParams.get("period") ?? "30d";
  if (!["7d", "30d", "90d", "1y"].includes(period)) return apiError(422, "invalid_period", "Período inválido");
  const data = await queryDashboard(session.organizationId, period);
  return Response.json(data);
});
