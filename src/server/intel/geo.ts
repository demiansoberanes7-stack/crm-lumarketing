import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getIntelCredentials } from "@/server/intel/credentials";
import { countEstablishments } from "@/server/intel/sources/denue";
import { utcDay } from "@/server/intel/service";

/**
 * Geografía de competencia por estado (DENUE/INEGI).
 *
 * 32 consultas `BuscarEntidad` por nicho (una por entidad federativa). La
 * ventana de la API es de 10 registros: si viene llena, el conteo se guarda
 * como censored=true y se muestra "≥10" — nunca se inventa un total.
 */

export type MexicoState = {
  /** Clave INEGI que DENUE espera en `entidad`. */
  code: string;
  name: string;
  short: string;
  /** Posición en el mapa de rejilla (aproximada, col/row 0-based). */
  col: number;
  row: number;
};

/** Catálogo de entidades federativas (códigos INEGI) + mapa de rejilla. */
export const MEXICO_STATES: readonly MexicoState[] = [
  { code: "02", name: "Baja California", short: "BC", col: 0, row: 0 },
  { code: "26", name: "Sonora", short: "SON", col: 1, row: 0 },
  { code: "08", name: "Chihuahua", short: "CHH", col: 2, row: 0 },
  { code: "05", name: "Coahuila", short: "COAH", col: 3, row: 0 },
  { code: "19", name: "Nuevo León", short: "NL", col: 4, row: 0 },
  { code: "28", name: "Tamaulipas", short: "TAM", col: 5, row: 0 },
  { code: "03", name: "Baja California Sur", short: "BCS", col: 0, row: 1 },
  { code: "25", name: "Sinaloa", short: "SIN", col: 1, row: 1 },
  { code: "10", name: "Durango", short: "DUR", col: 2, row: 1 },
  { code: "32", name: "Zacatecas", short: "ZAC", col: 3, row: 1 },
  { code: "24", name: "San Luis Potosí", short: "SLP", col: 4, row: 1 },
  { code: "18", name: "Nayarit", short: "NAY", col: 1, row: 2 },
  { code: "14", name: "Jalisco", short: "JAL", col: 2, row: 2 },
  { code: "01", name: "Aguascalientes", short: "AGS", col: 3, row: 2 },
  { code: "11", name: "Guanajuato", short: "GTO", col: 4, row: 2 },
  { code: "22", name: "Querétaro", short: "QRO", col: 5, row: 2 },
  { code: "13", name: "Hidalgo", short: "HGO", col: 6, row: 2 },
  { code: "30", name: "Veracruz", short: "VER", col: 7, row: 2 },
  { code: "06", name: "Colima", short: "COL", col: 2, row: 3 },
  { code: "16", name: "Michoacán", short: "MICH", col: 3, row: 3 },
  { code: "15", name: "Estado de México", short: "MEX", col: 4, row: 3 },
  { code: "09", name: "Ciudad de México", short: "CDMX", col: 5, row: 3 },
  { code: "29", name: "Tlaxcala", short: "TLAX", col: 6, row: 3 },
  { code: "21", name: "Puebla", short: "PUE", col: 7, row: 3 },
  { code: "12", name: "Guerrero", short: "GRO", col: 3, row: 4 },
  { code: "17", name: "Morelos", short: "MOR", col: 4, row: 4 },
  { code: "20", name: "Oaxaca", short: "OAX", col: 6, row: 4 },
  { code: "23", name: "Quintana Roo", short: "QROO", col: 8, row: 4 },
  { code: "07", name: "Chiapas", short: "CHIS", col: 5, row: 5 },
  { code: "27", name: "Tabasco", short: "TAB", col: 6, row: 5 },
  { code: "04", name: "Campeche", short: "CAM", col: 7, row: 5 },
  { code: "31", name: "Yucatán", short: "YUC", col: 8, row: 5 },
] as const;

export type GeoStateCount = {
  code: string;
  name: string;
  short: string;
  col: number;
  row: number;
  count: number;
  censored: boolean;
  /** % del conteo total del día (share entre estados). */
  sharePct: number;
};

export type GeoReport =
  | { available: false; reason: "missing_denue_token" | "no_data" }
  | {
      available: true;
      termId: string;
      termName: string;
      day: string;
      total: number;
      states: GeoStateCount[];
      generatedAt: string;
    };

export type GeoIngestResult =
  | { ok: false; reason: "missing_denue_token" | "term_not_found" }
  | {
      ok: true;
      termId: string;
      day: string;
      statesQueried: number;
      total: number;
      censoredStates: number;
    };

export async function runGeoIngest(
  organizationId: string,
  termId: string
): Promise<GeoIngestResult> {
  const creds = await getIntelCredentials(organizationId);
  if (!creds?.denueToken) {
    return { ok: false, reason: "missing_denue_token" };
  }
  const db = getDb();
  const termRows = await db
    .select()
    .from(schema.intelTerm)
    .where(
      scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.id, termId))
    )
    .limit(1);
  const term = termRows[0];
  if (!term) return { ok: false, reason: "term_not_found" };

  const day = utcDay();
  const results: Array<{ state: MexicoState; count: number; censored: boolean }> = [];
  let idx = 0;
  for (const state of MEXICO_STATES) {
    // Pausa corta entre llamadas para no golpear el rate limit de INEGI.
    if (idx > 0) await new Promise((r) => setTimeout(r, 150));
    idx += 1;
    const denue = await countEstablishments(creds.denueToken, [term.name], state.code);
    if (denue) results.push({ state, count: denue.count, censored: denue.censored });
  }
  if (results.length === 0) return { ok: false, reason: "missing_denue_token" };

  for (const r of results) {
    await db
      .insert(schema.intelGeoSnapshot)
      .values({
        id: newId("intelGeo"),
        organizationId,
        termId,
        state: r.state.code,
        count: r.count,
        censored: r.censored,
        day,
      })
      .onConflictDoUpdate({
        target: [schema.intelGeoSnapshot.termId, schema.intelGeoSnapshot.state, schema.intelGeoSnapshot.day],
        set: { count: r.count, censored: r.censored },
      });
  }

  const total = results.reduce((a, r) => a + r.count, 0);
  return {
    ok: true,
    termId,
    day,
    statesQueried: results.length,
    total,
    censoredStates: results.filter((r) => r.censored).length,
  };
}

export async function getGeoReport(
  organizationId: string,
  termId: string
): Promise<GeoReport> {
  const creds = await getIntelCredentials(organizationId);
  if (!creds?.denueToken) {
    return { available: false, reason: "missing_denue_token" };
  }
  const db = getDb();

  const termRows = await db
    .select({ id: schema.intelTerm.id, name: schema.intelTerm.name })
    .from(schema.intelTerm)
    .where(
      scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.id, termId))
    )
    .limit(1);
  const term = termRows[0];
  if (!term) return { available: false, reason: "no_data" };

  const latest = await db
    .select({ day: schema.intelGeoSnapshot.day })
    .from(schema.intelGeoSnapshot)
    .where(
      scoped(
        schema.intelGeoSnapshot.organizationId,
        organizationId,
        eq(schema.intelGeoSnapshot.termId, termId)
      )
    )
    .orderBy(desc(schema.intelGeoSnapshot.day))
    .limit(1);
  const day = latest[0]?.day;
  if (!day) return { available: false, reason: "no_data" };

  const rows = await db
    .select()
    .from(schema.intelGeoSnapshot)
    .where(
      scoped(
        schema.intelGeoSnapshot.organizationId,
        organizationId,
        eq(schema.intelGeoSnapshot.termId, termId),
        eq(schema.intelGeoSnapshot.day, day)
      )
    );
  const total = rows.reduce((a, r) => a + r.count, 0);
  const byCode = new Map(rows.map((r) => [r.state, r]));

  const states: GeoStateCount[] = MEXICO_STATES.map((s) => {
    const row = byCode.get(s.code);
    return {
      code: s.code,
      name: s.name,
      short: s.short,
      col: s.col,
      row: s.row,
      count: row?.count ?? 0,
      censored: row?.censored ?? false,
      sharePct: total > 0 && row ? (row.count / total) * 100 : 0,
    };
  });

  return {
    available: true,
    termId,
    termName: term.name,
    day,
    total,
    states,
    generatedAt: new Date().toISOString(),
  };
}

/** Filtra los estados a un subconjunto (útil para tests/validación). */
export function filterStates(codes: string[]): MexicoState[] {
  const set = new Set(codes);
  return MEXICO_STATES.filter((s) => set.has(s.code));
}
