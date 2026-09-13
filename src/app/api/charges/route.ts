import { z } from "zod";
import { parseBody, withAuth, apiError } from "@/lib/api";
import { createPayment, getAccountsReceivable } from "@/server/finances/service";

export const dynamic = "force-dynamic";

/** GET — cuentas por cobrar */
export const GET = withAuth(async (session) => {
  const charges = await getAccountsReceivable(session.organizationId);
  return Response.json({ charges });
});

const postSchema = z.object({
  chargeId: z.string().optional(),
  contactId: z.string().nullable().optional(),
  monto: z.number().int().positive(),
  metodo: z.string().min(1),
  referencia: z.string().nullable().optional(),
  comprobanteUrl: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  fecha: z.string().datetime().optional(),
  requestId: z.string().uuid().optional(),
});

/** POST — registrar pago (ingreso) */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  try {
  const id = await createPayment(
    session.organizationId,
    {
      chargeId: body.data.chargeId,
      requestId: body.data.requestId,
      contactId: body.data.contactId ?? undefined,
      monto: body.data.monto,
      metodo: body.data.metodo,
      referencia: body.data.referencia ?? undefined,
      comprobanteUrl: body.data.comprobanteUrl ?? undefined,
      notas: body.data.notas ?? undefined,
      fecha: body.data.fecha ? new Date(body.data.fecha) : undefined,
    },
    session.userId
  );

  return Response.json({ ok: true, paymentId: id }, { status: 201 });
  } catch (e) { return apiError(422, "payment_failed", e instanceof Error ? e.message : "No se pudo registrar el pago"); }
});
