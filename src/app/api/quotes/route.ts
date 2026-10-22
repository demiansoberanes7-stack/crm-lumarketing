import { z } from "zod";
import { intParam, parseBody, withAuth } from "@/lib/api";
import { listQuotes, createQuote, listQuotesForProjectLink } from "@/server/quotes/service";

export const dynamic = "force-dynamic";

/** GET — listar cotizaciones */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  // `intParam` y no `parseInt`: con `?limit=-5` el negativo llegaba directo a
  // `LIMIT` y Postgres respondía 500 en vez de la lista.
  const limit = intParam(url, "limit", { fallback: 50, min: 1, max: 100 });
  const offset = intParam(url, "offset", { fallback: 0 });
  const archived = url.searchParams.get("archived") === "1";

  // Desplegable de "Nuevo proyecto": no archivadas y sin proyecto vinculado,
  // con el nombre del contacto para armar el identificador de la cotización.
  if (url.searchParams.get("forProject") === "1") {
    const quotes = await listQuotesForProjectLink(session.organizationId, limit);
    return Response.json({ quotes });
  }

  const quotes = await listQuotes(session.organizationId, { status, limit, offset, archived });
  return Response.json({ quotes });
});

const itemSchema = z.object({
  productId: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().min(0),
});

const postSchema = z.object({
  contactId: z.string().nullable().optional(),
  clientPhone: z.string().max(40).nullish(),
  items: z.array(itemSchema).min(1),
  discountType: z.enum(["fixed", "percentage"]).nullable().optional(),
  discountValue: z.number().int().min(0).nullable().optional(),
  taxRate: z.number().int().min(0).max(100).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().optional(),
  paymentConditions: z.string().max(2000).optional(),
  paymentMethod: z.record(z.unknown()).nullable().optional(),
});

/** POST — crear cotización */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const id = await createQuote(
    session.organizationId,
    {
      contactId: body.data.contactId,
      clientPhone: body.data.clientPhone,
      items: body.data.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        description: item.description ?? undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      discountType: body.data.discountType,
      discountValue: body.data.discountValue,
      taxRate: body.data.taxRate,
      validDays: body.data.validDays,
      notes: body.data.notes,
      paymentConditions: body.data.paymentConditions,
      paymentMethod: body.data.paymentMethod ?? undefined,
    },
    session.userId
  );
  return Response.json({ ok: true, quoteId: id }, { status: 201 });
});
