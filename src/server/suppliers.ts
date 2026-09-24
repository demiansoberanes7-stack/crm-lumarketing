import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { SupplierDto } from "@/lib/types";

export function serializeSupplier(s: typeof schema.supplier.$inferSelect): SupplierDto {
  return {
    id: s.id,
    name: s.name,
    tradeName: s.tradeName,
    contactName: s.contactName,
    phone: s.phone,
    email: s.email,
    rfc: s.rfc,
    address: s.address,
    website: s.website,
    category: s.category,
    paymentTerms: s.paymentTerms,
    rating: s.rating,
    notes: s.notes,
    archivedAt: s.archivedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function getSupplierById(organizationId: string, id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.supplier)
    .where(
      scoped(
        schema.supplier.organizationId,
        organizationId,
        eq(schema.supplier.id, id)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
