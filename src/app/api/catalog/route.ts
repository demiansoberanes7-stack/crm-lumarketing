import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/** GET — listar catálogo de productos */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);
  const db = getDb();

  const products = await db
    .select()
    .from(schema.catalogProduct)
    .where(scoped(schema.catalogProduct.organizationId, session.organizationId))
    .limit(limit);

  return Response.json({ products });
});

const postSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  price: z.number().int().min(0),
  currency: z.string().default("MXN"),
  available: z.boolean().default(true),
});

/** POST — crear producto en catálogo */
export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const id = newId("catalogProduct");

  await db.insert(schema.catalogProduct).values({
    id,
    organizationId: session.organizationId,
    name: body.data.name,
    description: body.data.description ?? null,
    price: body.data.price,
    currency: body.data.currency,
    available: body.data.available,
  });

  return Response.json({ ok: true, product: { id } }, { status: 201 });
});
