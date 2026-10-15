import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeApifyItems, runApifyActor } from "@/server/intel/sources/apify-trends";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();

describe("runApifyActor — seguridad y timeout del polling", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("manda el token en Authorization y JAMÁS en la URL", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run_1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "SUCCEEDED" } }))
      .mockResolvedValueOnce(jsonResponse([{ date: "2025-01-01", value: 10 }]));

    const items = await runApifyActor("secreto-apify", "user/actor", ["kw"]);
    expect(items).toHaveLength(1);

    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(String(url)).not.toContain("secreto-apify");
      expect(init.headers).toMatchObject({ Authorization: "Bearer secreto-apify" });
    }
  });

  it("si el run nunca llega a SUCCEEDED devuelve null SIN leer el dataset", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/dataset/items")) {
        throw new Error("no debe leerse el dataset de un run sin SUCCEEDED");
      }
      if (String(url).endsWith("/runs")) return jsonResponse({ data: { id: "run_1" } });
      return jsonResponse({ data: { status: "RUNNING" } });
    });

    const promise = runApifyActor("token", "user~actor", ["kw"]);
    await vi.advanceTimersByTimeAsync(61_000);
    const result = await promise;

    expect(result).toBeNull();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/dataset/items"))).toBe(false);
  });

  it("un run FAILED corta de inmediato", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run_1" } }))
      .mockResolvedValueOnce(jsonResponse({ data: { status: "FAILED" } }));

    const result = await runApifyActor("token", "user~actor", ["kw"]);
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("Apify normalización", () => {
  it("devuelve vacío con partial=true si no hay items", () => {
    const result = normalizeApifyItems([]);
    expect(result.timeSeries).toBeNull();
    expect(result.regions).toEqual([]);
    expect(result.topics).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.provider).toBe("apify");
  });

  it("normaliza items planos (date+value) a serie temporal", () => {
    const items = [
      { date: "2025-01-01", value: 45 },
      { date: "2025-01-02", value: 52 },
      { date: "2025-01-03", value: 38 },
    ];
    const result = normalizeApifyItems(items);
    expect(result.timeSeries).not.toBeNull();
    expect(result.timeSeries!.points).toHaveLength(3);
    expect(result.timeSeries!.points[0]!.value).toBe(45);
    expect(result.timeSeries!.average).toBeCloseTo(45, 1);
    expect(result.partial).toBe(true); // sin regiones ni related
  });

  it("normaliza timestamp numérico en items planos", () => {
    const items = [
      { timestamp: 1735689600000, value: 70 },
      { timestamp: 1735776000000, value: 80 },
    ];
    const result = normalizeApifyItems(items);
    expect(result.timeSeries).not.toBeNull();
    expect(result.timeSeries!.points).toHaveLength(2);
    expect(result.timeSeries!.points[0]!.time).toBe(1735689600000);
  });

  it("soporta valor string numérico", () => {
    const items = [
      { date: "2025-01-01", value: "55" },
      { date: "2025-01-02", value: "60" },
    ];
    const result = normalizeApifyItems(items);
    expect(result.timeSeries).not.toBeNull();
    expect(result.timeSeries!.points[0]!.value).toBe(55);
    expect(result.timeSeries!.points[1]!.value).toBe(60);
  });

  it("normaliza item completo con timeline + regiones + related", () => {
    const items = [
      {
        timeline: [
          { timestamp: 1735689600000, values: [40] },
          { timestamp: 1735776000000, values: [55] },
        ],
        interest_by_region: [
          { geo_code: "MX", value: 100 },
          { geo_code: "MX-CMX", value: 80 },
        ],
        related_topics: [
          { title: "Seguridad", value: 90 },
        ],
        related_queries: [
          { query: "camara de seguridad", value: 70 },
        ],
      },
    ];
    const result = normalizeApifyItems(items);
    expect(result.timeSeries).not.toBeNull();
    expect(result.timeSeries!.points).toHaveLength(2);
    expect(result.regions).toHaveLength(2);
    expect(result.regions[0]!.geoCode).toBe("MX");
    expect(result.topics).toHaveLength(1);
    expect(result.topics[0]!.label).toBe("Seguridad");
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0]!.label).toBe("camara de seguridad");
    expect(result.partial).toBe(false);
  });

  it("soporta camelCase en item completo", () => {
    const items = [
      {
        timeline: [{ timestamp: 1735689600000, values: [50] }],
        interestByRegion: [{ geoCode: "MX", value: 100 }],
        relatedTopics: [{ title: "Cámaras", value: 80 }],
        relatedQueries: [{ query: "cctv", value: 60 }],
      },
    ];
    const result = normalizeApifyItems(items);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.geoCode).toBe("MX");
    expect(result.topics).toHaveLength(1);
    expect(result.queries).toHaveLength(1);
  });

  it("maneja items con estructura inválida sin lanzar", () => {
    const items = [
      { foo: "bar" },
      null,
      undefined,
      42,
      "string",
    ];
    const result = normalizeApifyItems(items);
    expect(result.timeSeries).toBeNull();
    expect(result.partial).toBe(true);
  });

  it("descarta items sin value numérico", () => {
    const items = [
      { date: "2025-01-01", value: "not-a-number" },
      { date: "2025-01-02" }, // sin value
      { value: 50 }, // sin date
    ];
    const result = normalizeApifyItems(items);
    expect(result.timeSeries).toBeNull();
  });
});
