import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { createExpense, getRecentExpenses } from "@/server/finances/service";

export const dynamic = "force-dynamic";

/** GET — gastos recientes */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const expenses = await getRecentExpenses(session.organizationId, limit);
  return Response.json({ expenses });
});

const postSchema = z.object({
  descripcion: z.string().min(1),
  categoria: z.string().min(1),
  proveedor: z.string().nullable().optional(),
  monto: z.number().int().positive(),
  metodo: z.string().min(1),
  referencia: z.string().nullable().optional(),
  comprobanteUrl: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  fecha: z.string().datetime().optional(),
});

/** POST — registrar gasto */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const id = await createExpense(
    session.organizationId,
    {
      descripcion: body.data.descripcion,
      categoria: body.data.categoria,
      proveedor: body.data.proveedor ?? undefined,
      monto: body.data.monto,
      metodo: body.data.metodo,
      referencia: body.data.referencia ?? undefined,
      comprobanteUrl: body.data.comprobanteUrl ?? undefined,
      notas: body.data.notas ?? undefined,
      fecha: body.data.fecha ? new Date(body.data.fecha) : undefined,
    },
    session.userId
  );

  return Response.json({ ok: true, expenseId: id }, { status: 201 });
});
