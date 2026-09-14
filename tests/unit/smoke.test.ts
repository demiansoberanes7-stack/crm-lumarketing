import { describe, expect, it } from "vitest";
import { isLumarkName } from "@/lib/brand";
import { newId } from "@/lib/db/ids";

describe("brand identity", () => {
  it("isLumarkName reconoce LUMARK", () => {
    expect(isLumarkName("LUMARK")).toBe(true);
    expect(isLumarkName("  lumark  ")).toBe(true);
    expect(isLumarkName("Lumark")).toBe(true);
  });

  it("isLumarkName rechaza otros nombres", () => {
    expect(isLumarkName("Vocero")).toBe(false);
    expect(isLumarkName("Acme")).toBe(false);
    expect(isLumarkName("")).toBe(false);
  });
});

describe("ids", () => {
  it("newId genera prefijo correcto", () => {
    const id = newId("quote");
    expect(id).toMatch(/^qt_/);
    expect(id.length).toBeGreaterThan(3);
  });

  it("newId genera IDs únicos", () => {
    const a = newId("payment");
    const b = newId("payment");
    expect(a).not.toBe(b);
  });
});
