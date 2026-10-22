import { describe, expect, it } from "vitest";
import {
  TERM_MATCH_MIN,
  findTermByKeyword,
  matchTerm,
  matchTokens,
  mentionsPhrase,
  rankTerms,
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

/**
 * `rankTerms` es lo que permite que el ranking, la comparativa y el mapa de
 * nichos SIGAN en pantalla con una búsqueda activa: en vez de ocultarlos, cada
 * nicho se etiqueta con cuánto se parece a la consulta. Por eso no exige el
 * umbral de `matchTerm`.
 */
describe("rankTerms (relaciona el catálogo con la búsqueda)", () => {
  it("ordena por parecido y marca cuál SÍ cruza el umbral", () => {
    const ranked = rankTerms(
      [
        { id: "t_phone", name: "Smartphones", keywords: ["celular", "samsung galaxy"] },
        { id: "t_lap", name: "Laptops", keywords: ["laptop", "portatil"] },
      ],
      "samsung galaxy laptop"
    );
    expect(ranked.map((t) => t.id)).toEqual(["t_phone", "t_lap"]);
    expect(ranked[0]).toMatchObject({ exact: true, via: "samsung galaxy" });
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(TERM_MATCH_MIN);
    // El vecino por debajo del umbral se lista, pero no se vende como la búsqueda.
    expect(ranked[1]).toMatchObject({ score: 0.33, exact: false });
  });

  it("un 0.4 de similitud aparece como vecino, nunca como nicho exacto", () => {
    const ranked = rankTerms(catalog, "redes sociales");
    const red = ranked.find((t) => t.id === "t_red");
    expect(red).toBeDefined();
    expect(red!.score).toBeLessThan(TERM_MATCH_MIN);
    expect(red!.exact).toBe(false);
  });

  /**
   * Antes `rankTerms` descartaba los score 0, así que una búsqueda sin palabras
   * en común con el catálogo dejaba la pantalla sin ninguna etiqueta y los
   * paneles parecían resultado de la consulta. Ahora se listan igual y la UI
   * los declara «sin palabras en común».
   */
  it("conserva los nichos sin palabras en común, declarados con via vacío", () => {
    const ranked = rankTerms(catalog, "impresora 3d");
    expect(ranked).toHaveLength(catalog.length);
    expect(ranked.every((t) => t.score === 0 && !t.exact && t.via === "")).toBe(true);
    // Desempate por nombre para que la pantalla no cambie de orden entre cargas.
    expect(ranked.map((t) => t.id)).toEqual(["t_lap", "t_red", "t_phone"]);
  });

  it("con un exacto, los demás siguen apareciendo detrás (no se filtran)", () => {
    const ranked = rankTerms(catalog, "laptop");
    expect(ranked[0]).toMatchObject({ id: "t_lap", exact: true });
    expect(ranked).toHaveLength(catalog.length);
    expect(ranked.slice(1).every((t) => t.score === 0)).toBe(true);
  });

  it("puntúa por nombre y por cada keyword, conservando la mejor vía", () => {
    const ranked = rankTerms(terms, "videovigilancia");
    expect(ranked[0]).toMatchObject({ id: "itr_1", name: "Cámaras de seguridad", via: "videovigilancia", exact: true });
  });

  it("sin tokens en la consulta no devuelve nada que etiquetar", () => {
    expect(rankTerms(catalog, "")).toEqual([]);
    expect(rankTerms(catalog, "de la")).toEqual([]);
  });

  it("limita y desempata por nombre para que la UI sea estable", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `x${i}`,
      name: `Nicho ${String(i).padStart(2, "0")}`,
      keywords: ["starlink"],
    }));
    const ranked = rankTerms(many, "starlink", 4);
    expect(ranked).toHaveLength(4);
    expect(ranked.map((t) => t.name)).toEqual(["Nicho 00", "Nicho 01", "Nicho 02", "Nicho 03"]);
  });
});

describe("mentionsPhrase (acota YouTube y el catálogo a la consulta)", () => {
  it("exige todos los tokens significativos, con plural y acentos tolerantes", () => {
    expect(mentionsPhrase("Las 5 CÁMARAS DE SEGURIDAD más baratas 2026", "camara de seguridad")).toBe(true);
    expect(mentionsPhrase("cámaras de seguridad para exteriores", "camara seguridad")).toBe(true);
  });

  it("no casa por subcadena suelta", () => {
    expect(mentionsPhrase("seguros de vida", "camara de seguridad")).toBe(false);
    expect(mentionsPhrase("review del iphone 15", "celular samsung")).toBe(false);
  });

  it("frase o texto vacío no mencionan nada", () => {
    expect(mentionsPhrase("cualquier cosa", "")).toBe(false);
    expect(mentionsPhrase("", "camara")).toBe(false);
    expect(mentionsPhrase("de la", "de la")).toBe(false);
  });
});
