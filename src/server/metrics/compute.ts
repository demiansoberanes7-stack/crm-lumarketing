/**
 * Fórmulas de métricas centralizadas (Ciclo 1).
 *
 * Funciones PURAS, sin BD ni red: todo el mundo (dashboard, marketing hub,
 * rentabilidad, experimentos) llama aquí en vez de reimplementar. Reglas que
 * se cumplen en un solo lugar:
 *
 *  - "no disponible" NUNCA es 0: `safeDivide` devuelve `null`, no Infinity ni
 *    NaN, y el llamador lo traduce a un estado con explicación;
 *  - no se mezclan monedas: `sumByCurrency` deja montos separados por moneda;
 *  - no se suman duplicados de joins (el llamador deduplica antes);
 *  - los periodos comparativos exigen ventanas equivalentes (`percentChange`).
 */

export type MetricAvailability = "available" | "no_data" | "not_applicable" | "pending";

/** Resultado de una métrica con su disponibilidad explícita. */
export type MetricValue = {
  value: number | null;
  availability: MetricAvailability;
  /** Presentación sugerida para la UI (null cuando no hay valor). */
  formatted: string | null;
};

export function available(value: number, format?: (n: number) => string): MetricValue {
  return { value, availability: "available", formatted: format ? format(value) : String(value) };
}

export function unavailable(
  availability: Exclude<MetricAvailability, "available">,
  _reason?: string
): MetricValue {
  return { value: null, availability, formatted: null };
}

/**
 * División segura: denominador ≤ 0 o datos incompletos → null (no disponible),
 * jamás Infinity/NaN/0-inventado.
 */
export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** Porcentaje seguro: (n/d)×100, null cuando no hay base. */
export function safePercent(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  const ratio = safeDivide(numerator, denominator);
  return ratio == null ? null : ratio * 100;
}

/**
 * ROAS = ingresos ÷ inversión. Sin inversión (>0) no hay ROAS que reportar:
 * devuelve null para que la UI diga "no aplicable" en vez de "∞".
 */
export function roas(
  revenue: number | null | undefined,
  adSpend: number | null | undefined
): number | null {
  if (revenue == null || adSpend == null) return null;
  if (adSpend <= 0) return null;
  return revenue / adSpend;
}

/**
 * ROMI = (ingresos − inversión) ÷ inversión × 100. Negativo cuando la
 * inversión no se paga; null sin inversión.
 */
export function romi(
  revenue: number | null | undefined,
  adSpend: number | null | undefined
): number | null {
  if (revenue == null || adSpend == null) return null;
  if (adSpend <= 0) return null;
  return ((revenue - adSpend) / adSpend) * 100;
}

/**
 * CAC = costo de adquisición ÷ clientes nuevos. Sin clientes no hay CAC
 * definible (no se inventa un denominador).
 */
export function cac(
  acquisitionCost: number | null | undefined,
  newCustomers: number | null | undefined
): number | null {
  return safeDivide(acquisitionCost, newCustomers);
}

/**
 * Contribución = ingresos − costo de prestación − inversión publicitaria.
 * `adSpend` opcional: si no se conoce, se deja fuera y la métrica se marca
 * como parcial por el llamador.
 */
export function contribution(
  revenue: number,
  deliveryCost: number,
  adSpend?: number | null
): number {
  return revenue - deliveryCost - (adSpend ?? 0);
}

/** Margen de contribución = contribución ÷ ingresos × 100 (null si ingresos ≤ 0). */
export function contributionMargin(
  contributionCents: number | null | undefined,
  revenue: number | null | undefined
): number | null {
  return safePercent(contributionCents, revenue);
}

/**
 * Tasa de conversión simple (embudo): convertidos ÷ oportunidades × 100.
 * Usada por cada tramo del embudo; null cuando el tramo de arriba es 0.
 */
export function conversionRate(
  conversions: number | null | undefined,
  opportunities: number | null | undefined
): number | null {
  return safePercent(conversions, opportunities);
}

/** Tasa de cierre = ganados ÷ (ganados + perdidos) × 100. */
export function winRate(won: number, lost: number): number | null {
  return safePercent(won, won + lost);
}

/** Ticket promedio = ingresos ÷ cobros (null si no hay cobros). */
export function averageTicket(
  revenue: number | null | undefined,
  count: number | null | undefined
): number | null {
  return safeDivide(revenue, count);
}

/**
 * Variación porcentual entre dos periodos equivalentes.
 * Base 0 → null (no se puede decir "creció ∞%").
 */
export function percentChange(
  current: number | null | undefined,
  previous: number | null | undefined
): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Suma monetaria que NO mezcla monedas: devuelve un mapa moneda→monto y
 * `mixed` indica si hubo más de una, para que la UI no presente un total
 * engañoso en una sola cifra.
 */
export function sumByCurrency(
  rows: { amount: number; currency?: string | null }[]
): { totals: Record<string, number>; mixed: boolean } {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const currency = (row.currency ?? "MXN").toUpperCase();
    totals[currency] = (totals[currency] ?? 0) + row.amount;
  }
  return { totals, mixed: Object.keys(totals).length > 1 };
}

/**
 * Costo de adquisición = suma del costo de las campañas que tocaron el canal
 * dado, con una ventana [from, to]. El llamador entrega ya filtrado por canal
 * para no duplicar por joins.
 */
export function attributionWeightedSpend(
  spendRows: { spend: number; weight: number }[]
): number {
  return spendRows.reduce((total, r) => total + r.spend * (r.weight || 0), 0);
}

/** Promedio simple que ignora null (para tiempos de respuesta, etc.). */
export function averageOf(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Lift de experimento = (variante − control) ÷ control × 100.
 * Control 0 → null (no hay referencia).
 */
export function experimentLift(
  variantRate: number | null | undefined,
  controlRate: number | null | undefined
): number | null {
  return percentChange(variantRate, controlRate);
}

/**
 * Estado de evidencia de un experimento: "concluyente" solo si la diferencia
 * sale del intervalo de confianza; si los intervalos se solapan o faltan
 * datos, queda "inconcluso" — no se decrete ganador con muestra pobre.
 */
export function evidenceStatus(
  variantInterval: [number, number] | null,
  controlInterval: [number, number] | null
): "concluyente" | "inconcluso" {
  if (!variantInterval || !controlInterval) return "inconcluso";
  const [vLow] = variantInterval;
  const [, cHigh] = controlInterval;
  // Concluyente a favor de la variante si su intervalo mínimo supera el
  // máximo del control (no se solapan).
  if (vLow > cHigh) return "concluyente";
  return "inconcluso";
}

/** Formateadores sugeridos (MXN y porcentaje) para la UI. */
export const formatCurrency = (cents: number): string =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);

export const formatPercent = (n: number): string => `${n.toFixed(1)}%`;

export const formatRatio = (n: number): string => `${n.toFixed(2)}x`;
