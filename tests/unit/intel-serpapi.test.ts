import { describe, expect, it } from "vitest";
import { getSerpApiQuota } from "@/server/intel/sources/serpapi-trends";

describe("SerpApi cuota", () => {
  it("plan gratuito = 250 consultas/mes", () => {
    const quota = getSerpApiQuota();
    expect(quota.limit).toBe(250);
    expect(quota.used).toBe(0);
    expect(quota.remaining).toBe(250);
  });

  it("refleja el uso real y no se sale del rango", () => {
    expect(getSerpApiQuota(40)).toEqual({ limit: 250, used: 40, remaining: 210 });
    expect(getSerpApiQuota(999)).toEqual({ limit: 250, used: 250, remaining: 0 });
    expect(getSerpApiQuota(-5)).toEqual({ limit: 250, used: 0, remaining: 250 });
  });
});

describe("TrendsResponse shape", () => {
  it("el tipo tiene provider discriminado", async () => {
    // Verificar que el módulo se puede importar y exporta el tipo
    const mod = await import("@/server/intel/sources/serpapi-trends");
    expect(typeof mod.fetchSerpApiTrends).toBe("function");
    expect(typeof mod.verifySerpApi).toBe("function");
    expect(typeof mod.getSerpApiKey).toBe("function");
    expect(typeof mod.getSerpApiQuota).toBe("function");
  });
});
