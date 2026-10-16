import { withAuth } from "@/lib/api";
import { listServiceOrders } from "@/server/service-orders/service";

export const dynamic = "force-dynamic";

/** GET — órdenes de servicio de la organización (opcionalmente de un proyecto). */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const orders = await listServiceOrders(session.organizationId, { projectId, status });
  return Response.json({ orders });
});
