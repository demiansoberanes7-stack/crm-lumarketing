import { z } from "zod";
import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { productImageUrlSchema } from "@/lib/catalog-schema";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — obtener producto */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.catalogProduct)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        session.organizationId,
        eq(schema.catalogProduct.id, id)
      )
    )
    .limit(1);

  if (!rows[0]) return apiError(404, "not_found", "Producto no encontrado");
  return Response.json({ product: rows[0] });
});

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  longDescription: z.string().nullable().optional(),
  imageUrl: productImageUrlSchema.nullable().optional(),
  price: z.number().int().min(0).optional(),
  currency: z.string().min(3).max(3).optional(),
  available: z.boolean().optional(),
});

/** PATCH — actualizar producto */
export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const updated = await db
    .update(schema.catalogProduct)
    .set({ ...body.data, updatedAt: new Date() })
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        session.organizationId,
        eq(schema.catalogProduct.id, id)
      )
    )
    .returning({ id: schema.catalogProduct.id });

  if (!updated.length) return apiError(404, "not_found", "Producto no encontrado");

  return Response.json({ ok: true });
});

/** DELETE — eliminar producto */
export const DELETE = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const db = getDb();

  await db
    .delete(schema.catalogProduct)
    .where(
      scoped(
        schema.catalogProduct.organizationId,
        session.organizationId,
        eq(schema.catalogProduct.id, id)
      )
    );

  return Response.json({ ok: true });
});
