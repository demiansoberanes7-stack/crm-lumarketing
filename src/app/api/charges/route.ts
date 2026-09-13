import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
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
});

/** POST — registrar pago (ingreso) */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const id = await createPayment(
    session.organizationId,
    {
      chargeId: body.data.chargeId,
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
});
