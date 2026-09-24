import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getSupplierById, serializeSupplier } from "@/server/suppliers";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const supplier = await getSupplierById(session.organizationId, id);
  if (!supplier) return apiError(404, "not_found", "Proveedor no encontrado");
  return Response.json({ supplier: serializeSupplier(supplier) });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  tradeName: z.string().max(255).nullable().optional(),
  contactName: z.string().max(255).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  rfc: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  website: z.string().max(254).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  paymentTerms: z.string().max(100).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  archived: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.name !== undefined) set.name = body.data.name;
  if (body.data.tradeName !== undefined) set.tradeName = body.data.tradeName;
  if (body.data.contactName !== undefined) set.contactName = body.data.contactName;
  if (body.data.phone !== undefined) set.phone = body.data.phone;
  if (body.data.email !== undefined) set.email = body.data.email;
  if (body.data.rfc !== undefined) set.rfc = body.data.rfc;
  if (body.data.address !== undefined) set.address = body.data.address;
  if (body.data.website !== undefined) set.website = body.data.website;
  if (body.data.category !== undefined) set.category = body.data.category;
  if (body.data.paymentTerms !== undefined) set.paymentTerms = body.data.paymentTerms;
  if (body.data.rating !== undefined) set.rating = body.data.rating;
  if (body.data.notes !== undefined) set.notes = body.data.notes;
  if (body.data.archived !== undefined) {
    set.archivedAt = body.data.archived ? new Date() : null;
  }

  const db = getDb();
  await db
    .update(schema.supplier)
    .set(set)
    .where(
      scoped(
        schema.supplier.organizationId,
        session.organizationId,
        eq(schema.supplier.id, id)
      )
    );

  const supplier = await getSupplierById(session.organizationId, id);
  if (!supplier) return apiError(404, "not_found", "Proveedor no encontrado");
  return Response.json({ supplier: serializeSupplier(supplier) });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();

  const supplier = await getSupplierById(session.organizationId, id);
  if (!supplier) return apiError(404, "not_found", "Proveedor no encontrado");

  await db
    .delete(schema.supplier)
    .where(
      scoped(
        schema.supplier.organizationId,
        session.organizationId,
        eq(schema.supplier.id, id)
      )
    );

  return Response.json({ deleted: true });
});
