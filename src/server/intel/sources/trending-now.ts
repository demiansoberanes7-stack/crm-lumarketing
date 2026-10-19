/**
 * «Tendencias actuales» de Google Trends (búsquedas en tendencia ahora mismo).
 *
 * Es OTRA fuente que el explorador de nichos: ahí donde `google-trends.ts`
 * devuelve series e índices de un término, aquí se consulta qué se está buscando
 * en el país, con volumen, hora de inicio y el desglose que Google agrupa bajo
 * cada tendencia.
 *
 * Cadena de proveedores (regla de soberanía: siempre hay camino sin llave):
 *   1. SerpApi `google_trends_trending_now` → campos completos y fiables.
 *   2. RSS público `trends.google.com/trending/rss?geo=…` → gratis y sin API
 *      key; no publica % de alza ni tipo, así que esos campos quedan null.
 *
 * Nunca lanza: ante cualquier fallo devuelve `[]` y la UI muestra el aviso de
 * fuente no disponible. No se inventa ningún campo que la fuente no traiga.
 */

const TIMEOUT_MS = 12_000;

export type TrendingSource = "serpapi" | "rss";

export type TrendingItem = {
  title: string;
  /** Volumen aproximado; null si la fuente no lo publica. */
  volume: number | null;
  /** % de incremento; null si la fuente no lo publica. */
  increasePct: number | null;
  /** Epoch ms en que empezó la tendencia; null si no viene. */
  startedAt: number | null;
  active: boolean;
  category: string | null;
  /** "Breakout" | "Trending" | … null cuando la fuente no lo dice. */
  trendType: string | null;
  /** Desglose (consultas/temas que Google agrupa bajo la tendencia). */
  breakdown: Array<{ name: string; type?: string }>;
  source: TrendingSource;
};

/* ── Parseo defensivo (la forma exacta la decide el proveedor) ──────────── */

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec | null {
  return typeof v === "object" && v !== null ? (v as Rec) : null;
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d.-]/g, ""), 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** "100+", "10K+", "1,000", "2M" → entero. null si no es extraíble. */
export function parseVolume(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  const text = str(raw);
  if (!text) return null;
  const m = text.match(/([\d.,]+)\s*(k|m|b)?/i);
  if (!m) return null;
  const base = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (m[2] ?? "").toLowerCase();
  const factor = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
  return Math.round(base * factor);
}

/** Acepta epoch en segundos o en milisegundos y siempre devuelve ms. */
export function toEpochMs(raw: unknown): number | null {
  const n = num(raw);
  if (n === null || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

/** Primer nombre útil de una lista de categorías (objetos o strings). */
function firstCategory(raw: unknown): string | null {
  for (const entry of asArr(raw)) {
    const name = typeof entry === "string" ? entry : str(asRec(entry)?.name);
    if (name) return name.slice(0, 120);
  }
  return null;
}

/** Desglose: tolera `trend_breakdown` de objetos o strings sueltos. */
function parseBreakdown(raw: unknown): Array<{ name: string; type?: string }> {
  const out: Array<{ name: string; type?: string }> = [];
  for (const entry of asArr(raw)) {
    const rec = asRec(entry);
    const name = rec
      ? str(rec.trend_name) ?? str(rec.query) ?? str(rec.title) ?? str(rec.name)
      : typeof entry === "string"
        ? entry
        : null;
    if (!name) continue;
    const type = rec ? str(rec.type) : null;
    out.push(type ? { name: name.slice(0, 300), type } : { name: name.slice(0, 300) });
    if (out.length >= 50) break;
  }
  return out;
}

/* ── Proveedor 1: SerpApi ───────────────────────────────────────────────── */

/**
 * Lee `trending_searches[]` de SerpApi. `hours` ∈ {4, 24, 48, 168}.
 * Requiere el texto descifrado de la clave; quien la tenga cifra debe
 * `decryptSecret` antes de llamar (igual que el orquestador de tendencias).
 */
export async function fetchTrendingSerpApi(
  apiKey: string,
  geo = "MX",
  hours = 24
): Promise<TrendingItem[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_trends_trending_now");
  url.searchParams.set("geo", geo);
  url.searchParams.set("hours", String(hours));
  url.searchParams.set("hl", "es-MX");
  url.searchParams.set("api_key", apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const data = asRec(await res.json().catch(() => null));
  if (!data || typeof data.error === "string") return [];

  const out: TrendingItem[] = [];
  for (const raw of asArr(data.trending_searches)) {
    const e = asRec(raw);
    const title = e ? str(e.query) ?? str(e.title) : null;
    if (!e || !title) continue;
    out.push({
      title: title.slice(0, 300),
      volume: parseVolume(e.search_volume ?? e.formatted_traffic),
      increasePct: num(e.increase_percentage),
      startedAt: toEpochMs(e.start_timestamp ?? e.started_at),
      active: typeof e.active === "boolean" ? e.active : true,
      category: firstCategory(e.categories),
      trendType: str(e.type) ?? str(e.trend_type),
      breakdown: parseBreakdown(e.trend_breakdown),
      source: "serpapi",
    });
  }
  return out;
}

/* ── Proveedor 2: RSS público (sin API key) ─────────────────────────────── */

function pick(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? str(m[1]!.replace(/<!\[CDATA\[|\]\]>/g, "")) : null;
}

/** Feed público de tendencias: gratis, sin API key, sin % de alza ni tipo. */
export async function fetchTrendingRss(geo = "MX"): Promise<TrendingItem[]> {
  let res: Response;
  try {
    res = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const xml = await res.text().catch(() => "");
  if (!xml) return [];

  const out: TrendingItem[] = [];
  for (const block of xml.split(/<item\b/i).slice(1)) {
    const chunk = block.split(/<\/item>/i)[0] ?? "";
    const title = pick(chunk, "title");
    if (!title) continue;
    const pubDate = pick(chunk, "pubDate");
    const startedAt = pubDate ? Date.parse(pubDate) : NaN;
    // Cada `news_item` del feed es el desglose que Google muestra desplegado.
    const breakdown: Array<{ name: string; type?: string }> = [];
    for (const news of chunk.split(/<ht:news_item\b/i).slice(1)) {
      const headline = pick(news.split(/<\/ht:news_item>/i)[0] ?? "", "ht:news_item_title");
      if (!headline) continue;
      const outlet = pick(news, "ht:news_item_source");
      breakdown.push({ name: outlet ? `${headline} · ${outlet}` : headline, type: "news" });
      if (breakdown.length >= 10) break;
    }
    out.push({
      title: title.slice(0, 300),
      volume: parseVolume(pick(chunk, "ht:approx_traffic")),
      // El RSS no publica % de alza ni tipo: se dejan null, no se inventan.
      increasePct: null,
      startedAt: Number.isNaN(startedAt) ? null : startedAt,
      active: true,
      category: pick(chunk, "ht:category"),
      trendType: null,
      breakdown,
      source: "rss",
    });
  }
  return out;
}

/* ── Cadena de proveedores ──────────────────────────────────────────────── */

export type TrendingFetch = {
  items: TrendingItem[];
  source: TrendingSource | "none";
  error: string | null;
};

/**
 * SerpApi si hay clave; si no responde, RSS público. Nunca lanza.
 * `serpapiKey` debe venir ya descifrada (o ser null).
 */
export async function fetchTrendingNow(input: {
  serpapiKey: string | null;
  geo?: string;
  hours?: number;
}): Promise<TrendingFetch> {
  const geo = input.geo ?? "MX";
  const hours = input.hours ?? 24;

  if (input.serpapiKey) {
    const viaKey = await fetchTrendingSerpApi(input.serpapiKey, geo, hours);
    if (viaKey.length > 0) return { items: viaKey, source: "serpapi", error: null };
  }

  const viaRss = await fetchTrendingRss(geo);
  if (viaRss.length > 0) return { items: viaRss, source: "rss", error: null };

  return {
    items: [],
    source: "none",
    error: input.serpapiKey
      ? "SerpApi y el feed público de tendencias no devolvieron datos."
      : "El feed público de tendencias no devolvió datos.",
  };
}
