import { desc } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { csvBlob, stringifyCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * Exporta el inventario a CSV (abre directo en Excel/Numbers/Sheets).
 * Columnas: nombre, precio_mxn, descripcion_corta, url_sitio, inventario.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.catalogProduct)
    .where(scoped(schema.catalogProduct.organizationId, session.organizationId))
    .orderBy(desc(schema.catalogProduct.createdAt))
    .limit(5000);

  const products = rows.map((p) => ({
    nombre: p.name,
    // price está en centavos; el CSV lo lleva en pesos con 2 decimales.
    precio_mxn: (p.price / 100).toFixed(2),
    descripcion_corta: p.shortDescription ?? "",
    url_sitio: p.websiteUrl ?? "",
    // stock null = sin control → celda vacía (conserva "sin control" al reimportar).
    inventario: p.stock === null ? "" : String(p.stock),
  }));

  const csv = stringifyCsv(products, [
    "nombre",
    "precio_mxn",
    "descripcion_corta",
    "url_sitio",
    "inventario",
  ]);

  return new Response(csvBlob(csv), {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="inventario-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
