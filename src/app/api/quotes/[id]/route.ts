import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getQuote, updateQuote } from "@/server/quotes/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — obtener cotización con items */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const quote = await getQuote(session.organizationId, id);
  if (!quote) return apiError(404, "not_found", "Cotización no encontrada");
  return Response.json({ quote });
});

const itemSchema = z.object({
  productId: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().min(0),
});

const patchSchema = z.object({
  contactId: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1).optional(),
  discountType: z.enum(["fixed", "percentage"]).nullable().optional(),
  discountValue: z.number().int().min(0).nullable().optional(),
  taxRate: z.number().int().min(0).max(100).optional(),
  validDays: z.number().int().min(1).max(365).optional(),
  paymentMethod: z.record(z.unknown()).nullable().optional(),
  notes: z.string().max(10000).optional(),
});

/** PATCH — actualizar cotización (solo draft) */
export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    const input: Record<string, unknown> = {};
    if (body.data.contactId !== undefined) input.contactId = body.data.contactId;
    if (body.data.items !== undefined)
      input.items = body.data.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        description: item.description ?? undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      }));
    if (body.data.discountType !== undefined) input.discountType = body.data.discountType;
    if (body.data.discountValue !== undefined) input.discountValue = body.data.discountValue;
    if (body.data.taxRate !== undefined) input.taxRate = body.data.taxRate;
    if (body.data.validDays !== undefined) input.validDays = body.data.validDays;
    if (body.data.paymentMethod !== undefined) input.paymentMethod = body.data.paymentMethod;
    if (body.data.notes !== undefined) input.notes = body.data.notes;
    await updateQuote(session.organizationId, id, input as import("@/server/quotes/service").QuoteInput);
    return Response.json({ ok: true });
  } catch (err) {
    return apiError(400, "update_failed", String(err));
  }
});
