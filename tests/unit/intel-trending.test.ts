import { beforeEach, describe, expect, it, vi } from "vitest";
import { utcDay } from "@/server/intel/service";

/* ── Helpers puros del proveedor de tendencias ─────────────────────────── */

describe("parseVolume", () => {
  it("entiende las formas que publica Google", async () => {
    const { parseVolume } = await import("@/server/intel/sources/trending-now");
    expect(parseVolume("100+")).toBe(100);
    expect(parseVolume("1,000")).toBe(1000);
    expect(parseVolume("10K+")).toBe(10_000);
    expect(parseVolume("2M")).toBe(2_000_000);
    expect(parseVolume("  500+  ")).toBe(500);
    expect(parseVolume(1234.6)).toBe(1235);
  });

  it("devuelve null en vez de inventar un volumen", async () => {
    const { parseVolume } = await import("@/server/intel/sources/trending-now");
    expect(parseVolume(null)).toBeNull();
    expect(parseVolume("")).toBeNull();
    expect(parseVolume("sin dato")).toBeNull();
    expect(parseVolume(Number.NaN)).toBeNull();
  });
});

describe("toEpochMs", () => {
  it("acepta segundos y milisegundos y siempre devuelve ms", async () => {
    const { toEpochMs } = await import("@/server/intel/sources/trending-now");
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs("1700000000")).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs("0")).toBeNull();
    expect(toEpochMs(-5)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
  });
});

/* ── Proveedores con fetch simulado ─────────────────────────────────────── */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getIntelCredentials: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/server/intel/credentials", () => ({
  getIntelCredentials: mocks.getIntelCredentials,
}));

/** Cadena de Drizzle simulada: cualquier select() resuelve la cola de filas. */
function chain(rows: unknown[]) {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy"]) {
    query[method] = () => query;
  }
  query.limit = () => Promise.resolve(rows);
  (query as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return query;
}

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => null, text: async () => body } as unknown as Response;
}

/** fetch simulado que además deja inspeccionar la URL pedida. */
type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>;
function spyFetch(reply: (url: string) => Response): ReturnType<typeof vi.fn<FetchImpl>> {
  return vi.fn<FetchImpl>(async (input) => reply(String(input)));
}

const SERPAPI_TRENDING = {
  trending_searches: [
    {
      query: "final liga mx",
      search_volume: "100K+",
      increase_percentage: "300",
      start_timestamp: 1_700_000_000,
      active: true,
      categories: [{ name: "Deportes" }],
      type: "Trending",
      trend_breakdown: [{ trend_name: "final mexico hoy", type: "QUERY" }],
    },
    { query: "", search_volume: "500+" },
    { query: "sin breakdown", trend_breakdown: "no-es-arreglo" },
  ],
};

const RSS_TRENDING = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[clima cdmx]]></title>
    <ht:approx_traffic>5,000+</ht:approx_traffic>
    <pubDate>Tue, 07 Oct 2026 14:00:00 GMT</pubDate>
    <ht:category>Clima</ht:category>
    <ht:news_item><ht:news_item_title>Lloverá por la tarde</ht:news_item_title><ht:news_item_source>El Universal</ht:news_item_source></ht:news_item>
    <ht:news_item><ht:news_item_title>Alerta por calor</ht:news_item_title></ht:news_item>
  </item>
  <item><title><![CDATA[]]></title><ht:approx_traffic>100+</ht:approx_traffic></item>
</channel></rss>`;

describe("fetchTrendingSerpApi", () => {
  it("mapea los campos reales y descarta filas sin título", async () => {
    const fetchMock = spyFetch(() => jsonResponse(SERPAPI_TRENDING));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchTrendingSerpApi } = await import("@/server/intel/sources/trending-now");
    const items = await fetchTrendingSerpApi("clave", "MX", 24);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "final liga mx",
      volume: 100_000,
      increasePct: 300,
      startedAt: 1_700_000_000_000,
      category: "Deportes",
      trendType: "Trending",
      source: "serpapi",
    });
    expect(items[0]!.breakdown).toEqual([{ name: "final mexico hoy", type: "QUERY" }]);
    // La cadena pedida tiene que ir en el request, o la ventana filtrada miente.
    expect(String(fetchMock.mock.calls[0]![0])).toContain("engine=google_trends_trending_now");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("hours=24");
    vi.unstubAllGlobals();
  });

  it("un error del proveedor devuelve [] y no lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "invalid api key" }, false)));
    const { fetchTrendingSerpApi } = await import("@/server/intel/sources/trending-now");
    await expect(fetchTrendingSerpApi("clave")).resolves.toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("red caída"); }));
    await expect(fetchTrendingSerpApi("clave")).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("fetchTrendingRss", () => {
  it("lee el feed sin API key y deja null lo que Google no publica", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(RSS_TRENDING)));
    const { fetchTrendingRss } = await import("@/server/intel/sources/trending-now");
    const items = await fetchTrendingRss("MX");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "clima cdmx",
      volume: 5000,
      category: "Clima",
      source: "rss",
      // Regla 3: sin % de alza ni tipo en el RSS → null, no un cero inventado.
      increasePct: null,
      trendType: null,
      active: true,
    });
    expect(items[0]!.startedAt).toBe(Date.parse("Tue, 07 Oct 2026 14:00:00 GMT"));
    expect(items[0]!.breakdown).toEqual([
      { name: "Lloverá por la tarde · El Universal", type: "news" },
      { name: "Alerta por calor", type: "news" },
    ]);
    vi.unstubAllGlobals();
  });

  it("HTML basura o 403 no rompen la ingesta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("<html>Blocked</html>", false)));
    const { fetchTrendingRss } = await import("@/server/intel/sources/trending-now");
    await expect(fetchTrendingRss("MX")).resolves.toEqual([]);
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("<html>Blocked</html>")));
    await expect(fetchTrendingRss("MX")).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("cadena de proveedores de tendencias", () => {
  it("usa SerpApi cuando hay clave y responde", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(SERPAPI_TRENDING)));
    const { fetchTrendingNow } = await import("@/server/intel/sources/trending-now");
    const out = await fetchTrendingNow({ serpapiKey: "clave" });
    expect(out.source).toBe("serpapi");
    expect(out.items).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("degrada al feed público cuando SerpApi falla", async () => {
    let first = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (first) { first = false; return jsonResponse({ error: "quota" }, false); }
      return textResponse(RSS_TRENDING);
    }));
    const { fetchTrendingNow } = await import("@/server/intel/sources/trending-now");
    const out = await fetchTrendingNow({ serpapiKey: "clave" });
    expect(out.source).toBe("rss");
    expect(out.items[0]!.title).toBe("clima cdmx");
    vi.unstubAllGlobals();
  });

  it("sin clave el único camino es el feed público (sovereignty: siempre hay ruta sin llave)", async () => {
    const fetchMock = spyFetch(() => textResponse(RSS_TRENDING));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchTrendingNow } = await import("@/server/intel/sources/trending-now");
    const out = await fetchTrendingNow({ serpapiKey: null });
    expect(out.source).toBe("rss");
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("trends.google.com/trending/rss"),
    ]);
    vi.unstubAllGlobals();
  });

  it("cuando ninguna fuente responde, source=none con aviso honesto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("", false)));
    const { fetchTrendingNow } = await import("@/server/intel/sources/trending-now");
    const withKey = await fetchTrendingNow({ serpapiKey: "clave" });
    expect(withKey).toMatchObject({ items: [], source: "none" });
    expect(withKey.error).toContain("SerpApi");
    const withoutKey = await fetchTrendingNow({ serpapiKey: null });
    expect(withoutKey.error).not.toContain("SerpApi");
    vi.unstubAllGlobals();
  });
});

/* ── runTrendingIngest / getTrending ────────────────────────────────────── */

describe("runTrendingIngest", () => {
  let inserted: unknown[] = [];

  beforeEach(() => {
    inserted = [];
    mocks.getDb.mockReturnValue({
      select: () => chain([]),
      insert: () => ({
        values: (v: unknown) => {
          inserted.push(v);
          return { onConflictDoUpdate: () => Promise.resolve() };
        },
      }),
    });
  });

  it("sin filas de la fuente no escribe nada y lo reporta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("", false)));
    mocks.getIntelCredentials.mockResolvedValue({ serpapiKey: null });
    const { runTrendingIngest } = await import("@/server/intel/trending");
    const out = await runTrendingIngest("org_1");
    expect(out).toMatchObject({ ok: false, rows: 0, source: "none" });
    expect(inserted).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("upsertea una fila por tendencia con el día UTC y su fuente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse(RSS_TRENDING)));
    mocks.getIntelCredentials.mockResolvedValue({ serpapiKey: null });
    const { runTrendingIngest } = await import("@/server/intel/trending");
    const out = await runTrendingIngest("org_1", "MX", 24);
    expect(out).toMatchObject({ ok: true, rows: 1, source: "rss" });
    expect(inserted).toHaveLength(1);

    const values = inserted[0] as Record<string, unknown>;
    expect(values).toMatchObject({
      organizationId: "org_1",
      geo: "MX",
      day: utcDay(),
      title: "clima cdmx",
      volume: 5000,
      source: "rss",
    });
    expect(values.increasePct).toBeNull();
    vi.unstubAllGlobals();
  });
});

function trendingRow(over: Record<string, unknown>) {
  return {
    id: "itd_1",
    organizationId: "org_1",
    geo: "MX",
    day: utcDay(),
    title: "fila",
    volume: 100,
    increasePct: null,
    startedAt: new Date(),
    active: true,
    category: null,
    trendType: null,
    breakdown: [],
    source: "rss",
    createdAt: new Date(),
    ...over,
  };
}

describe("getTrending", () => {
  beforeEach(() => {
    mocks.getDb.mockReturnValue({ select: () => chain([]) });
  });

  it("sin datos devuelve vista vacía y facetas vacías", async () => {
    const { getTrending } = await import("@/server/intel/trending");
    const view = await getTrending("org_1", {});
    expect(view).toMatchObject({ rows: [], total: 0, geo: "MX", hours: 24, source: null });
    expect(view.categories).toEqual([]);
  });

  it("normaliza la ventana pedida y la geografía", async () => {
    const { getTrending } = await import("@/server/intel/trending");
    const view = await getTrending("org_1", { hours: 7, geo: "us" });
    // 7 h no es una ventana publicada: se cae a 24 en vez de inventar un filtro.
    expect(view.hours).toBe(24);
    expect(view.geo).toBe("US");
  });

  it("descarta tendencias fuera de la ventana por su hora de inicio", async () => {
    const now = Date.now();
    mocks.getDb.mockReturnValue({
      select: () =>
        chain([
          trendingRow({ id: "itd_new", title: "reciente", startedAt: new Date(now - 3600_000) }),
          trendingRow({ id: "itd_old", title: "de hace 3 días", startedAt: new Date(now - 72 * 3600_000) }),
        ]),
    });
    const { getTrending } = await import("@/server/intel/trending");
    const view = await getTrending("org_1", { hours: 24 });
    expect(view.rows.map((r) => r.title)).toEqual(["reciente"]);
  });

  it("conserva las filas sin hora de inicio si su día cae en la ventana", async () => {
    mocks.getDb.mockReturnValue({
      select: () => chain([trendingRow({ id: "itd_nohour", title: "sin hora", startedAt: null })]),
    });
    const { getTrending } = await import("@/server/intel/trending");
    const view = await getTrending("org_1", { hours: 4 });
    expect(view.rows).toHaveLength(1);
  });

  it("ordena por volumen y por alza, y separa las fuentes mixtas", async () => {
    mocks.getDb.mockReturnValue({
      select: () =>
        chain([
          trendingRow({ id: "a", title: "bajo", volume: 200, increasePct: 50, source: "rss" }),
          trendingRow({ id: "b", title: "alto", volume: 9000, increasePct: 10, source: "serpapi" }),
          trendingRow({ id: "c", title: "sin volumen", volume: null, increasePct: 500, source: "serpapi" }),
        ]),
    });
    const { getTrending } = await import("@/server/intel/trending");

    const byVolume = await getTrending("org_1", { sort: "volume" });
    expect(byVolume.rows.map((r) => r.title)).toEqual(["alto", "bajo", "sin volumen"]);
    expect(byVolume.source).toBe("mixta");

    const byIncrease = await getTrending("org_1", { sort: "increase" });
    expect(byIncrease.rows.map((r) => r.title)).toEqual(["sin volumen", "bajo", "alto"]);

    const generic = await getTrending("org_1", { sort: "lo-que-sea" });
    expect(generic.rows.map((r) => r.title)).toEqual(["alto", "bajo", "sin volumen"]);
  });

  it("filtra por categoría, tipo y texto y reporta las facetas de la ventana", async () => {
    mocks.getDb.mockReturnValue({
      select: () =>
        chain([
          trendingRow({ id: "a", title: "Final Liga MX", category: "Deportes", trendType: "Trending", breakdown: [{ name: "x" }] }),
          trendingRow({ id: "b", title: "Clima CDMX", category: "Clima", trendType: "Breakout" }),
          trendingRow({ id: "c", title: "Otro deporte", category: "Deportes", trendType: "Trending" }),
        ]),
    });
    const { getTrending } = await import("@/server/intel/trending");

    const all = await getTrending("org_1", {});
    expect(all.categories).toEqual(["Clima", "Deportes"]);
    expect(all.types).toEqual(["Breakout", "Trending"]);
    expect(all.total).toBe(3);

    const sports = await getTrending("org_1", { category: "Deportes" });
    expect(sports.rows.map((r) => r.id)).toEqual(["a", "c"]);

    const breakouts = await getTrending("org_1", { type: "Breakout" });
    expect(breakouts.rows.map((r) => r.id)).toEqual(["b"]);

    const search = await getTrending("org_1", { q: "liga" });
    expect(search.rows.map((r) => r.id)).toEqual(["a"]);
    expect(search.rows[0]!.breakdown).toEqual([{ name: "x" }]);
  });
});

/* ── list / dedupe de temas y consultas relacionadas ────────────────────── */

describe("getGtReport separa Principal y Subiendo", () => {
  beforeEach(() => {
    mocks.getIntelCredentials.mockResolvedValue({ gtEnabled: true });
  });

  it("conserva las dos listas y deduplica por (list,label)", async () => {
    // Simulación mínima: 4 selects en orden (term, snapshots, regions, related).
    const related = [
      { kind: "topic", label: "monitor 144hz", value: 100, pct: null, isBreakout: false, list: "top", day: utcDay() },
      { kind: "topic", label: "monitor 144hz", value: 90, pct: null, isBreakout: false, list: "top", day: "2026-10-01" },
      { kind: "topic", label: "monitor 144hz", value: 0, pct: 400, isBreakout: false, list: "rising", day: utcDay() },
      { kind: "topic", label: "rtx 4060", value: 0, pct: null, isBreakout: true, list: "rising", day: utcDay() },
      { kind: "query", label: "mejor pc para jugar", value: 85, pct: null, isBreakout: false, list: "top", day: utcDay() },
      { kind: "topic", label: "lista vieja", value: 1, pct: null, isBreakout: false, list: "", day: utcDay() },
    ];
    let call = 0;
    mocks.getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => {
            call += 1;
            const rows = call === 1
              ? [{ id: "term_1", name: "pc gamer", organizationId: "org_1" }]
              : call === 4
                ? related
                : [];
            const box: Record<string, unknown> = {
              limit: () => Promise.resolve(rows),
              orderBy: () => Promise.resolve(rows),
            };
            box.then = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
            return box;
          },
        }),
      }),
    });

    const { getGtReport } = await import("@/server/intel/service");
    const report = await getGtReport("org_1", "term_1");

    expect(report).not.toBeNull();
    expect(report!.topics.map((t) => `${t.list}:${t.label}`)).toEqual([
      "top:monitor 144hz",
      "rising:monitor 144hz",
      "rising:rtx 4060",
      // list vacío cae a «top», nunca desaparece del catálogo.
      "top:lista vieja",
    ]);
    expect(report!.queries).toHaveLength(1);
    expect(report!.queries[0]).toMatchObject({ label: "mejor pc para jugar", list: "top", value: 85 });
    // El duplicado del mismo tema en dos días no desdobla la fila.
    expect(report!.topics.filter((t) => t.list === "top" && t.label === "monitor 144hz")).toHaveLength(1);
  });
});
