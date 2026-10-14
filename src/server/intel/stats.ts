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
