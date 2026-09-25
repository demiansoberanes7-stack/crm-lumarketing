import { desc, ilike, or, eq, and, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { serializeSupplier } from "@/server/suppliers";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const category = url.searchParams.get("category")?.trim() ?? "";
  const rating = url.searchParams.get("rating")?.trim() ?? "";
  const showArchived = url.searchParams.get("archived") === "1";

  const db = getDb();
  const conditions: SQL[] = [
    scoped(schema.supplier.organizationId, session.organizationId),
  ];

  if (!showArchived) {
    conditions.push(isNull(schema.supplier.archivedAt));
  }

  if (q) {
    const qCond = or(
      ilike(schema.supplier.name, `%${q}%`),
      ilike(schema.supplier.contactName, `%${q}%`),
      ilike(schema.supplier.email, `%${q}%`),
      ilike(schema.supplier.rfc, `%${q}%`)
    );
    if (qCond) conditions.push(qCond);
  }

  if (category) {
    conditions.push(eq(schema.supplier.category, category));
  }

  if (rating) {
    conditions.push(eq(schema.supplier.rating, Number(rating)));
  }

  const whereClause = and(...conditions);

  const rows = await db
    .select()
    .from(schema.supplier)
    .where(whereClause ?? undefined)
    .orderBy(desc(schema.supplier.updatedAt))
    .limit(200);

  return Response.json({ suppliers: rows.map(serializeSupplier) });
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(255),
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
});

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const id = newId("supplier");

  await db.insert(schema.supplier).values({
    id,
    organizationId: session.organizationId,
    name: body.data.name,
    tradeName: body.data.tradeName ?? null,
    contactName: body.data.contactName ?? null,
    phone: body.data.phone ?? null,
    email: body.data.email ?? null,
    rfc: body.data.rfc ?? null,
    address: body.data.address ?? null,
    website: body.data.website ?? null,
    category: body.data.category ?? null,
    paymentTerms: body.data.paymentTerms ?? null,
    rating: body.data.rating ?? null,
    notes: body.data.notes ?? null,
  });

  const rows = await db
    .select()
    .from(schema.supplier)
    .where(eq(schema.supplier.id, id))
    .limit(1);

  return Response.json({ supplier: serializeSupplier(rows[0]!) }, { status: 201 });
});
