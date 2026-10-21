import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildKeywordIdeas,
  keywordInterestTrend,
  type MarketIdea,
} from "@/lib/intel-content";
import { KeywordContentRanking } from "@/components/inteligencia/gt-ranking";
import { showMonitoredExplorer } from "@/components/inteligencia/intel-client";
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

describe("explorador del catálogo bajo una búsqueda", () => {
  it("no se muestra mientras se analiza ni cuando hay resultado en pantalla", () => {
    expect(showMonitoredExplorer(null, true)).toBe(false);
    expect(showMonitoredExplorer({} as KeywordOverviewView, false)).toBe(false);
    expect(showMonitoredExplorer({} as KeywordOverviewView, true)).toBe(false);
  });

  it("solo aparece cuando la persona no ha buscado nada", () => {
    expect(showMonitoredExplorer(null, false)).toBe(true);
  });
});
