import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { listQuotes, createQuote } from "@/server/quotes/service";

export const dynamic = "force-dynamic";

/** GET — listar cotizaciones */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const quotes = await listQuotes(session.organizationId, { status, limit, offset });
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
  items: z.array(itemSchema).min(1),
  discountType: z.enum(["fixed", "percentage"]).nullable().optional(),
  discountValue: z.number().int().min(0).nullable().optional(),
  taxRate: z.number().int().min(0).max(100).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().optional(),
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
      paymentMethod: body.data.paymentMethod ?? undefined,
    },
    session.userId
  );
  return Response.json({ ok: true, quoteId: id }, { status: 201 });
});
