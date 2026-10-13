import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { parseCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

const importSchema = z.object({
  csv: z.string().min(1, "CSV vacío").max(2_000_000, "Archivo demasiado grande (máx 2 MB)"),
});

type Mapped = {
  name: string;
  priceCents: number;
  shortDescription: string | null;
  websiteUrl: string | null;
  stock: number | null;
};

/** Mapea headers comunes del CSV a campos del inventario. */
function mapRow(row: Record<string, string>): Mapped | null {
  const name = (row["nombre"] || row["name"] || row["producto"] || "").trim();
  const priceRaw = (row["precio_mxn"] || row["precio"] || row["price"] || "").trim();
  if (!name || !priceRaw) return null;

  // "$1,234.50", "1234.50", "1234" → centavos.
  const priceNum = Number(priceRaw.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(priceNum) || priceNum < 0) return null;

  const shortDescription =
    (row["descripcion_corta"] || row["descripcion"] || row["shortdescription"] || "").trim() || null;
  const websiteUrl = (row["url_sitio"] || row["url"] || row["sitio"] || row["websiteurl"] || "").trim() || null;

  // inventario vacío = sin control (null); número → piezas.
  const stockRaw = (row["inventario"] || row["stock"] || row["piezas"] || "").trim();
  let stock: number | null = null;
  if (stockRaw) {
    const n = Number(stockRaw.replace(/[^0-9\-]/g, ""));
    if (Number.isFinite(n) && n >= 0) stock = Math.floor(n);
  }

  return {
    name: name.slice(0, 255),
    priceCents: Math.round(priceNum * 100),
    shortDescription: shortDescription ? shortDescription.slice(0, 500) : null,
    websiteUrl: websiteUrl ? websiteUrl.slice(0, 1024) : null,
    stock,
  };
}

export const POST = withAuth(async (session, req: Request) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(422, "invalid_body", "El body debe ser JSON válido");
  }
  const parsed = importSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(422, "invalid_body", parsed.error.issues[0]?.message ?? "Body inválido");
  }

  const rows = parseCsv(parsed.data.csv);
  if (rows.length === 0) {
    return apiError(422, "empty_csv", "El archivo no tiene filas de datos");
  }
  if (rows.length > 2000) {
    return apiError(422, "too_many_rows", "Máximo 2000 productos por importación");
  }

  const db = getDb();

  // Mapa de productos existentes por nombre (minúsculas) para hacer upsert.
  const existing = await db
    .select({ id: schema.catalogProduct.id, name: schema.catalogProduct.name })
    .from(schema.catalogProduct)
    .where(scoped(schema.catalogProduct.organizationId, session.organizationId));
  const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { row: number; message: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) {
      skipped++;
      continue;
    }
    const mapped = mapRow(row);
    if (!mapped) {
      skipped++;
      errors.push({ row: i + 2, message: "Falta nombre o precio" });
      continue;
    }

    const key = mapped.name.toLowerCase();
    const existingId = byName.get(key);

    try {
      if (existingId) {
        await db
          .update(schema.catalogProduct)
          .set({
            price: mapped.priceCents,
            shortDescription: mapped.shortDescription,
            websiteUrl: mapped.websiteUrl,
            stock: mapped.stock,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.catalogProduct.id, existingId),
              scoped(schema.catalogProduct.organizationId, session.organizationId)
            )
          );
        updated++;
      } else {
        const id = newId("catalogProduct");
        await db.insert(schema.catalogProduct).values({
          id,
          organizationId: session.organizationId,
          name: mapped.name,
          shortDescription: mapped.shortDescription,
          websiteUrl: mapped.websiteUrl,
          stock: mapped.stock,
          price: mapped.priceCents,
          currency: "MXN",
        });
        byName.set(key, id);
        created++;
      }
    } catch (err) {
      skipped++;
      errors.push({ row: i + 2, message: err instanceof Error ? err.message : "Error al guardar" });
    }
  }

  return Response.json({ created, updated, skipped, errors: errors.slice(0, 50) });
});
