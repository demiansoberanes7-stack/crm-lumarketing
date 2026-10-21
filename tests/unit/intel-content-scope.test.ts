import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * «Contenido que funciona» con una búsqueda activa: la muestra de YouTube del
 * nicho monitoreado NO se oculta, se acota a los videos que mencionan la
 * consulta. Lo que no menciona queda fuera de los KPIs, y el panel puede decir
 * «0 de 2» en vez de fingir que no hay datos.
 */

const videos = [
  {
    videoId: "vid_cam",
    termId: "itr_cam",
    title: "Las 5 mejores CÁMARAS DE SEGURIDAD para casa 2026",
    views: "5000",
    likes: "250",
    durationSeconds: 620,
    channelTitle: "TecSeguridad",
    day: "2026-10-18",
  },
  {
    videoId: "vid_phone",
    termId: "itr_phone",
    title: "review del iphone 15 pro: ¿vale la pena?",
    views: "9000",
    likes: "900",
    durationSeconds: 480,
    channelTitle: "GamerMX",
    day: "2026-10-19",
  },
];

const terms = [
  { id: "itr_cam", name: "Cámaras de seguridad" },
  { id: "itr_phone", name: "Smartphones" },
];

const h = vi.hoisted(() => {
  const state = { selects: [] as unknown[][] };
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
  return { state, db: { select: () => chain(state.selects.shift() ?? []) } };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: () => h.db,
}));

beforeEach(() => {
  h.state.selects.length = 0;
  // 1.ª lectura: la muestra de videos. 2.ª: los nombres del catálogo.
  h.state.selects.push(videos, terms);
});

describe("getContentInsights acotado a la consulta", () => {
  it("sin consulta analiza la muestra completa (comportamiento de siempre)", async () => {
    const { getContentInsights } = await import("@/server/intel/content");
    const res = await getContentInsights("org_1", 30);
    expect(res.query).toBeNull();
    expect(res.uniqueVideos).toBe(2);
    expect(res.matchedVideos).toBe(2);
    expect(res.top.map((v) => v.videoId)).toEqual(["vid_phone", "vid_cam"]);
    expect(res.termStats).toHaveLength(2);
  });

  it("con consulta los KPIs solo cuentan los videos que la mencionan", async () => {
    const { getContentInsights } = await import("@/server/intel/content");
    const res = await getContentInsights("org_1", 30, "camara de seguridad");
    expect(res.query).toBe("camara de seguridad");
    // El total de la muestra se conserva: es lo que permite decir «1 de 2».
    expect(res.uniqueVideos).toBe(2);
    expect(res.matchedVideos).toBe(1);
    expect(res.top.map((v) => v.videoId)).toEqual(["vid_cam"]);
    expect(res.durationStats.reduce((a, s) => a + s.count, 0)).toBe(1);
    expect(res.patternStats.reduce((a, s) => a + s.count, 0)).toBe(1);
    expect(res.termStats.map((t) => t.termId)).toEqual(["itr_cam"]);
  });

  it("recorta la consulta, y si nada la menciona devuelve muestra vacía sin inventar", async () => {
    const { getContentInsights } = await import("@/server/intel/content");
    const res = await getContentInsights("org_1", 30, "   panel solar   ");
    expect(res.query).toBe("panel solar");
    expect(res.matchedVideos).toBe(0);
    expect(res.top).toEqual([]);
    expect(res.durationStats).toEqual([]);
    expect(res.termStats).toEqual([]);
    expect(res.uniqueVideos).toBe(2);
  });
});
