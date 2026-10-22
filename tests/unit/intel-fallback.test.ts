import { describe, expect, it } from "vitest";
import {
  buildContentSignals,
  nicheForTrend,
  relateTrendRows,
  sameGiroTerms,
  type FallbackCatalogTerm,
} from "@/lib/intel-fallback";
import { matchedQueryWord, sharesWord } from "@/lib/intel-content";

/**
 * Respaldo «nunca vacío»: si la consulta no aparece en el feed, la tabla baja
 * al mismo giro y luego al catálogo/país, siempre con el nivel declarado. Lo
 * que no puede pasar es inventar parentesco ni devolver una tabla vacía
 * habiendo filas.
 */

const TERMS: FallbackCatalogTerm[] = [
  {
    termId: "cam-seg",
    name: "Cámaras de seguridad",
    keywords: ["camara de seguridad", "camaras de seguridad", "camara ip", "videovigilancia", "cctv"],
  },
  {
    termId: "cam-ip",
    name: "Cámaras IP",
    keywords: ["camara ip", "camaras ip", "nvr", "dvr"],
  },
  {
    termId: "alarmas",
    name: "Alarmas y sensores",
    keywords: ["alarma para casa", "sensor de movimiento", "sensor de puerta"],
  },
  {
    termId: "laptops",
    name: "Laptops",
    keywords: ["laptop", "portatil", "macbook"],
  },
  {
    termId: "phones",
    name: "Smartphones",
    keywords: ["celular", "smartphone", "iphone"],
  },
];

const row = (title: string, volume: number | null) => ({ id: title, title, volume });

describe("palabras compartidas y nicho de una tendencia", () => {
  it("compara sin acentos ni plurales", () => {
    expect(sharesWord("Cámaras IP", "Cámaras de seguridad")).toBe(true);
    expect(sharesWord("Domótica", "Energía solar")).toBe(false);
  });

  it("devuelve la palabra que delata el nicho, tal como está en el título", () => {
    expect(matchedQueryWord("La mejor ALARMA para casa 2026", "alarma para casa")).toBe("alarma");
    expect(matchedQueryWord("Clima extremo", "alarma para casa")).toBeNull();
  });

  it("etiqueta la tendencia con el nicho que la explica", () => {
    expect(nicheForTrend("La mejor alarma para casa 2026", TERMS)).toEqual({
      termId: "alarmas",
      name: "Alarmas y sensores",
      via: "alarma",
    });
    expect(nicheForTrend("Clima extremo en el país", TERMS)).toBeNull();
  });

  it("solo declara mismo giro cuando hay palabras en común con el nicho principal", () => {
    const primary = TERMS[0]!;
    expect(sameGiroTerms(TERMS, primary).map((term) => term.name)).toEqual(["Cámaras IP"]);
    expect(sameGiroTerms(TERMS, TERMS[3]!)).toEqual([]);
    expect(sameGiroTerms(TERMS, null)).toEqual([]);
  });
});

describe("relateTrendRows: la tabla nunca queda vacía", () => {
  it("con coincidencias de la consulta conserva el orden elegido en el panel", () => {
    const res = relateTrendRows(
      [row("Cámara wifi para casa", 50), row("Cámaras de seguridad 2026", 900)],
      "camara de seguridad",
      TERMS,
      TERMS[0]
    );
    expect(res.level).toBe("consulta");
    expect(res.rows.map((entry) => entry.row.title)).toEqual([
      "Cámara wifi para casa",
      "Cámaras de seguridad 2026",
    ]);
    expect(res.matched).toBe(2);
  });

  it("sin coincidencias cae al mismo giro y ordena por alcance", () => {
    const res = relateTrendRows(
      [
        row("Cómo configurar NVR y DVR", 800),
        row("Instalar videograbador NVR", 5000),
        row("Mejores laptops 2026", 9000),
        row("Clima extremo en el país", 100000),
      ],
      "videovigilancia",
      TERMS,
      TERMS[0]
    );
    expect(res.level).toBe("mismo-giro");
    expect(res.rows.map((entry) => entry.row.title)).toEqual([
      "Instalar videograbador NVR",
      "Cómo configurar NVR y DVR",
    ]);
    expect(res.rows[0]?.niche?.name).toBe("Cámaras IP");
    expect(res.matched).toBe(0);
    expect(res.sameGiro).toContain("Cámaras IP");
  });

  it("sin filas del mismo giro muestra las de otros nichos, también por alcance", () => {
    const res = relateTrendRows(
      [row("Review del iPhone 15", 300), row("Clima extremo", 90000)],
      "macbook",
      TERMS,
      TERMS[3]
    );
    expect(res.level).toBe("catalogo");
    expect(res.rows.map((entry) => entry.row.title)).toEqual(["Review del iPhone 15"]);
    expect(res.rows[0]?.niche?.name).toBe("Smartphones");
  });

  it("si nada pertenece al catálogo muestra el país y lo dice", () => {
    const res = relateTrendRows(
      [row("Clima extremo", 20), row("Final de fútbol", 500)],
      "camara de seguridad",
      TERMS,
      TERMS[0]
    );
    expect(res.level).toBe("pais");
    expect(res.rows.map((entry) => entry.row.title)).toEqual([
      "Final de fútbol",
      "Clima extremo",
    ]);
    expect(res.rows.every((entry) => entry.niche === null)).toBe(true);
  });

  it("sin búsqueda no hay respaldo que declarar: se ve todo en orden del servidor", () => {
    const res = relateTrendRows(
      [row("Final de fútbol", 500), row("Clima extremo", 20)],
      "",
      TERMS,
      null
    );
    expect(res.level).toBe("todas");
    expect(res.rows.map((entry) => entry.row.title)).toEqual([
      "Final de fútbol",
      "Clima extremo",
    ]);
  });
});

describe("buildContentSignals: respaldo de contenido sin muestra de YouTube", () => {
  it("junta nicho y búsqueda, sin repetir etiquetas y con las alzas primero", () => {
    const signals = buildContentSignals(
      {
        origin: "Google Trends · Cámaras de seguridad",
        topics: [{ label: "Cámaras", value: 80, pct: null, list: "top" }],
        queries: [{ label: "videovigilancia", value: 40, pct: 120, list: "rising" }],
      },
      {
        origin: "Google Trends · SerpApi (en vivo)",
        topics: [
          { label: "cámaras", value: 70, pct: null, list: "top" },
          { label: "seguridad", value: 90, pct: null, list: "top" },
        ],
        queries: [],
      }
    );
    expect(signals.map((signal) => signal.label)).toEqual([
      "videovigilancia",
      "seguridad",
      "Cámaras",
    ]);
    expect(signals[0]).toMatchObject({ kind: "consulta", rising: true, pct: 120 });
    // La etiqueta repetida se queda con la primera fuente que la trajo.
    expect(signals[2]?.origin).toBe("Google Trends · Cámaras de seguridad");
  });

  it("sin fuentes no inventa señales", () => {
    expect(buildContentSignals(null, undefined)).toEqual([]);
  });
});
