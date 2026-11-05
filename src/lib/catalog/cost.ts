/**
 * Costos de producción: la cuenta, una sola vez.
 *
 * Módulo puro, sin dependencias de servidor, porque lo consumen las dos mitades
 * que tienen que dar el mismo número: `src/server/catalog/costs.ts`, que decide
 * qué se guarda y qué se responde, y el componente de la receta, que calcula en
 * vivo mientras el negocio escribe. Si el redondeo viviera en un solo lado, la
 * tarjeta diría 33 % y el servidor 33,5 % —y en dinero esas diferencias se
 * auditan.
 *
 * **Qué se guarda y qué no.** En la base de datos solo hay `quantity` y
 * `unit_price_cents`. Todo lo demás de este archivo se deriva en cada lectura:
 * el costo de la línea, el costo total, el porcentaje de mezcla y el margen. No
 * existe una columna `cost` que se pueda quedar vieja cuando sube la cera.
 */

/** Techo de líneas por receta: lo fija el servicio, y el `MAX` del validador. */
export const COST_LINES_MAX = 60;
export const COST_NAME_MAX = 255;
export const COST_UNIT_MAX = 16;
/** Cotas de las `CHECK` de 0090. Passarlas sería escribir una receta que el INSERT rechazaría. */
export const COST_MAX_QUANTITY = 1_000_000;
export const COST_MAX_UNIT_PRICE_CENTS = 100_000_000;

export type CostLineDraft = {
  id?: string | null;
  name: string;
  /**
   * Cantidad en la `unit` de la línea. Llega como `number` aunque en la BD sea
   * `numeric`: el controlador ya convirtió el texto exacto de Postgres.
   */
  quantity: number;
  unit: string;
  unitPriceCents: number;
};

export type CostLineView = CostLineDraft & {
  /** `quantity × unitPriceCents` redondeado al centavo. Nunca se guarda. */
  costCents: number;
  /**
   * % que este insumo ocupa de la mezcla. `null` si las unidades de la receta
   * no son comparables: 300 g y 2 piezas no suman un "5 unidades" de nada, y un
   * 60 % inventado es peor que un vacío explicado.
   */
  mixPct: number | null;
  /** % del costo total que aporta la línea. `null` si la receta no cuesta nada aún. */
  costPct: number | null;
};

export type CostTotals = {
  lineCount: number;
  totalCostCents: number;
  priceCents: number;
  /** Precio menos costo por unidad vendida. Negativo = se pierde dinero en cada venta. */
  marginCents: number;
  marginPct: number | null;
  /**
   * true si todas las líneas comparten unidad y por eso `mixPct` significa algo.
   * Con una sola línea no hay mezcla que repartir: se marca `false`.
   */
  mixComparable: boolean;
  /** Unidades distintas presentes, tal como las escribió el negocio. */
  units: string[];
  /**
   * Suma de cantidades. Se reporta para que la pantalla pueda advertir cuando
   * no cuadra con lo que el negocio cree que rinde una unidad, pero no es un
   * error: en una receta con merma siempre sobra algo.
   */
  totalQuantity: number;
};

export type ProductCostView = {
  lines: CostLineView[];
  totals: CostTotals;
};

const roundCents = (value: number): number => Math.round(value);

/** Un decimal: 33,333… % se muestra 33,3 %, no 33,333333333333.3. */
const roundPct = (value: number): number => Math.round(value * 10) / 10;

/** Costo de una línea. Expuesto porque el componente lo necesita suelto. */
export function lineCostCents(quantity: number, unitPriceCents: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPriceCents)) return 0;
  return roundCents(quantity * unitPriceCents);
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase();
}

/**
 * Margen sobre un costo total ya calculado.
 *
 * Existe como función exportada porque la rejilla de Inventario necesita el
 * mismo número que la receta, y la única forma de que no se separen es que los
 * dos llamen a esto. `marginPct` es `null` sin precio: 0 de base no es un
 * denominador, y mostrar «0 %» sería inventar.
 */
export function marginOf(
  priceCents: number,
  costCents: number
): { priceCents: number; marginCents: number; marginPct: number | null } {
  const price = Number.isFinite(priceCents) ? Math.round(priceCents) : 0;
  const cost = Number.isFinite(costCents) ? Math.round(costCents) : 0;
  const marginCents = price - cost;
  return {
    priceCents: price,
    marginCents,
    marginPct: price > 0 ? roundPct((marginCents / price) * 100) : null,
  };
}

/**
 * Todo el cálculo de una receta.
 *
 * No lanza: una línea mal formada (cantidad NaN, nombre vacío) se toma como
 * cero y se devuelve tal cual, porque esta función también alimenta la pantalla
 * mientras el usuario escribe a medias. La validación que rechaza está en el
 * zod del controlador.
 */
export function computeProductCost(
  priceCents: number,
  lines: readonly CostLineDraft[]
): ProductCostView {
  const safe = lines.map((line) => ({
    ...line,
    quantity: Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0,
    unitPriceCents: Number.isFinite(line.unitPriceCents) && line.unitPriceCents > 0
      ? Math.round(line.unitPriceCents)
      : 0,
  }));

  const costs = safe.map((line) => lineCostCents(line.quantity, line.unitPriceCents));
  const totalCostCents = costs.reduce((sum, cost) => sum + cost, 0);

  const units = [...new Set(safe.map((line) => line.unit.trim()).filter(Boolean))];
  // "kg" y "KG" son la misma medida; "kg" y "g" no, y esa es justo la trampa.
  const distinctNormalized = new Set(safe.map((line) => normalizeUnit(line.unit)));
  const mixComparable = safe.length > 1 && distinctNormalized.size === 1;
  const totalQuantity = safe.reduce((sum, line) => sum + line.quantity, 0);

  const views: CostLineView[] = safe.map((line, index) => {
    const cost = costs[index] ?? 0;
    return {
      ...line,
      costCents: cost,
      mixPct:
        mixComparable && totalQuantity > 0 ? roundPct((line.quantity / totalQuantity) * 100) : null,
      costPct: totalCostCents > 0 ? roundPct((cost / totalCostCents) * 100) : null,
    };
  });

  const margin = marginOf(priceCents, totalCostCents);

  return {
    lines: views,
    totals: {
      lineCount: views.length,
      totalCostCents,
      priceCents: margin.priceCents,
      marginCents: margin.marginCents,
      marginPct: margin.marginPct,
      mixComparable,
      units,
      totalQuantity,
    },
  };
}
