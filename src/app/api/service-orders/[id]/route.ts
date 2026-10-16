import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { SERVICE_ORDER_STATUSES } from "@/lib/service-order";
import { getServiceOrder, updateServiceOrderStatus } from "@/server/service-orders/service";

export const dynamic = "force-dynamic";

/** GET — detalle de una orden de servicio con su bitácora de estados. */
export const GET = withAuth(async (session, _req: Request, { params }) => {
  const { id } = await params;
  const order = await getServiceOrder(session.organizationId, id);
  if (!order) return apiError(404, "not_found", "Orden de servicio no encontrada");
  return Response.json({ order });
});

const patchSchema = z.object({ status: z.enum(SERVICE_ORDER_STATUSES) });

/** PATCH — cambiar el estado de la orden (valida transición, deja bitácora). */
export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  try {
    await updateServiceOrderStatus(session.organizationId, id, body.data.status, session.userId);
    return Response.json({ ok: true });
  } catch (err) {
    return apiError(400, "service_order_status_failed", String(err));
  }
});
