import { desc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getIntelCredentials } from "@/server/intel/credentials";
import { utcDay } from "@/server/intel/service";
import { fetchTrendingNow } from "@/server/intel/sources/trending-now";

/**
 * Servicio de «Tendencias actuales».
 *
 * La ingesta y la lectura van separadas a propósito (igual que el resto del
 * módulo): «Actualizar datos» escribe en la BD y la página lee siempre de la
 * BD, así que abrir Inteligencia no gasta cuota ni depende de que Google
 * responda en el momento.
 */

export type TrendingIngestResult = {
  ok: boolean;
  rows: number;
  source: string;
  reason?: string;
};

/** Escribe las tendencias del día. Re-ejecutable: upsert por (org, geo, día, título). */
export async function runTrendingIngest(
  organizationId: string,
  geo = "MX",
  hours = 24
): Promise<TrendingIngestResult> {
  const creds = await getIntelCredentials(organizationId);
  const fetched = await fetchTrendingNow({ serpapiKey: creds?.serpapiKey ?? null, geo, hours });
  if (fetched.items.length === 0) {
    return {
      ok: false,
      rows: 0,
      source: fetched.source,
      reason: fetched.error ?? "Sin tendencias.",
    };
  }

  const db = getDb();
  const day = utcDay();
  let rows = 0;
  for (const item of fetched.items) {
    await db
      .insert(schema.intelGtTrending)
      .values({
        id: newId("intelGtTrending"),
        organizationId,
        geo,
        day,
        title: item.title,
        volume: item.volume,
        increasePct: item.increasePct !== null ? Math.round(item.increasePct) : null,
        startedAt: item.startedAt !== null ? new Date(item.startedAt) : null,
        active: item.active,
        category: item.category,
        trendType: item.trendType,
        breakdown: item.breakdown.length ? item.breakdown : null,
        source: item.source,
      })
      .onConflictDoUpdate({
        target: [
          schema.intelGtTrending.organizationId,
          schema.intelGtTrending.geo,
          schema.intelGtTrending.day,
          schema.intelGtTrending.title,
        ],
        set: {
          volume: item.volume,
          increasePct: item.increasePct !== null ? Math.round(item.increasePct) : null,
          startedAt: item.startedAt !== null ? new Date(item.startedAt) : null,
          active: item.active,
          category: item.category,
          trendType: item.trendType,
          breakdown: item.breakdown.length ? item.breakdown : null,
          source: item.source,
        },
      });
    rows += 1;
  }

  return { ok: rows > 0, rows, source: fetched.source };
}

/* ── Lectura para la UI ─────────────────────────────────────────────────── */

export type TrendingSort = "relevance" | "volume" | "increase" | "recent";

export type TrendingRow = {
  id: string;
  title: string;
  volume: number | null;
  increasePct: number | null;
  startedAt: string | null;
  active: boolean;
  category: string | null;
  trendType: string | null;
  breakdown: Array<{ name: string; type?: string }>;
  source: string;
};

export type TrendingView = {
  rows: TrendingRow[];
  /** Filas que pasaron TODOS los filtros del servidor (ventana, facetas, texto). */
  total: number;
  hours: number;
  geo: string;
  categories: string[];
  types: string[];
  lastIngestAt: string | null;
  /** Fuente real de las filas en pantalla (serpapi | rss | null). */
  source: string | null;
};

const HOURS_ALLOWED = new Set([4, 24, 48, 168]);

function clampHours(raw: number | null | undefined): number {
  const n = Number(raw ?? 24);
  return HOURS_ALLOWED.has(n) ? n : 24;
}

/**
 * Lee las tendencias ya ingeridas de la ventana pedida. `hours` filtra por
 * `started_at` cuando la fuente lo publicó; las filas sin hora de inicio solo
 * entran si su día cae dentro de la ventana (nunca se descarta dato real por
 * no tener un campo opcional).
 */
export async function getTrending(
  organizationId: string,
  params: {
    geo?: string | null;
    hours?: number | null;
    category?: string | null;
    type?: string | null;
    q?: string | null;
    sort?: string | null;
  }
): Promise<TrendingView> {
  const geo = (params.geo ?? "MX").slice(0, 2).toUpperCase() || "MX";
  const hours = clampHours(params.hours);
  const category = params.category?.trim() || null;
  const type = params.type?.trim() || null;
  const q = params.q?.trim().toLowerCase() || null;
  const sort: TrendingSort =
    params.sort === "volume" || params.sort === "increase" || params.sort === "recent"
      ? params.sort
      : "relevance";

  const now = Date.now();
  const cutoff = now - hours * 3600 * 1000;
  const dayCutoff = utcDay(new Date(cutoff));
  const today = utcDay();

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.intelGtTrending)
    .where(
      scoped(
        schema.intelGtTrending.organizationId,
        organizationId,
        eq(schema.intelGtTrending.geo, geo),
        gte(schema.intelGtTrending.day, dayCutoff),
        lte(schema.intelGtTrending.day, today)
      )
    )
    .orderBy(desc(schema.intelGtTrending.volume));

  const keep = (r: (typeof rows)[number]): boolean => {
    if (r.startedAt) {
      if (r.startedAt.getTime() < cutoff) return false;
    } else if (r.day < dayCutoff) {
      return false;
    }
    if (category && r.category !== category) return false;
    if (type && r.trendType !== type) return false;
    if (q && !r.title.toLowerCase().includes(q)) return false;
    return true;
  };

  const matched = rows.filter(keep);

  const sorted = [...matched].sort((a, b) => {
    if (sort === "recent") return (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0);
    if (sort === "increase") return (b.increasePct ?? -1) - (a.increasePct ?? -1);
    const byVolume = (b.volume ?? -1) - (a.volume ?? -1);
    if (sort === "volume") return byVolume;
    // relevancia: volumen y, a igualdad, alza reciente
    const byStart = (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0);
    const byIncrease = (b.increasePct ?? -1) - (a.increasePct ?? -1);
    return byVolume || byIncrease || byStart;
  });

  const toRow = (r: (typeof rows)[number]): TrendingRow => ({
    id: r.id,
    title: r.title,
    volume: r.volume,
    increasePct: r.increasePct,
    startedAt: r.startedAt?.toISOString() ?? null,
    active: r.active,
    category: r.category,
    trendType: r.trendType,
    breakdown: Array.isArray(r.breakdown) ? r.breakdown : [],
    source: r.source,
  });

  // Facetas del menú de filtros: lo que hay en la ventana, no una lista fija.
  const categories = [...new Set(matched.map((r) => r.category).filter((c): c is string => !!c))].sort();
  const types = [...new Set(matched.map((r) => r.trendType).filter((c): c is string => !!c))].sort();
  const newest = matched.reduce<Date | null>(
    (acc, r) => (!acc || r.createdAt > acc ? r.createdAt : acc),
    null
  );
  const sources = new Set(matched.map((r) => r.source));

  return {
    rows: sorted.map(toRow),
    total: sorted.length,
    hours,
    geo,
    categories,
    types,
    lastIngestAt: newest?.toISOString() ?? null,
    source: sources.size === 1 ? [...sources][0]! : sources.size > 1 ? "mixta" : null,
  };
}
