/**
 * Fórmulas de rentabilidad que operan sobre datos ya leídos de la BD.
 * A diferencia de `metrics/compute.ts` (funciones puras), estas reciben
 * arrays/objetos como parámetro para poder cruzar `project_item` con
 * `service_cost` y `campaign` con `campaign_insight`.
 */

// ── Margen por proyecto ──────────────────────────────────────────────

/** Ingreso total de un proyecto (= sum quantity × unitPrice de sus items). */
export function projectRevenue(items: { quantity: number; unitPrice: number }[]): number {
  return items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
}

/** Costo total de un proyecto: suma costCents × quantity por productId.
 *  `costs` es un map productId → costCents (viene de service_cost). */
export function projectCost(items: { quantity: number; unitPrice: number; productId: string | null }[], costs: Map<string, number>): number {
  let total = 0;
  for (const it of items) {
    const c = costs.get(it.productId ?? "") ?? 0;
    total += c * it.quantity;
  }
  return total;
}

/** Margen bruto de un proyecto: ingreso − costo. null si no hay datos. */
export function projectMargin(
  items: { quantity: number; unitPrice: number; productId: string | null }[],
  costs: Map<string, number>
): { revenue: number; cost: number; margin: number | null; marginPercent: number | null } {
  const revenue = projectRevenue(items);
  const cost = projectCost(items, costs);
  const margin = revenue >= cost ? revenue - cost : null;
  const marginPercent = revenue > 0 ? ((revenue - cost) / revenue) * 100 : null;
  return { revenue, cost, margin, marginPercent };
}

// ── Margen por campaña ───────────────────────────────────────────────

/** Varianza de presupuesto de campaña: planeado − actual. */
export function campaignBudgetVariance(plannedCents: number, actualCents: number): { diffCents: number; percent: number | null } {
  const diff = plannedCents - actualCents;
  const percent = plannedCents !== 0 ? (diff / plannedCents) * 100 : null;
  return { diffCents: diff, percent };
}

// ── Márgenes por etapa del pipeline ──────────────────────────────────

/** Margin average por etapa: given lead margins (null if not computable). */
export function pipelineStageMargins(
  margins: (number | null)[],
  stageId: string
): { stageId: string; avgMargin: number | null; count: number } {
  const valid = margins.filter((m): m is number => m != null);
  return {
    stageId,
    avgMargin: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
    count: valid.length,
  };
}