import { desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getIntelCredentials } from "@/server/intel/credentials";
import { listActiveTerms } from "@/server/intel/terms";
import {
  classify,
  describe,
  growthZ,
  toIndex,
  type Classification,
  type Descriptive,
} from "@/server/intel/stats";

/** Día UTC "YYYY-MM-DD" — llave determinista de snapshots y videos. */
export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Suma `days` días naturales al día dado (parseando "YYYY-MM-DD" en UTC). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type TrendCard = {
  termId: string;
  name: string;
  /** z-score de los últimos 7 días contra los 21 previos (null si no aplica). */
  z: number | null;
  lastValue: number;
  /** Serie GT de la ventana (30 días). */
  series: Array<{ day: string; value: number }>;
};

/**
 * Estado 1: tendencias actuales. Por término, z-score de la ventana reciente
 * contra el histórico; se ordena de mayor a menor z (los null al final).
 * SOLO usa la serie Google Trends (0–100). Sin datos GT → el nicho no aparece
 * (nunca se rellena con vistas de canales: la fuente es 100 % externa).
 */
export async function getTrends(
  organizationId: string
): Promise<{ trends: TrendCard[]; lastIngestAt: string | null }> {
  const creds = await getIntelCredentials(organizationId);
  const terms = await listActiveTerms(organizationId);
  const end = utcDay();
  // Ventana: 30 días de GT.
  const start = addDays(end, -29);

  const db = getDb();
  const termIds = terms.map((t) => t.id);
  const gtByTerm = new Map<string, Array<{ day: string; value: number }>>();
  if (termIds.length) {
    const gtRows = await db
      .select()
      .from(schema.intelGtSnapshot)
      .where(
        scoped(
          schema.intelGtSnapshot.organizationId,
          organizationId,
          inArray(schema.intelGtSnapshot.termId, termIds),
          // La ventana se filtra EN SQL: traer todo el histórico y recortarlo
          // en memoria crece sin límite con los días.
          gte(schema.intelGtSnapshot.day, start),
          lte(schema.intelGtSnapshot.day, end)
        )
      )
      .orderBy(schema.intelGtSnapshot.day);
    for (const row of gtRows) {
      const list = gtByTerm.get(row.termId) ?? [];
      list.push({ day: row.day, value: row.value });
      gtByTerm.set(row.termId, list);
    }
  }

  const trends: TrendCard[] = [];
  for (const term of terms) {
    const history = gtByTerm.get(term.id) ?? [];
    if (history.length === 0) continue;

    const recent = history.slice(-7).map((s) => s.value);
    const prior = history.slice(0, -7).map((s) => s.value);
    const last = history[history.length - 1]!;
    trends.push({
      termId: term.id,
      name: term.name,
      z: growthZ(recent, prior),
      lastValue: last.value,
      series: history.map((s) => ({ day: s.day, value: s.value })),
    });
  }
  trends.sort((a, b) => (b.z ?? -Infinity) - (a.z ?? -Infinity));
  return {
    trends,
    lastIngestAt: creds?.gtLastSyncAt?.toISOString() ?? creds?.lastIngestAt?.toISOString() ?? null,
  };
}

export type TermCompareItem = {
  termId: string;
  name: string;
  seriesPoints: Array<{ day: string; value: number }>;
  descriptive: Descriptive;
  z: number | null;
  /** % del interés GT del último día que representa este nicho (share). */
  sharePct: number;
  lastValue: number;
  classification: Classification;
};

/**
 * Comparativa de 2–3 nichos: mismas métricas, misma ventana, unidades
 * explícitas. Fuente: SOLO Google Trends (índice 0–100). Sin datos GT →
 * el nicho queda con serie vacía (nunca se rellena con YouTube).
 */
export async function compareTerms(
  organizationId: string,
  termIds: string[]
): Promise<{ terms: TermCompareItem[]; generatedAt: string }> {
  const requested = [...new Set(termIds)].slice(0, 3);
  const allTerms = await listActiveTerms(organizationId);
  const terms = requested
    .map((id) => allTerms.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const end = utcDay();
  const start = addDays(end, -29);
  const db = getDb();
  const rows = terms.length
    ? await db
        .select()
        .from(schema.intelGtSnapshot)
        .where(
          scoped(
            schema.intelGtSnapshot.organizationId,
            organizationId,
            inArray(schema.intelGtSnapshot.termId, terms.map((t) => t.id)),
            gte(schema.intelGtSnapshot.day, start),
            lte(schema.intelGtSnapshot.day, end)
          )
        )
        .orderBy(schema.intelGtSnapshot.day)
    : [];

  const byTerm = new Map<string, Array<{ day: string; value: number }>>();
  for (const row of rows) {
    const list = byTerm.get(row.termId) ?? [];
    list.push({ day: row.day, value: row.value });
    byTerm.set(row.termId, list);
  }

  const lastValues = terms.map((term) => {
    const history = byTerm.get(term.id) ?? [];
    return history.length > 0 ? history[history.length - 1]!.value : 0;
  });
  const totalLast = lastValues.reduce((a, b) => a + b, 0);

  const items: TermCompareItem[] = terms.map((term, i) => {
    const history = byTerm.get(term.id) ?? [];
    const seriesValues = history.map((s) => s.value);
    const recent = seriesValues.slice(-7);
    const prior = seriesValues.slice(0, -7);
    const z = seriesValues.length >= 7 ? growthZ(recent, prior) : null;
    const verdict = classify({ daysWithData: seriesValues.length, z });
    return {
      termId: term.id,
      name: term.name,
      seriesPoints: history.map((s) => ({ day: s.day, value: s.value })),
      descriptive: describe(seriesValues),
      z,
      sharePct: totalLast > 0 ? (lastValues[i]! / totalLast) * 100 : 0,
      lastValue: lastValues[i]!,
      classification: verdict.classification,
    };
  });

  return { terms: items, generatedAt: new Date().toISOString() };
}

/* ────────────────────────────────────────────────────────────────────────────
   Google Trends (ADR-001 · bandera INTEL_GT).
   La serie GT manda (índice 0–100); las vistas YouTube son fallback
   normalizado. Fuentes declaradas siempre en la UI.
   ──────────────────────────────────────────────────────────────────────────── */

export type GtIngestResult = {
  termId: string;
  ok: boolean;
  points: number;
  regions: number;
  related: number;
  partial: boolean;
  reason?: string;
  /** Proveedor real usado (serpapi, apify, web). */
  provider?: string;
};

/**
 * Ingesta de Google Trends para UN término. Usa el orquestador de
 * proveedores (SerpApi → Apify → web). Guarda la serie diaria, las
 * regiones y los relacionados en sus tablas GT (dedupe por día,
 * re-ejecutable). Nunca lanza: cualquier fallo devuelve `ok=false` con razón.
 */
export async function runGtIngest(
  organizationId: string,
  termId: string,
  geo = "MX"
): Promise<GtIngestResult> {
  const db = getDb();
  const termRows = await db
    .select()
    .from(schema.intelTerm)
    .where(
      scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.id, termId))
    )
    .limit(1);
  const term = termRows[0];
  if (!term) {
    return { termId, ok: false, points: 0, regions: 0, related: 0, partial: false, reason: "Término no encontrado." };
  }

  const { getTrendsFromProviders } = await import("@/server/intel/trends-orchestrator");
  const orch = await getTrendsFromProviders(organizationId, [term.name], geo, "today 1-m");
  const data = orch.data;
  if (!data) {
    return {
      termId, ok: false, points: 0, regions: 0, related: 0, partial: false,
      reason: orch.error ?? "No hay proveedores de Google Trends configurados.",
    };
  }

  // Si SerpApi es el proveedor, traer regiones y relacionados (llamadas extra)
  let allRegions = data.regions;
  let allTopics = data.topics;
  let allQueries = data.queries;
  if (orch.provider === "serpapi" && data.timeSeries) {
    try {
      const creds = await getIntelCredentials(organizationId);
      if (creds?.serpapiKey) {
        const { fetchSerpApiRegions, fetchSerpApiRelated } = await import("@/server/intel/sources/serpapi-trends");
        const [regionsData, relatedData] = await Promise.all([
          fetchSerpApiRegions(creds.serpapiKey, term.name, geo),
          fetchSerpApiRelated(creds.serpapiKey, term.name, geo),
        ]);
        if (regionsData.length > 0) allRegions = regionsData;
        if (relatedData.topics.length > 0 || relatedData.queries.length > 0) {
          allTopics = relatedData.topics;
          allQueries = relatedData.queries;
        }
      }
    } catch {
      // Regiones/relacionados son opcionales: no fallar la ingesta por esto
    }
  }

  const day = utcDay();

  let points = 0;
  let regions = 0;
  let related = 0;

  if (data.timeSeries && data.timeSeries.points.length > 0) {
    const index = toIndex(data.timeSeries.points.map((p) => p.value));
    for (let i = 0; i < data.timeSeries.points.length; i++) {
      const p = data.timeSeries.points[i]!;
      // El timestamp de GT puede ser de días previos; convertimos a día UTC.
      const pointDay = utcDay(new Date(p.time));
      await db
        .insert(schema.intelGtSnapshot)
        .values({
          id: newId("intelGtSnapshot"),
          organizationId,
          termId,
          day: pointDay,
          value: index[i] ?? 0,
        })
        .onConflictDoUpdate({
          target: [schema.intelGtSnapshot.termId, schema.intelGtSnapshot.day],
          set: { value: index[i] ?? 0 },
        });
      points += 1;
    }
  }

  // Regiones: mapeamos geoCode de Google → clave INEGI (2 dígitos).
  // Google usa códigos como "MX-CMX", "MX-TAB", "09", "15", etc.
  const GOOGLE_TO_INEGI: Record<string, string> = {
    "MX-AGU": "01", "MX-BCN": "02", "MX-BCS": "03", "MX-CAM": "04",
    "MX-COH": "05", "MX-COL": "06", "MX-CHP": "07", "MX-CHH": "08",
    "MX-CMX": "09", "MX-DUR": "10", "MX-GUA": "11", "MX-GRO": "12",
    "MX-HID": "13", "MX-JAL": "14", "MX-MEX": "15", "MX-MIC": "16",
    "MX-MOR": "17", "MX-NAY": "18", "MX-NLE": "19", "MX-OAX": "20",
    "MX-PUE": "21", "MX-QUE": "22", "MX-ROO": "23", "MX-SLP": "24",
    "MX-SIN": "25", "MX-SON": "26", "MX-TAB": "27", "MX-TAM": "28",
    "MX-TLA": "29", "MX-VER": "30", "MX-YUC": "31", "MX-ZAC": "32",
  };
  for (const r of allRegions) {
    // Si es "MX-XXX", mapear; si ya es de 2 dígitos, usar directo
    const state = GOOGLE_TO_INEGI[r.geoCode] ?? (/^\d{2}$/.test(r.geoCode) ? r.geoCode : null);
    if (!state) continue;
    await db
      .insert(schema.intelGtRegion)
      .values({
        id: newId("intelGtRegion"),
        organizationId,
        termId,
        state,
        value: r.value,
        day,
      })
      .onConflictDoUpdate({
        target: [schema.intelGtRegion.termId, schema.intelGtRegion.state, schema.intelGtRegion.day],
        set: { value: r.value },
      });
    regions += 1;
  }

  // Relacionados (temas y consultas) — iteramos por separado para evitar
  // el identity check frágil `topics.includes(r)` que fallaba con clones.
  for (const r of allTopics) {
    const label = r.label.slice(0, 300);
    await db
      .insert(schema.intelGtRelated)
      .values({
        id: newId("intelGtRelated"),
        organizationId,
        termId,
        kind: "topic",
        label,
        value: r.value,
        pct: r.pct !== null ? Math.round(r.pct) : null,
        isBreakout: r.isBreakout,
        day,
      })
      .onConflictDoUpdate({
        target: [schema.intelGtRelated.termId, schema.intelGtRelated.kind, schema.intelGtRelated.label, schema.intelGtRelated.day],
        set: { value: r.value, pct: r.pct !== null ? Math.round(r.pct) : null, isBreakout: r.isBreakout },
      });
    related += 1;
  }
  for (const r of allQueries) {
    const label = r.label.slice(0, 300);
    await db
      .insert(schema.intelGtRelated)
      .values({
        id: newId("intelGtRelated"),
        organizationId,
        termId,
        kind: "query",
        label,
        value: r.value,
        pct: r.pct !== null ? Math.round(r.pct) : null,
        isBreakout: r.isBreakout,
        day,
      })
      .onConflictDoUpdate({
        target: [schema.intelGtRelated.termId, schema.intelGtRelated.kind, schema.intelGtRelated.label, schema.intelGtRelated.day],
        set: { value: r.value, pct: r.pct !== null ? Math.round(r.pct) : null, isBreakout: r.isBreakout },
      });
    related += 1;
  }

  return { termId, ok: points > 0 || regions > 0 || related > 0, points, regions, related, partial: data.partial, provider: orch.provider };
}

export type GtReport = {
  termId: string;
  termName: string;
  /** Serie GT 0–100 (máx de la ventana = 100). */
  series: Array<{ day: string; value: number }>;
  /** Fuente real de la serie (para el tooltip). Solo GT: sin fallback YouTube. */
  seriesSource: "google_trends" | "none";
  /** Regiones 0–100 (GT) o DENUE (fallback, normalizado). */
  regions: Array<{ state: string; index: number; source: "google_trends" | "denue" }>;
  regionsSource: "google_trends" | "denue" | "none";
  topics: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean }>;
  queries: Array<{ label: string; value: number; pct: number | null; isBreakout: boolean }>;
  /** true si GT no respondió y se usó fallback YouTube. */
  usedFallback: boolean;
  method: { fuente: string; ventana: string };
  generatedAt: string;
};

/**
 * Lee el reporte GT de un término desde la BD (lo que ya se ingirió).
 * Si GT está deshabilitado (checkbox de BD) o no tiene datos, cae a la serie
 * YouTube normalizada 0–100 (fallback declarado). Regiones: si GT no tiene,
 * usa DENUE normalizado.
 */
export async function getGtReport(
  organizationId: string,
  termId: string
): Promise<GtReport | null> {
  const db = getDb();
  const termRows = await db
    .select()
    .from(schema.intelTerm)
    .where(
      scoped(schema.intelTerm.organizationId, organizationId, eq(schema.intelTerm.id, termId))
    )
    .limit(1);
  const term = termRows[0];
  if (!term) return null;

  // Si GT está deshabilitado, no se leen las tablas GT: fallback directo.
  const creds = await getIntelCredentials(organizationId);
  const gtActive = creds?.gtEnabled ?? false;

  const end = utcDay();
  // Ventana de lectura: cubre la serie GT de 30 días.
  const start = addDays(end, -29);

  // Serie GT (solo si está habilitado). Sin fallback a YouTube: fuente 100 % externa.
  const gtRows = gtActive
    ? await db
        .select()
        .from(schema.intelGtSnapshot)
        .where(
          scoped(
            schema.intelGtSnapshot.organizationId,
            organizationId,
            eq(schema.intelGtSnapshot.termId, termId),
            gte(schema.intelGtSnapshot.day, start),
            lte(schema.intelGtSnapshot.day, end)
          )
        )
        .orderBy(schema.intelGtSnapshot.day)
    : [];

  let series: GtReport["series"] = [];
  let seriesSource: GtReport["seriesSource"] = "none";
  if (gtRows.length > 0) {
    series = gtRows.map((r) => ({ day: r.day, value: r.value }));
    seriesSource = "google_trends";
  }

  // Regiones GT (solo si está habilitado). La última lectura por estado gana
  // (orden ascendente sobre la ventana).
  const gtRegionRows = gtActive
    ? await db
        .select()
        .from(schema.intelGtRegion)
        .where(
          scoped(
            schema.intelGtRegion.organizationId,
            organizationId,
            eq(schema.intelGtRegion.termId, termId),
            gte(schema.intelGtRegion.day, start)
          )
        )
        .orderBy(schema.intelGtRegion.day)
    : [];

  let regions: GtReport["regions"] = [];
  let regionsSource: GtReport["regionsSource"] = "none";
  if (gtRegionRows.length > 0) {
    const byState = new Map<string, number>();
    for (const r of gtRegionRows) {
      byState.set(r.state, r.value);
    }
    regions = [...byState.entries()].map(([state, value]) => ({
      state,
      index: value,
      source: "google_trends" as const,
    }));
    regionsSource = "google_trends";
  }

  // Relacionados (solo si está habilitado). Ventana en SQL: el histórico
  // completo de un término popular puede ser enorme.
  const relatedRows = gtActive
    ? await db
        .select()
        .from(schema.intelGtRelated)
        .where(
          scoped(
            schema.intelGtRelated.organizationId,
            organizationId,
            eq(schema.intelGtRelated.termId, termId),
            gte(schema.intelGtRelated.day, start)
          )
        )
        .orderBy(desc(schema.intelGtRelated.day))
    : [];

  const topics = relatedRows
    .filter((r) => r.kind === "topic")
    .slice(0, 5)
    .map((r) => ({ label: r.label, value: r.value, pct: r.pct, isBreakout: r.isBreakout }));
  const queries = relatedRows
    .filter((r) => r.kind === "query")
    .slice(0, 5)
    .map((r) => ({ label: r.label, value: r.value, pct: r.pct, isBreakout: r.isBreakout }));

  // Sin fallback YouTube (la serie es 100 % GT): usedFallback es siempre
  // false. Antes marcaba true cuando NO había datos, lo cual invertía su
  // significado ("se usó el fallback") y habría mentido si la UI lo leyera.
  const usedFallback = false;

  // Determinar el proveedor basado en qué sincronización es más reciente
  let fuenteLabel = "Google Trends (sin datos)";
  if (creds?.serpapiLastSyncAt && (!creds.apifyLastSyncAt || creds.serpapiLastSyncAt > creds.apifyLastSyncAt)) {
    fuenteLabel = "Google Trends · SerpApi (índice 0–100)";
  } else if (creds?.apifyLastSyncAt) {
    fuenteLabel = "Google Trends · Apify (índice 0–100)";
  }

  return {
    termId,
    termName: term.name,
    series,
    seriesSource,
    regions,
    regionsSource,
    topics,
    queries,
    usedFallback,
    method: {
      fuente: fuenteLabel,
      ventana: "últimos 30 días",
    },
    generatedAt: new Date().toISOString(),
  };
}
