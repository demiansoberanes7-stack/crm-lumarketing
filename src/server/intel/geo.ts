import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getIntelCredentials } from "@/server/intel/credentials";
import { countEstablishments } from "@/server/intel/sources/denue";
import { utcDay } from "@/server/intel/service";
import { MEXICO_STATES, type MexicoState } from "@/lib/mexico-states";

/**
 * Geografía de competencia por estado (DENUE/INEGI).
 *
 * 32 consultas `BuscarEntidad` por nicho (una por entidad federativa). La
 * ventana de la API es de 10 registros: si viene llena, el conteo se guarda
 * como censored=true y se muestra "≥10" — nunca se inventa un total.
 */

// Re-exportamos el catálogo desde el archivo compartido (cliente+servidor).
export { MEXICO_STATES, type MexicoState };

export type GeoStateCount = {
  code: string;
  name: string;
  short: string;
  col: number;
  row: number;
  /** Conteo capturado. Con `status: "missing"` no significa cero. */
  count: number;
  censored: boolean;
  /**
   * Veracidad por estado:
   *  - "ok"       → la API respondió: el conteo es exacto (aunque sea 0).
   *  - "censored" → ventana llena: el real es ≥ count (se muestra "≥N").
   *  - "missing"  → el estado NO respondió en la ingesta: no hay dato.
   *    Sin este estado, un timeout aparecía como "0 competidores".
   */
  status: "ok" | "censored" | "missing";
  /**
   * % del total capturado. `null` cuando no es confiable: con censura o
   * estados faltantes el denominador es un límite inferior, no la verdad.
   */
  sharePct: number | null;
};

export type GeoReport =
  | { available: false; reason: "missing_denue_token" | "no_data" }
  | {
      available: true;
      termId: string;
      termName: string;
      day: string;
      /**
       * Suma de los conteos capturados (los censurados cuentan como 10, los
       * faltantes no suman). Con `totalExact: false` es un LÍMITE INFERIOR —
       * nunca se presenta como total exacto.
       */
      totalLowerBound: number;
      /** true solo si los 32 estados respondieron y ninguno está censurado. */
      totalExact: boolean;
      /** Estados sin captura en el día (no respondieron). */
      missingStates: number;
      /** Estados con ventana llena: el total real puede ser mayor. */
      censoredStates: number;
      states: GeoStateCount[];
      generatedAt: string;
    };

export type GeoIngestResult =
  | { ok: false; reason: "missing_denue_token" | "term_not_found" | "denue_failed" }
  | {
      ok: true;
      termId: string;
      day: string;
      statesQueried: number;
      /** Suma de lo capturado; con censura/faltantes es un límite inferior. */
      totalLowerBound: number;
      censoredStates: number;
      /** Estados que no respondieron (32 − respondieron). */
      missingStates: number;
    };

export async function runGeoIngest(
  organizationId: string,
  termId: string,
  onProgress?: (done: number, total: number) => void | Promise<void>
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
  const totalStates = MEXICO_STATES.length;
  await onProgress?.(0, totalStates);
  for (const state of MEXICO_STATES) {
    // Pausa entre llamadas: INEGI limita ráfagas; 500 ms evita el 429.
    if (idx > 0) await new Promise((r) => setTimeout(r, 500));
    idx += 1;
    let denue = await countEstablishments(creds.denueToken, [term.name], state.code);
    // Un reintento tras fallo puntual (timeout o rate limit transitorio).
    if (!denue) {
      await new Promise((r) => setTimeout(r, 1200));
      denue = await countEstablishments(creds.denueToken, [term.name], state.code);
    }
    if (denue) results.push({ state, count: denue.count, censored: denue.censored });
    await onProgress?.(idx, totalStates);
  }
  // Éxito parcial: si al menos 1 estado respondió, se guarda y se declara ok.
  // Solo se reporta denue_failed si NINGÚN estado respondió.
  if (results.length === 0) return { ok: false, reason: "denue_failed" };

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

  const totalLowerBound = results.reduce((a, r) => a + r.count, 0);
  const censoredStates = results.filter((r) => r.censored).length;
  return {
    ok: true,
    termId,
    day,
    statesQueried: results.length,
    totalLowerBound,
    censoredStates,
    missingStates: MEXICO_STATES.length - results.length,
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
  const totalLowerBound = rows.reduce((a, r) => a + r.count, 0);
  const byCode = new Map(rows.map((r) => [r.state, r]));
  const censoredStates = rows.filter((r) => r.censored).length;
  // Estados sin fila para el día: no respondieron en la ingesta. NO son 0.
  const missingStates = MEXICO_STATES.filter((s) => !byCode.has(s.code)).length;
  // Solo con los 32 estados respondidos Y sin censura el total es la verdad;
  // en cualquier otro caso es un límite inferior y los shares no son confiables.
  const totalExact = missingStates === 0 && censoredStates === 0;

  const states: GeoStateCount[] = MEXICO_STATES.map((s) => {
    const row = byCode.get(s.code);
    const status: GeoStateCount["status"] = !row
      ? "missing"
      : row.censored
        ? "censored"
        : "ok";
    return {
      code: s.code,
      name: s.name,
      short: s.short,
      col: s.col,
      row: s.row,
      count: row?.count ?? 0,
      censored: row?.censored ?? false,
      status,
      sharePct:
        totalExact && totalLowerBound > 0 && row
          ? (row.count / totalLowerBound) * 100
          : null,
    };
  });

  return {
    available: true,
    termId,
    termName: term.name,
    day,
    totalLowerBound,
    totalExact,
    missingStates,
    censoredStates,
    states,
    generatedAt: new Date().toISOString(),
  };
}

/** Filtra los estados a un subconjunto (útil para tests/validación). */
export function filterStates(codes: string[]): MexicoState[] {
  const set = new Set(codes);
  return MEXICO_STATES.filter((s) => set.has(s.code));
}
