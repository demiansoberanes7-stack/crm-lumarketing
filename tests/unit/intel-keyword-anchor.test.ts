import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El análisis de una búsqueda NUNCA puede mostrarse con los datos cacheados de
 * otro nicho (queja del usuario: buscar «redes sociales» enseñaba la serie de
 * «Redes y conectividad»). El nicho solo aparece anidado y etiquetado.
 */

const termRows = [
  {
    id: "itr_red",
    name: "Redes y conectividad",
    keywords: ["router", "switch de red", "wifi", "redes"],
    geo: "MX",
    active: true,
  },
];

const h = vi.hoisted(() => {
  const state = {
    selects: [] as unknown[][],
    denueCalls: [] as string[][],
  };
  function chain(rows: unknown[]) {
    const proxy: unknown = new Proxy(Promise.resolve(rows), {
      get(target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const fn = Reflect.get(target, prop);
          return typeof fn === "function" ? fn.bind(target) : fn;
        }
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        return () => proxy;
      },
    });
    return proxy;
  }
  return {
    state,
    db: {
      select: () => chain(state.selects.shift() ?? []),
      insert: () => chain([]),
    },
  };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: () => h.db,
}));

vi.mock("@/server/intel/credentials", () => ({
  getIntelCredentials: async () => ({ denueToken: "tok_denue", gtEnabled: true }),
}));

vi.mock("@/server/intel/sources/denue", () => ({
  countEstablishments: async (_token: string, keywords: string[]) => {
    h.state.denueCalls.push(keywords);
    return { count: 7, censored: false };
  },
}));

vi.mock("@/server/intel/sources/suggest", () => ({
  fetchSuggestions: async () => [],
}));

const LIVE_SERIES = [
  { time: Date.parse("2026-10-10"), value: 10 },
  { time: Date.parse("2026-10-11"), value: 20 },
  { time: Date.parse("2026-10-12"), value: 90 },
];

vi.mock("@/server/intel/trends-orchestrator", () => ({
  getTrendsFromProviders: async () => ({
    provider: "serpapi",
    sourceLabel: "Google Trends · Serpapi (en vivo)",
    data: {
      timeSeries: { points: LIVE_SERIES },
      regions: [],
      topics: [{ title: "redes sociales" }],
      queries: [],
      partial: false,
    },
  }),
}));

beforeEach(() => {
  h.state.selects.length = 0;
  h.state.denueCalls.length = 0;
});

/** El catálogo se lee dos veces: para el término y para las relacionadas. */
function queueCatalog(...extra: unknown[][]) {
  h.state.selects.push(termRows, termRows, ...extra);
}

describe("analyzeKeyword ancla los datos a la consulta", () => {
  it("usa el proveedor en vivo aunque el nicho coincida, y anida su serie", async () => {
    queueCatalog(
      [{ termId: "itr_red", day: "2026-10-12", value: 5 }],
      Array.from({ length: 8 }, (_, i) => ({
        termId: "itr_red",
        day: `2026-10-${String(i + 5).padStart(2, "0")}`,
        value: 40 + i,
      }))
    );
    const { analyzeKeyword } = await import("@/server/intel/keyword");
    const res = await analyzeKeyword("org_1", "redes y conectividad");

    expect(res.market?.sourceLabel).toBe("Google Trends · Serpapi (en vivo)");
    expect(res.market?.provider).not.toBe("catalog");
    expect(res.market?.series.at(-1)?.value).toBe(100);

    // El nicho aparece como bloque propio, con su similitud declarada.
    expect(res.tracked?.termId).toBe("itr_red");
    expect(res.tracked?.matchScore).toBeGreaterThanOrEqual(0.6);
    expect(res.tracked?.seriesPoints.length).toBeGreaterThan(0);
    // Y el catálogo completo llega a la pantalla para etiquetar cada panel.
    expect(res.catalogMatches[0]).toMatchObject({
      termId: "itr_red",
      score: 1,
      via: "Redes y conectividad",
      exact: true,
    });
  });

  it("no hereda el nicho cuando la búsqueda es otro tema", async () => {
    queueCatalog();
    const { analyzeKeyword } = await import("@/server/intel/keyword");
    const res = await analyzeKeyword("org_1", "celulares samsung");

    expect(res.tracked).toBeNull();
    // Sin nicho, la oferta local se mide con la consulta tal cual.
    expect(h.state.denueCalls.at(-1)).toEqual(["celulares samsung"]);
    // El catálogo no se omite: se declara sin palabras en común.
    expect(res.catalogMatches).toEqual([
      {
        termId: "itr_red",
        name: "Redes y conectividad",
        keywords: ["router", "switch de red", "wifi", "redes"],
        score: 0,
        via: "",
        exact: false,
      },
    ]);
  });

  it("un vecino parcial llega etiquetado, sin heredar el nicho", async () => {
    queueCatalog();
    const { analyzeKeyword } = await import("@/server/intel/keyword");
    const res = await analyzeKeyword("org_1", "redes sociales");

    expect(res.tracked).toBeNull();
    expect(res.catalogMatches).toEqual([
      {
        termId: "itr_red",
        name: "Redes y conectividad",
        keywords: ["router", "switch de red", "wifi", "redes"],
        score: 0.5,
        via: "redes",
        exact: false,
      },
    ]);
  });

  it("mide la dificultad con la consulta, no con las keywords del nicho", async () => {
    queueCatalog([], []);
    const { analyzeKeyword } = await import("@/server/intel/keyword");
    const res = await analyzeKeyword("org_1", "wifi");

    expect(res.tracked?.name).toBe("Redes y conectividad");
    expect(h.state.denueCalls.at(-1)).toEqual(["wifi"]);
  });
});
