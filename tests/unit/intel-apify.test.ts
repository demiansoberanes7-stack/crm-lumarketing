import { describe, expect, it } from "vitest";
import { normalizeApifyItems } from "@/server/intel/sources/apify-trends";

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
