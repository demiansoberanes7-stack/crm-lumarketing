import { describe, expect, it } from "vitest";
import { isZorroTechName } from "@/lib/brand";
import { newId } from "@/lib/db/ids";

describe("brand identity", () => {
  it("reconoce Zorro Tech con mayúsculas y espacios de más", () => {
    expect(isZorroTechName("ZORRO TECH")).toBe(true);
    expect(isZorroTechName("  zorro   tech  ")).toBe(true);
    expect(isZorroTechName("Zorro Tech")).toBe(true);
    expect(isZorroTechName("Zorro")).toBe(true);
  });

  it("rechaza otros nombres", () => {
    expect(isZorroTechName("Acme")).toBe(false);
    expect(isZorroTechName("Zorro Tecnología")).toBe(false);
    expect(isZorroTechName("")).toBe(false);
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
