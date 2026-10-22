import { describe, expect, it } from "vitest";
import {
  intelRelation,
  relationIndex,
  relationLabel,
  relationRank,
  type CatalogMatch,
} from "@/lib/intel-relation";

const matches: CatalogMatch[] = [
  { termId: "t_red", name: "Redes y conectividad", score: 0, via: "", exact: false },
  { termId: "t_cam", name: "Cámaras de seguridad", score: 1, via: "camaras de seguridad", exact: true },
  { termId: "t_phone", name: "Smartphones", score: 0.33, via: "celular", exact: false },
];

/**
 * La relación no se recalcula en el cliente: se ordena y se etiqueta lo que
 * `/api/intel/keyword` ya midió. Lo importante es que NINGÚN nicho se pierda:
 * los de score 0 también se devuelven para poder decir «sin palabras en común»
 * en vez de mostrarlos como si fueran la búsqueda.
 */
describe("intelRelation", () => {
  it("sin búsqueda no hay relación que declarar", () => {
    expect(intelRelation(null, matches)).toBeNull();
    expect(intelRelation("   ", matches)).toBeNull();
  });

  it("ordena exacto → parecidos → sin palabras, sin descartar ninguno", () => {
    const rel = intelRelation("camara de seguridad", matches);
    expect(rel).not.toBeNull();
    expect(rel!.matches.map((m) => m.termId)).toEqual(["t_cam", "t_phone", "t_red"]);
    expect(rel!.total).toBe(3);
    expect(rel!.relatedCount).toBe(2);
    expect(rel!.exact?.termId).toBe("t_cam");
    // `nearest` es el primero con palabras en común; el exacto también cuenta.
    expect(rel!.nearest?.termId).toBe("t_cam");
  });

  it("sin coincidencias totales, nearest es null pero el catálogo sigue listado", () => {
    const rel = intelRelation("impresora 3d", [
      { termId: "t_red", name: "Redes y conectividad", score: 0, via: "", exact: false },
    ]);
    expect(rel!.nearest).toBeNull();
    expect(rel!.exact).toBeNull();
    expect(rel!.total).toBe(1);
    expect(rel!.relatedCount).toBe(0);
    expect(rel!.matches).toHaveLength(1);
  });

  it("ordena por nombre a igual score para que la pantalla sea estable", () => {
    const rel = intelRelation("wifi", [
      { termId: "b", name: "Beta", score: 0, via: "", exact: false },
      { termId: "a", name: "Alfa", score: 0, via: "", exact: false },
    ]);
    expect(rel!.matches.map((m) => m.name)).toEqual(["Alfa", "Beta"]);
  });

  it("tolera que la API no mande catálogo", () => {
    const rel = intelRelation("wifi", null);
    expect(rel).toMatchObject({ query: "wifi", total: 0, exact: null, nearest: null });
  });
});

describe("relationLabel", () => {
  it("distingue ser la búsqueda, parecerse y no compartir palabras", () => {
    expect(relationLabel(matches[1])).toBe("es tu búsqueda");
    expect(relationLabel(matches[2])).toBe("33% parecido");
    expect(relationLabel(matches[0])).toBe("sin palabras en común");
    expect(relationLabel(null)).toBeNull();
  });

  it("redondea el porcentaje al entero", () => {
    expect(relationLabel({ score: 0.666, exact: false })).toBe("67% parecido");
  });
});

describe("relationRank", () => {
  it("ordena exacto > con palabras > sin palabras > desconocido", () => {
    expect(relationRank(matches[1])).toBe(2);
    expect(relationRank(matches[2])).toBe(1);
    expect(relationRank(matches[0])).toBe(0);
    expect(relationRank(null)).toBe(-1);
  });
});

describe("relationIndex", () => {
  it("indexa por termId para etiquetar cualquier panel", () => {
    const index = relationIndex(matches);
    expect(index.get("t_phone")?.score).toBe(0.33);
    expect(index.get("no_existe")).toBeUndefined();
  });
});
