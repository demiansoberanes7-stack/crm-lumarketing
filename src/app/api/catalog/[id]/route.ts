import { z } from "zod";
import { eq } from "drizzle-orm";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { productStockSchema, productWebsiteUrlSchema } from "@/lib/catalog-schema";
import { getCatalogProduct, updateCatalogProduct } from "@/server/catalog/service";

export const dynamic = "force-dynamic";

type _Params = { params: Promise<{ id: string }> };

/** GET — obtener producto */
export const GET = withAuth(async (session, _req, { params }) => {
  const { id } = await params;
  const product = await getCatalogProduct(session.organizationId, id);
  if (!product) return apiError(404, "not_found", "Producto no encontrado");
  return Response.json({ product });
});

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  shortDescription: z.string().max(500).nullable().optional(),
  websiteUrl: productWebsiteUrlSchema.nullable().optional(),
  stock: productStockSchema.optional(),
  price: z.number().int().min(0).optional(),
});

/** PATCH — actualizar producto */
export const PATCH = withAuth(async (session, req: Request, { params }) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // Misma fuente que el MCP (actions/catalog): una sola implementación.
  const result = await updateCatalogProduct({
    organizationId: session.organizationId,
    productId: id,
    ...body.data,
  });
  if (!result.ok) return apiError(404, result.code, result.message);

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
