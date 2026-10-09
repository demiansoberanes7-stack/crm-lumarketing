import { describe, it, expect } from "vitest";
import { available, unavailable } from "@/server/metrics/compute";

describe("métricas comerciales: disponibilidad", () => {
  it("available(0) es una medición real, distinta de unavailable", () => {
    const zero = available(0);
    expect(zero.availability).toBe("available");
    expect(zero.value).toBe(0);

    const nd = unavailable("no_data");
    expect(nd.availability).toBe("no_data");
    expect(nd.value).toBeNull();
    expect(nd.value).not.toBe(0);
  });

  it("los tres estados 'no disponible' conservan su razón y jamás un valor", () => {
    for (const state of ["no_data", "not_applicable", "pending"] as const) {
      const m = unavailable(state);
      expect(m.availability).toBe(state);
      expect(m.value).toBeNull();
    }
  });
});
