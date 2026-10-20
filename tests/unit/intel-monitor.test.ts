import { describe, expect, it } from "vitest";
import {
  TERM_MATCH_MIN,
  findTermByKeyword,
  matchTerm,
  matchTokens,
  termSimilarity,
} from "@/server/intel/terms";

const terms = [
  { id: "itr_1", name: "Cámaras de seguridad", keywords: ["camara de seguridad", "videovigilancia"] },
  { id: "itr_2", name: "Starlink", keywords: ["starlink", "internet satelital"] },
];

/** Semillas reales del catálogo: las que provocaban la queja de Inteligencia. */
const catalog = [
  { id: "t_red", name: "Redes y conectividad", keywords: ["router", "switch de red", "punto de acceso", "wifi", "redes"] },
  { id: "t_phone", name: "Smartphones", keywords: ["celular", "smartphone", "iphone", "samsung galaxy", "xiaomi"] },
  { id: "t_lap", name: "Laptops", keywords: ["laptop", "portatil", "macbook", "chromebook"] },
];

describe("matchTokens", () => {
  it("quita acentos y vacías, conserva el plural", () => {
    expect(matchTokens("Cámaras de Seguridad")).toEqual(["camaras", "seguridad"]);
    expect(matchTokens("CÉLULARES")).toEqual(["celulares"]);
  });
  it("los números de 1 dígito no son token", () => {
    expect(matchTokens("5g")).toEqual(["5g"]);
    expect(matchTokens("a b")).toEqual([]);
  });
});

describe("termSimilarity (plurales son la misma palabra)", () => {
  it("es 1 con los mismos tokens sin importar el orden ni el plural", () => {
    expect(termSimilarity("camaras seguridad", "seguridad de camara")).toBe(1);
    expect(termSimilarity("celulares", "celular")).toBe(1);
    expect(termSimilarity("smartphones", "smartphone")).toBe(1);
  });
  it("baja cuando la consulta agrega temas", () => {
    expect(termSimilarity("redes sociales", "redes")).toBeLessThan(TERM_MATCH_MIN);
  });
  it("0 si una frase no aporta tokens", () => {
    expect(termSimilarity("de la", "redes")).toBe(0);
  });
});

describe("matchTerm (la consulta debe SER el nicho)", () => {
  it("no hereda el nicho de conectividad al buscar redes sociales", () => {
    expect(matchTerm(catalog, "redes sociales")).toBeNull();
    expect(findTermByKeyword(catalog, "redes sociales")).toBeNull();
  });
  it("sí reconoce una keyword suelta del nicho", () => {
    expect(matchTerm(catalog, "celulares")?.id).toBe("t_phone");
    expect(matchTerm(catalog, "laptop")?.id).toBe("t_lap");
    expect(matchTerm(catalog, "wifi")?.id).toBe("t_red");
  });
  it("no diluye un nicho de una sola palabra en una consulta compuesta", () => {
    // "routers wifi" comparte 1 de 3 tokens con «router»: se trata como tema nuevo.
    expect(matchTerm(catalog, "routers wifi")).toBeNull();
  });
  it("gana el término más parecido, no el primero", () => {
    const near = matchTerm(
      [
        { id: "a", name: "Gaming", keywords: ["consola"] },
        { id: "b", name: "Sillas gamer", keywords: ["silla gamer ergonomica"] },
      ],
      "sillas gamer ergonomicas"
    );
    expect(near?.id).toBe("b");
    expect(near?.score).toBe(1);
  });
  it("informa por qué texto del catálogo coincidió", () => {
    const starlink = matchTerm(terms, "internet satelital");
    expect(starlink?.via).toBe("internet satelital");
    expect(starlink?.score).toBe(1);
  });
});

describe("findTermByKeyword (dedupe al monitorear)", () => {
  it("encuentra por nombre exacto sin importar acentos ni mayúsculas", () => {
    expect(findTermByKeyword(terms, "STARLINK")?.id).toBe("itr_2");
    expect(findTermByKeyword(terms, "starlink")?.id).toBe("itr_2");
  });
  it("una consulta que conserva el nombre del nicho lo reutiliza", () => {
    expect(findTermByKeyword(terms, "cámara de seguridad para casa")?.id).toBe("itr_1");
    expect(findTermByKeyword(terms, "internet satelital rural")?.id).toBe("itr_2");
  });
  it("una consulta más amplia que un nicho de una sola palabra NO lo hereda", () => {
    // Antes caía en Starlink y mostraba su serie cacheada en otra búsqueda.
    expect(findTermByKeyword(terms, "starlink en méxico precio")).toBeNull();
  });
  it("devuelve null si no hay coincidencia (keyword nueva)", () => {
    expect(findTermByKeyword(terms, "impresora 3d")).toBeNull();
    expect(findTermByKeyword(terms, "")).toBeNull();
    expect(findTermByKeyword(terms, "de la")).toBeNull();
  });
});
