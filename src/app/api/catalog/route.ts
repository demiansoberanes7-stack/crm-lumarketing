import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { productStockSchema, productWebsiteUrlSchema } from "@/lib/catalog-schema";
import {
  createCatalogProduct,
  listCatalogProducts,
} from "@/server/catalog/service";

export const dynamic = "force-dynamic";

/** GET — listar catálogo de productos */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);

  const products = await listCatalogProducts(session.organizationId, { limit });

  return Response.json({ products });
});

const postSchema = z.object({
  name: z.string().min(1).max(255),
  shortDescription: z.string().max(500).nullable().optional(),
  websiteUrl: productWebsiteUrlSchema.nullable().optional(),
  stock: productStockSchema.optional(),
  price: z.number().int().min(0),
  currency: z.string().default("MXN"),
});

/** POST — crear producto en catálogo */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  // Misma fuente que el MCP: alta idéntica venga de la UI o de ChatGPT.
  const { id } = await createCatalogProduct({
    organizationId: session.organizationId,
    name: body.data.name,
    shortDescription: body.data.shortDescription ?? null,
    websiteUrl: body.data.websiteUrl ?? null,
    stock: body.data.stock ?? null,
    price: body.data.price,
    currency: body.data.currency,
  });

  return Response.json({ ok: true, product: { id } }, { status: 201 });
});
