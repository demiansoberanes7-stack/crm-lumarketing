import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Catálogo de términos (nichos) monitoreados por el módulo.
 *
 * En el primer uso de una organización se siembra una taxonomía inicial de
 * tecnología en México (los giros de Zorro Tech + retail tech), editable
 * después en la BD. El matching de videos es por keyword, no por nombre exacto.
 */

type SeedTerm = { name: string; keywords: string[] };

const SEED_TERMS: SeedTerm[] = [
  { name: "Cámaras de seguridad", keywords: ["camara de seguridad", "camaras de seguridad", "camara ip", "videovigilancia", "cctv"] },
  { name: "Cámaras IP", keywords: ["camara ip", "camaras ip", "camara de red", "nvr", "dvr"] },
  { name: "Redes y conectividad", keywords: ["router", "switch de red", "punto de acceso", "wifi", "redes"] },
  { name: "Alarmas y sensores", keywords: ["alarma para casa", "alarma inalambrica", "sensor de movimiento", "sensor de puerta"] },
  { name: "Energía solar", keywords: ["panel solar", "energia solar", "inversor solar", "bateria litio"] },
  { name: "Herramienta eléctrica", keywords: ["taladro", "herramienta electrica", "megafresa", "amoladora", "remachadora", "multimetro"] },
  { name: "Pro Audio / Video", keywords: ["proyector", "pantalla led", "bocina profesional", "micrófono inalambrico", "mezcladora de audio"] },
  { name: "Computo de escritorio", keywords: ["pc gamer", "computadora para oficina", "armar pc", "tarjeta de video", "gabinete"] },
  { name: "Laptops", keywords: ["laptop", "portatil", "macbook", "chromebook"] },
  { name: "Smartphones", keywords: ["celular", "smartphone", "iphone", "samsung galaxy", "xiaomi"] },
  { name: "Accesorios de celular", keywords: ["carga inalambrica", "funda para celular", "audifonos true wireless", "cable usb"] },
  { name: "Impresión 3D", keywords: ["impresora 3d", "filamento pla", "resina para impresion", "ender"] },
  { name: "Internet satelital", keywords: ["starlink", "internet satelital", "antena satelital"] },
  { name: "Domótica", keywords: ["casa inteligente", "domotica", "bombilla inteligente", "enchufe inteligente"] },
  { name: "Gaming", keywords: ["playstation", "xbox", "nintendo switch", "silla gamer", "teclado mecanico"] },
];

export type IntelTerm = {
  id: string;
  name: string;
  keywords: string[];
  geo: string;
  active: boolean;
};

type Row = typeof schema.intelTerm.$inferSelect;

function toTerm(row: Row): IntelTerm {
  return {
    id: row.id,
    name: row.name,
    keywords: Array.isArray(row.keywords)
      ? row.keywords.filter((k): k is string => typeof k === "string")
      : [],
    geo: row.geo,
    active: row.active,
  };
}

/** Siembra la taxonomía inicial solo si la organización no tiene términos. */
export async function ensureSeedTerms(organizationId: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ id: schema.intelTerm.id })
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(schema.intelTerm).values(
    SEED_TERMS.map((term) => ({
      id: newId("intelTerm"),
      organizationId,
      name: term.name,
      keywords: term.keywords,
      geo: "MX",
      active: true,
    }))
  );
}

export async function listActiveTerms(
  organizationId: string
): Promise<IntelTerm[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.active, true)));
  return rows.map(toTerm);
}

export async function listTerms(organizationId: string): Promise<IntelTerm[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelTerm)
    .where(scoped(schema.intelTerm.organizationId, organizationId))
    .orderBy(schema.intelTerm.name);
  return rows.map(toTerm);
}

/** Resuelve una búsqueda libre a un término del catálogo (nombre o keyword). */
export async function resolveTerm(
  organizationId: string,
  query: string
): Promise<IntelTerm | null> {
  const terms = await listActiveTerms(organizationId);
  const q = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (!q) return null;
  const byName = terms.find((t) =>
    t.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .includes(q)
  );
  if (byName) return byName;
  return (
    terms.find((t) =>
      t.keywords.some((k) =>
        k
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .includes(q)
      )
    ) ?? null
  );
}
