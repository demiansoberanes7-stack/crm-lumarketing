import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildKeywordIdeas,
  keywordInterestTrend,
  mentionsQuery,
  type MarketIdea,
} from "@/lib/intel-content";
import { KeywordContentRanking, GtRanking, buildRanking } from "@/components/inteligencia/gt-ranking";
import { GeoPanel } from "@/components/inteligencia/geo-panel";
import { GtRegionPanel } from "@/components/inteligencia/gt-region-panel";
import { GtRelatedPanel } from "@/components/inteligencia/gt-related-panel";
import { intelFocusSeries, intelNicheAnchors } from "@/components/inteligencia/intel-client";
import type { KeywordOverviewView } from "@/components/inteligencia/keyword-view";

function idea(label: string, overrides: Partial<MarketIdea> = {}): MarketIdea {
  return {
    label,
    value: 40,
    pct: null,
    isBreakout: false,
    list: "top",
    ...overrides,
  };
}

function series(values: number[]): Array<{ day: string; value: number }> {
  return values.map((value, index) => ({
    day: `2026-10-${String(index + 1).padStart(2, "0")}`,
    value,
  }));
}

/** Solo con lo que leen los helpers puros; el resto de la vista no se toca. */
function overview(query: string, values: number[] | null): KeywordOverviewView {
  return {
    query,
    market: values === null ? null : ({ series: series(values) } as KeywordOverviewView["market"]),
  } as KeywordOverviewView;
}

describe("filtro de tendencias por la palabra buscada", () => {
  it("ignora acentos y plurales: la búsqueda del analizador sí casa", () => {
    expect(mentionsQuery("Nueva CÁMARA de vigilancia captó el robo", "camaras de seguridad")).toBe(true);
    expect(mentionsQuery("¿Qué comprar en el Buen Fin?", "comprar")).toBe(true);
  });

  it("sin consulta no filtra (la tabla se ve completa)", () => {
    expect(mentionsQuery("cualquier titulo", "")).toBe(true);
    expect(mentionsQuery("cualquier titulo", "   ")).toBe(true);
  });

  it("no confunde «vida» con «seguridad»", () => {
    expect(mentionsQuery("Rueda de prensa sobre el seguro de vida", "camara de seguridad")).toBe(false);
  });

  it("deja teclear a medias sin romper el filtro", () => {
    expect(mentionsQuery("Lanzan nuevo celular plegable", "celu")).toBe(true);
  });

  it("basta UNA palabra de la consulta (a diferencia de YouTube, que exige todas)", () => {
    // En la tabla del país pedir la frase completa vaciaba la fuente.
    expect(mentionsQuery("Aumentan los robos con violencia en CDMX", "camaras de seguridad")).toBe(false);
    expect(mentionsQuery("Estrenan cámara oculta en un restaurante", "camaras de seguridad")).toBe(true);
  });

  it("las vacías no cuentan como palabra buscada", () => {
    expect(mentionsQuery("La casa de la comida", "de la")).toBe(true);
    expect(mentionsQuery("Clima extremo en el país", "de la")).toBe(true);
  });
});

describe("ideas de contenido de una búsqueda", () => {
  it("solo usa las consultas y temas de esa búsqueda, nunca los nichos monitoreados", () => {
    const ideas = buildKeywordIdeas({
      queries: [idea("camara lenta iphone"), idea("slow motion video")],
      topics: [idea("Cámara")],
    });
    expect(ideas.map((item) => item.name)).toEqual([
      "camara lenta iphone",
      "slow motion video",
      "Cámara",
    ]);
    expect(ideas.some((item) => item.name === "Smartphones")).toBe(false);
    expect(ideas.some((item) => item.name === "Accesorios de celular")).toBe(false);
  });

  it("no repite etiquetas: la consulta gana sobre el tema", () => {
    const ideas = buildKeywordIdeas({
      queries: [idea("slow motion", { value: 70 })],
      topics: [idea("Slow Motion", { value: 90 })],
    });
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ name: "slow motion", kind: "consulta", value: 70 });
  });

  it("pone primero lo que está en alza y recomienda publicar ahora", () => {
    const ideas = buildKeywordIdeas({
      queries: [
        idea("consulta estable", { value: 95 }),
        idea("consulta en alza", { list: "rising", value: 20, pct: 120 }),
        idea("aumento puntual", { list: "rising", isBreakout: true, value: 0 }),
      ],
      topics: [],
    });
    expect(ideas[0]?.name).toBe("consulta en alza");
    expect(ideas[0]).toMatchObject({
      rising: true,
      recommendation: "Publicar ahora — búsqueda en alza",
      tone: "success",
    });
    expect(ideas[1]?.name).toBe("aumento puntual");
    expect(ideas[1]?.recommendation).toMatch(/aumento puntual/);
    expect(ideas[2]).toMatchObject({
      name: "consulta estable",
      rising: false,
      recommendation: "Mantener — consulta principal",
      tone: "neutral",
    });
  });

  it("ordena las estables por interés y limita a ocho ideas", () => {
    const queries = Array.from({ length: 12 }, (_, i) =>
      idea(`idea ${i + 1}`, { value: 10 + i })
    );
    const ideas = buildKeywordIdeas({ queries, topics: [] });
    expect(ideas).toHaveLength(8);
    expect(ideas[0]?.value).toBe(21);
    expect(ideas[7]?.value).toBe(14);
  });

  it("sin datos devuelve lista vacía, no datos de relleno", () => {
    expect(buildKeywordIdeas({ queries: [], topics: [] })).toEqual([]);
    expect(buildKeywordIdeas({ queries: [idea("   ")], topics: [] })).toEqual([]);
  });
});

describe("tendencia de la palabra buscada", () => {
  it("sin serie no inventa tendencia", () => {
    expect(keywordInterestTrend([])).toBeNull();
  });

  it("detecta alza comparando los últimos 7 días contra los 7 previos", () => {
    const trend = keywordInterestTrend(series([...Array(7).fill(20), ...Array(7).fill(60)]));
    expect(trend).toMatchObject({
      index: 60,
      direction: "up",
      changePct: 200,
      tone: "success",
    });
  });

  it("detecta baja", () => {
    const trend = keywordInterestTrend(series([...Array(7).fill(50), ...Array(7).fill(25)]));
    expect(trend).toMatchObject({
      direction: "down",
      changePct: -50,
      tone: "danger",
    });
  });

  it("una variación pequeña queda estable", () => {
    const trend = keywordInterestTrend(series([...Array(7).fill(50), ...Array(7).fill(52)]));
    expect(trend).toMatchObject({
      direction: "flat",
      changePct: 4,
      recommendation: "Mantener — interés alto y estable",
    });
  });

  it("con pocos días no declara dirección", () => {
    const trend = keywordInterestTrend(series([10, 20, 30]));
    expect(trend).toMatchObject({ index: 30, direction: "flat", changePct: null });
  });

  it("si antes no había interés y ahora sí, lo marca en alza", () => {
    const trend = keywordInterestTrend(series([...Array(7).fill(0), ...Array(7).fill(30)]));
    expect(trend).toMatchObject({ direction: "up", changePct: null });
  });

  it("interés bajo y plano se recomienda explorar", () => {
    const trend = keywordInterestTrend(series(Array(10).fill(5)));
    expect(trend?.recommendation).toBe("Explorar — interés bajo");
  });
});

describe("panel de contenido de la búsqueda", () => {
  it("renderiza solo la palabra buscada y sus relacionados, no los nichos monitoreados", () => {
    const html = renderToStaticMarkup(
      createElement(KeywordContentRanking, {
        query: "camara lenta",
        market: {
          series: series([...Array(7).fill(14), ...Array(7).fill(75)]),
          topics: [
            { label: "Cámara", value: 30, pct: null, isBreakout: false, list: "top" as const },
          ],
          queries: [
            { label: "camara lenta video", value: 80, pct: null, isBreakout: false, list: "top" as const },
            { label: "slow motion iphone", value: 0, pct: 140, isBreakout: false, list: "rising" as const },
          ],
        },
        marketNote: null,
      })
    );
    expect(html).toContain("camara lenta");
    expect(html).toContain("slow motion iphone");
    expect(html).toContain("Publicar ahora — búsqueda en alza");
    expect(html).toContain("No usa tus nichos monitoreados");
    expect(html).not.toContain("Smartphones");
    expect(html).not.toContain("Accesorios de celular");
  });

  it("sin datos de Google Trends explica el motivo y no cae a otros nichos", () => {
    const html = renderToStaticMarkup(
      createElement(KeywordContentRanking, {
        query: "camara lenta",
        market: null,
        marketNote: "No hay proveedores configurados.",
      })
    );
    expect(html).toContain("«camara lenta»");
    expect(html).toContain("No hay proveedores configurados.");
    expect(html).not.toContain("Smartphones");
  });
});

describe("las fuentes del catálogo se relacionan con la búsqueda, no se ocultan", () => {
  it("sin búsqueda no hay línea de referencia", () => {
    expect(intelFocusSeries(null)).toBeNull();
  });

  it("usa la serie EN VIVO de la consulta como línea de referencia", () => {
    const focus = intelFocusSeries(overview("camara de seguridad", [12, 40, 96]));
    expect(focus).toMatchObject({
      termId: "query:camara de seguridad",
      name: "camara de seguridad · tu búsqueda",
      z: null,
      lastValue: 96,
    });
    expect(focus?.series).toHaveLength(3);
  });

  it("sin mercado ni con un solo punto no dibuja una línea falsa", () => {
    expect(intelFocusSeries(overview("wifi", null))).toBeNull();
    expect(intelFocusSeries(overview("wifi", [50]))).toBeNull();
  });

  it("el ranking etiqueta cada nicho según su parecido con la consulta", () => {
    const ranking = buildRanking([
      { termId: "t_cam", name: "Cámaras de seguridad", z: 2, lastValue: 90, series: series([10, 20, 60, 90]) },
      { termId: "t_phone", name: "Smartphones", z: null, lastValue: 30, series: series([40, 35, 32, 30]) },
    ]);
    const html = renderToStaticMarkup(
      createElement(GtRanking, {
        ranking,
        related: [
          { termId: "t_cam", name: "Cámaras de seguridad", score: 0.86, via: "camaras de seguridad", exact: true },
          { termId: "t_phone", name: "Smartphones", score: 0.33, via: "celular", exact: false },
        ],
        queryLabel: "camara de seguridad",
      })
    );
    expect(html).toContain("¿De qué hacer contenido esta semana?");
    expect(html).toContain("Etiquetados por cuánto se parecen a «camara de seguridad»");
    expect(html).toContain("es tu búsqueda");
    expect(html).toContain("33% parecido");
    expect(html).toContain("No es lo mismo; sirve de contexto.");
    // Con el nicho de la consulta sin datos suficientes, no se recomienda como
    // si su interés estuviera al alza.
    expect(html).toContain("no está estable ni en alza");
  });

  /** 21 días con variación + 7 al alza: clasificación A del ranking. */
  function risingSeries(): Array<{ day: string; value: number }> {
    const prior = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? 10 : 20));
    return series([...prior, ...Array(7).fill(100)]);
  }

  it("con búsqueda, el bloque verde solo recomienda el nicho que ES la búsqueda", () => {
    const html = renderToStaticMarkup(
      createElement(GtRanking, {
        ranking: buildRanking([
          { termId: "t_cam", name: "Cámaras de seguridad", z: 2, lastValue: 100, series: risingSeries() },
          { termId: "t_phone", name: "Smartphones", z: 2, lastValue: 100, series: risingSeries() },
        ]),
        related: [
          { termId: "t_cam", name: "Cámaras de seguridad", score: 1, via: "camaras de seguridad", exact: true },
          { termId: "t_phone", name: "Smartphones", score: 0, via: "", exact: false },
        ],
        queryLabel: "camaras de seguridad",
      })
    );
    expect(html).toContain("Enfócate en: Cámaras de seguridad");
    // Smartphones también está en alza, pero no es la búsqueda: no se recomienda.
    expect(html).not.toContain("Enfócate en: Cámaras de seguridad, Smartphones");
    expect(html).toContain("sin palabras en común");
  });

  it("sin nicho correspondiente, no hay bloque verde que lo haga pasar por la búsqueda", () => {
    const html = renderToStaticMarkup(
      createElement(GtRanking, {
        ranking: buildRanking([
          { termId: "t_phone", name: "Smartphones", z: 2, lastValue: 100, series: risingSeries() },
        ]),
        related: [{ termId: "t_phone", name: "Smartphones", score: 0, via: "", exact: false }],
        queryLabel: "camara de seguridad",
      })
    );
    expect(html).not.toContain("Enfócate en:");
    expect(html).toContain("Ninguno de tus nichos con serie corresponde a «camara de seguridad»");
    expect(html).toContain("Ninguno comparte palabras con tu búsqueda");
    expect(html).toContain("sirven de referencia, no describen tu búsqueda");
  });

  it("un vecino parcial se nombra con su porcentaje, nunca como la búsqueda", () => {
    const html = renderToStaticMarkup(
      createElement(GtRanking, {
        ranking: buildRanking([
          { termId: "t_red", name: "Redes y conectividad", z: 2, lastValue: 100, series: risingSeries() },
        ]),
        related: [
          { termId: "t_red", name: "Redes y conectividad", score: 0.5, via: "redes", exact: false },
        ],
        queryLabel: "redes sociales",
      })
    );
    expect(html).not.toContain("Enfócate en:");
    expect(html).toContain("El más cercano es «Redes y conectividad» (50% parecido)");
  });

  it("sin búsqueda el ranking se comporta igual que antes", () => {
    const html = renderToStaticMarkup(
      createElement(GtRanking, {
        ranking: buildRanking([
          { termId: "t_cam", name: "Cámaras de seguridad", z: 2, lastValue: 90, series: series([10, 20, 60, 90]) },
        ]),
      })
    );
    expect(html).not.toContain("parecido");
    expect(html).not.toContain("es tu búsqueda");
  });

  /** Búsqueda con ranking de nichos ya calculado por la API. */
  function withMatches(
    query: string,
    matches: Array<{ termId: string; name: string; score: number; exact: boolean }>
  ): KeywordOverviewView {
    return {
      query,
      catalogMatches: matches.map((m) => ({ ...m, via: m.name })),
    } as unknown as KeywordOverviewView;
  }

  it("solo un nicho que cruza el umbral mueve los paneles y el mapa", () => {
    const anchors = intelNicheAnchors(
      withMatches("camara de seguridad", [
        { termId: "t_cam", name: "Cámaras de seguridad", score: 0.86, exact: true },
        { termId: "t_phone", name: "Smartphones", score: 0.33, exact: false },
      ])
    );
    expect(anchors.focus?.termId).toBe("t_cam");
    expect(anchors.nearest?.termId).toBe("t_cam");
  });

  it("un vecino lejano no fuerza el nicho del mapa ni de los paneles", () => {
    const anchors = intelNicheAnchors(
      withMatches("cctv para exterior", [
        { termId: "t_phone", name: "Smartphones", score: 0.28, exact: false },
      ])
    );
    // Sin ancla, `activeTermId` queda donde el dueño lo dejó; el vecino solo se
    // nombra en pantalla con su porcentaje.
    expect(anchors.focus).toBeNull();
    expect(anchors.nearest).toMatchObject({ termId: "t_phone", score: 0.28 });
  });

  it("sin catálogo coincidido no hay anclas que inventar", () => {
    expect(intelNicheAnchors(null)).toEqual({ focus: null, nearest: null });
    expect(intelNicheAnchors(withMatches("wifi", []))).toEqual({ focus: null, nearest: null });
  });
});

/**
 * El mapa DENUE solo se calcula por nicho (32 consultas). Con una búsqueda
 * activa no puede presentarse como si fuera su mapa: cada opción declara su
 * relación y el panel usa el conteo nacional de la consulta, que ya se pagó.
 */
describe("mapa DENUE: de quién es y qué mide de la búsqueda", () => {
  it("etiqueta cada opción y nombra el conteo nacional de la consulta", () => {
    const html = renderToStaticMarkup(
      createElement(GeoPanel, {
        terms: [
          { id: "t_phone", name: "Smartphones" },
          { id: "t_red", name: "Redes y conectividad" },
        ],
        matches: [
          { termId: "t_phone", name: "Smartphones", score: 0, via: "", exact: false },
          { termId: "t_red", name: "Redes y conectividad", score: 0, via: "", exact: false },
        ],
        competition: { establishments: 320, censored: true },
        queryLabel: "camara de seguridad",
      })
    );
    expect(html).toContain("Smartphones · sin palabras en común");
    expect(html).toContain("Redes y conectividad · sin palabras en común");
    expect(html).toContain("no describe tu búsqueda");
    expect(html).toContain("DENUE sí midió «camara de seguridad» a nivel nacional");
    expect(html).toContain("≥320 establecimientos");
    expect(html).toContain("El desglose por estado solo está calculado para los nichos del catálogo");
  });

  it("sin búsqueda no agrega notas de relación", () => {
    const html = renderToStaticMarkup(
      createElement(GeoPanel, {
        terms: [{ id: "t_phone", name: "Smartphones" }],
      })
    );
    expect(html).not.toContain("sin palabras en común");
    expect(html).not.toContain("a nivel nacional");
  });
});

describe("paneles de detalle GT declaran el nicho frente a la búsqueda", () => {
  const note = "«Smartphones» es un nicho de tu catálogo sin palabras en común con «camara de seguridad»; no describe tu búsqueda.";

  it("subregiones muestran la nota bajo el título", () => {
    const html = renderToStaticMarkup(
      createElement(GtRegionPanel, {
        regions: [{ state: "MX-CMX", index: 100, source: "google_trends" as const }],
        regionsSource: "google_trends" as const,
        termName: "Smartphones",
        note,
      })
    );
    expect(html).toContain(note);
    expect(html).toContain("sin palabras en común");
  });

  it("temas y consultas muestran la nota y no la esconden en el pie", () => {
    const html = renderToStaticMarkup(
      createElement(GtRelatedPanel, {
        topics: [{ label: "Celular", value: 40, pct: null, isBreakout: false, list: "top" as const }],
        queries: [],
        termName: "Smartphones",
        onMonitor: async () => null,
        note,
      })
    );
    expect(html).toContain(note);
  });
});
