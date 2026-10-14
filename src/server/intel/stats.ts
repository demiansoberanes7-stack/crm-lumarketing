/**
 * Estadística del módulo de inteligencia.
 *
 * Sin dependencias externas: medianas, cuantiles, desviación estándar y
 * z-score con CDF normal (aproximación de Abramowitz & Stegun). Todo lo que
 * produce aquí se muestra al usuario con su ventana y advertencias — nunca se
 * presenta una cifra sin su método.
 */

export type Descriptive = {
  n: number;
  mean: number;
  median: number;
  std: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
};

/** Percentil por interpolación lineal sobre la muestra ordenada. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next === undefined) return sorted[base]!;
  return sorted[base]! + rest * (next - sorted[base]!);
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Desviación estándar muestral (n-1). n < 2 → 0. */
export function sampleStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Estadística descriptiva completa de una serie. */
export function describe(values: number[]): Descriptive {
  return {
    n: values.length,
    mean: mean(values),
    median: median(values),
    std: sampleStdDev(values),
    p25: quantile(values, 0.25),
    p75: quantile(values, 0.75),
    min: values.length > 0 ? Math.min(...values) : 0,
    max: values.length > 0 ? Math.max(...values) : 0,
  };
}

/** CDF de la normal estándar (A&S 26.2.17, error < 7.5e-8). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * z-score de la ventana reciente contra el histórico previo.
 *
 * `recent` = últimos N días; `prior` = los anteriores. Si el histórico tiene
 * menos de 7 puntos o su desviación es 0, devuelve null: no hay base para
 * afirmar que algo se mueve.
 */
export function growthZ(recent: number[], prior: number[]): number | null {
  if (prior.length < 7) return null;
  const mu = mean(prior);
  const sd = sampleStdDev(prior);
  if (sd === 0) return null;
  return (mean(recent) - mu) / sd;
}

/** p unilateral (cola derecha): P(X >= observado bajo H0). */
export function oneSidedP(z: number): number {
  return 1 - normalCdf(z);
}

export type Classification = "A" | "B" | "C" | "D";

export type ClassifyInput = {
  /** Días con dato en la serie completa. */
  daysWithData: number;
  z: number | null;
};

export type ClassifyResult = {
  classification: Classification;
  headline: string;
  warnings: string[];
};

/**
 * Clasificación de la idea (A/B/C/D) con reglas explícitas y auditables.
 *
 * - D: menos de 7 días con dato → no hay base estadística; el número no existe.
 * - A: z ≥ 1.5 con histórico completo → interés en crecimiento claro.
 * - B: 0 ≤ z < 1.5 → estable o creciendo moderado.
 * - C: z < 0 → contraído contra su propio histórico.
 */
export function classify(input: ClassifyInput): ClassifyResult {
  const warnings: string[] = [];
  if (input.daysWithData < 7) {
    warnings.push(
      `Solo ${input.daysWithData} día(s) con dato: no hay base para medir tendencia.`
    );
    return {
      classification: "D",
      headline: "No hay datos suficientes para medir la tendencia.",
      warnings,
    };
  }
  if (input.z === null) {
    warnings.push(
      "El histórico es demasiado corto o plano (desviación 0) para calcular un z-score."
    );
    return {
      classification: "D",
      headline: "No hay base histórica para comparar el interés actual.",
      warnings,
    };
  }
  if (input.z >= 1.5) {
    return {
      classification: "A",
      headline: "Interés en crecimiento claro contra su histórico.",
      warnings,
    };
  }
  if (input.z >= 0) {
    return {
      classification: "B",
      headline: "Interés estable o con crecimiento moderado.",
      warnings,
    };
  }
  return {
    classification: "C",
    headline: "Interés contraído contra su propio histórico.",
    warnings,
  };
}

/** Normaliza texto para matching: minúsculas sin acentos ni signos raros. */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ────────────────────────────────────────────────────────────────────────────
   Estadística descriptiva e inferencial estilo Google Trends.
   Cada función declara su método; nada se muestra al usuario sin su ventana
   y su fuente. Todas degradan a null/[] con razón cuando no hay base.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Índice normalizado 0–100 (la máxima de la ventana = 100).
 *
 * Es la escala de Google Trends: el interés RELATIVO dentro de la propia
 * ventana, no un absoluto. Si la serie es plana en 0 o vacía → [] (no se
 * inventa un índice sin señal).
 */
export function toIndex(series: number[]): number[] {
  if (series.length === 0) return [];
  const max = Math.max(...series);
  if (max <= 0) return series.map(() => 0);
  return series.map((v) => Math.round((v / max) * 100));
}

/**
 * Media móvil centrada de `window` puntos (suaviza la línea sin alterar el
 * dato crudo: el tooltip muestra el valor original).
 *
 * Bordes: usa la ventana disponible (promedia lo que haya hacia el centro).
 * `window <= 1` o serie vacía → serie original.
 */
export function smoothMA(values: number[], window = 7): number[] {
  if (values.length === 0 || window <= 1) return values;
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end);
    return mean(slice);
  });
}

/**
 * Cambio porcentual de `reciente` vs `previo` (medias).
 *
 * `previo` ~ 0 → no devuelve un % (dividir por ~0 engaña). Llama a
 * `detectBreakout` para decidir si es «Aumento puntual» en vez de un número.
 */
export function pctChange(recent: number[], prior: number[]): number | null {
  if (recent.length === 0 || prior.length === 0) return null;
  const prev = mean(prior);
  if (Math.abs(prev) < 1e-9) return null;
  const rec = mean(recent);
  return ((rec - prev) / Math.abs(prev)) * 100;
}

export type BreakoutResult = {
  isBreakout: boolean;
  /** Cambio % solo si NO es breakout; null si no hay base para el %. */
  pct: number | null;
  label: string;
  warnings: string[];
};

/**
 * Detección de «Aumento puntual» (breakout) al estilo Google Trends.
 *
 * Regla (explícita y auditable):
 * - Si la media previa es < `floorPct` del máximo de la ventana completa y la
 *   reciente supera ese umbral → breakout. El % se suprime: un denominador
 *   ~0 produce porcentajes gigantes que no miden nada.
 * - Si no, se devuelve el % normal (puede ser negativo = contracción).
 *
 * `floorPct` = 5 (por defecto): la barra de «casi nada» es 5% del pico.
 */
export function detectBreakout(
  recent: number[],
  prior: number[],
  floorPct = 5
): BreakoutResult {
  const warnings: string[] = [];
  if (recent.length === 0 || prior.length === 0) {
    return { isBreakout: false, pct: null, label: "s/d", warnings: ["Sin datos para comparar."] };
  }
  const all = [...prior, ...recent];
  const peak = Math.max(...all);
  const floor = (peak * floorPct) / 100;
  const prevMean = mean(prior);
  const recMean = mean(recent);

  // Baseline plana en ~0 y ahora hay señal → «Aumento puntual».
  if (prevMean < floor && recMean >= floor && peak > 0) {
    warnings.push(
      "El interés previo era casi nulo: el porcentaje no es significativo, se marca como aumento puntual."
    );
    return { isBreakout: true, pct: null, label: "Aumento puntual", warnings };
  }

  const pct = pctChange(recent, prior);
  if (pct === null) {
    return { isBreakout: false, pct: null, label: "s/d", warnings: ["Sin base previa para el cambio %."] };
  }
  const sign = pct >= 0 ? "+" : "";
  return { isBreakout: false, pct, label: `${sign}${Math.round(pct)}%`, warnings };
}

export type RankedItem<T> = {
  item: T;
  rank: number;
  /** Agrupa empates estadísticos: mismo `tier` = misma altura de barra. */
  tier: number;
  /** true si difiere del anterior menos que 1·s_ruido (≈ empate). */
  tiedWithPrevious: boolean;
};

/**
 * Ranking de subregiones con empates estadísticos.
 *
 * `values` son los índices 0–100 por región (misma escala). Dos regiones
 * empatan si su índice difiere menos que `tieTol` (por defecto 1.0 punto en
 * la escala 0–100, que es ~1 desv del ruido de serie diaria). El `tier`
 * define la altura de barra: regiones empatadas comparten barra.
 *
 * El orden es descendente (mayor interés arriba). Regiones con índice 0
 * quedan al final con tier propio (no empatan con las que tienen señal).
 */
export function rankWithTiers<T>(
  entries: { item: T; value: number }[],
  tieTol = 1.0
): RankedItem<T>[] {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const out: RankedItem<T>[] = [];
  let currentRank = 0;
  let currentTier = 0;
  let previousValue: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i]!;
    const tied =
      previousValue !== null && Math.abs(entry.value - previousValue) < tieTol;
    if (!tied || i === 0) {
      currentRank = i + 1;
      currentTier = entry.value <= 0 ? 10_000 + i : Math.round(entry.value);
    }
    out.push({
      item: entry.item,
      rank: currentRank,
      tier: currentTier,
      tiedWithPrevious: tied,
    });
    previousValue = entry.value;
  }
  return out;
}

/**
 * Índice 0–100 de una subregión contra el máximo del país (la región con más
 * interés = 100, como Google Trends). Entrada: valor crudo por región
 * (conteo de establecimientos, vistas, etc.). Si el máximo es 0 → todos 0.
 */
export function regionIndex(entries: { key: string; value: number }[]): {
  key: string;
  index: number;
}[] {
  const max = Math.max(0, ...entries.map((e) => e.value));
  if (max <= 0) return entries.map((e) => ({ key: e.key, index: 0 }));
  return entries.map((e) => ({ key: e.key, index: Math.round((e.value / max) * 100) }));
}
