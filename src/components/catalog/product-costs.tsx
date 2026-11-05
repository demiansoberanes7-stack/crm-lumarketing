"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COST_LINES_MAX,
  COST_MAX_QUANTITY,
  COST_MAX_UNIT_PRICE_CENTS,
  computeProductCost,
  type CostLineDraft,
} from "@/lib/catalog/cost";

/**
 * Receta de costos de un producto, dentro del modal de alta/edición.
 *
 * Calcula en el navegador con `computeProductCost`, la MISMA función que usa el
 * servidor, para que el número que el negocio ve mientras escribe sea el que va
 * a quedar guardado. No hay una segunda fórmula aquí.
 *
 * Guarda solo, como las fotos: `PUT` reemplaza la lista entera. Por eso el modal
 * de creación no lo muestra —no hay `product_id` al que colgar las líneas— y lo
 * dice en vez de dejar un botón que no hace nada.
 */

type Props = {
  productId: string | null;
  productName: string;
  /** Precio actual del producto en centavos, para el margen en vivo. */
  priceCents: number;
};

type Row = {
  /** Clave de React. Una fila nueva no tiene id hasta que el servidor la crea. */
  key: string;
  name: string;
  quantity: string;
  unit: string;
  /** Valor por unidad en MXN, como lo teclea el negocio. */
  unitPrice: string;
};

const EMPTY_ROW = (): Row => ({
  key: `n${Math.random().toString(36).slice(2, 10)}`,
  name: "",
  quantity: "",
  unit: "",
  unitPrice: "",
});

function money(cents: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

function toNumber(value: string): number {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

/** fila → borrador válido para `computeProductCost` y para el `PUT`. */
function toDraft(row: Row): CostLineDraft {
  return {
    name: row.name.trim(),
    quantity: toNumber(row.quantity),
    unit: row.unit.trim(),
    unitPriceCents: Math.round(toNumber(row.unitPrice) * 100),
  };
}

export function ProductCosts({ productId, productName, priceCents }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /** Costo plano vigente en Rentabilidad, para no dejar dos números sin explicar. */
  const [flatCostCents, setFlatCostCents] = useState<number | null>(null);

  const refetch = useCallback(async () => {
    if (!productId) return;
    const res = await fetch(`/api/catalog/${productId}/costs`).catch(() => null);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    const data = (await res.json()) as {
      lines: { name: string; quantity: number; unit: string; unitPriceCents: number }[];
      flatCostCents: number | null;
    };
    setRows(
      data.lines.map((line, index) => ({
        key: `${index}-${line.name}`,
        name: line.name,
        quantity: String(line.quantity),
        unit: line.unit,
        unitPrice: (line.unitPriceCents / 100).toFixed(2),
      }))
    );
    setFlatCostCents(data.flatCostCents);
    setFailed(false);
    setDirty(false);
  }, [productId]);

  useEffect(() => {
    setRows([]);
    setFailed(false);
    setError(null);
    setDirty(false);
    void refetch();
  }, [refetch]);

  const drafts = useMemo(() => rows.map(toDraft), [rows]);
  const view = useMemo(() => computeProductCost(priceCents, drafts), [priceCents, drafts]);

  function patchRow(key: string, patch: Partial<Row>) {
    setDirty(true);
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    if (rows.length >= COST_LINES_MAX) {
      setError(`Una receta no puede tener más de ${COST_LINES_MAX} insumos.`);
      return;
    }
    setDirty(true);
    setRows((prev) => [...prev, EMPTY_ROW()]);
  }

  function removeRow(key: string) {
    setDirty(true);
    setRows((prev) => prev.filter((row) => row.key !== key));
  }

  /**
   * Rechaza antes de mandar.
   *
   * El servidor también valida, pero un 422 que llega después de pulsar Guardar
   * no dice cuál fila está mal; aquí se dice. Y cantidad 0 es la única que tiene
   * dos lecturas: si el insumo no tiene cantidad todavía, la fila está a medio
   * hacer, no es un insumo gratis.
   */
  function validate(): string | null {
    if (rows.length > COST_LINES_MAX) return `Máximo ${COST_LINES_MAX} insumos.`;
    for (const row of rows) {
      if (!row.name.trim()) return "Todo insumo necesita nombre.";
      if (!row.unit.trim()) return `«${row.name.trim()}» no tiene unidad (kg, g, ml, pza…).`;
      const quantity = toNumber(row.quantity);
      if (quantity <= 0) return `«${row.name.trim()}» necesita una cantidad mayor que 0.`;
      if (quantity > COST_MAX_QUANTITY) return `«${row.name.trim()}» pasa la cantidad permitida.`;
      const cents = Math.round(toNumber(row.unitPrice) * 100);
      if (cents > COST_MAX_UNIT_PRICE_CENTS) {
        return `El valor por unidad de «${row.name.trim()}» pasa el límite permitido.`;
      }
    }
    return null;
  }

  async function save() {
    if (!productId) return;
    const rejection = validate();
    if (rejection) {
      setError(rejection);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/catalog/${productId}/costs`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: drafts }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo guardar la receta.");
      void refetch();
      return;
    }
    const data = (await res.json()) as { flatCostCents: number | null };
    setFlatCostCents(data.flatCostCents);
    setDirty(false);
  }

  if (!productId) {
    return (
      <p className="text-xs text-muted-foreground">
        Guarda primero «{productName || "el producto"}» para poder registrar su receta: los
        insumos se asocian al producto ya creado.
      </p>
    );
  }

  const t = view.totals;
  const negativeMargin = t.marginCents < 0;

  return (
    <div className="space-y-2">
      {failed ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium">No se pudo leer la receta de este producto.</p>
          <p className="mt-1 text-muted-foreground">
            «Sin insumos» sería otra cosa: la lista no llegó y guardar borraría lo que hay.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => void refetch()}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Sin insumos todavía. Mientras la receta esté vacía el costo de producción se
                muestra como «sin registrar», no como 0.
              </p>
            )}

            {view.lines.map((line, index) => {
              const row = rows[index]!;
              return (
                // Dos líneas por insumo: el modal de producto mide max-w-lg y en
                // móvil menos. Una fila de seis columnas no entra, y un panel que
                // solo se ve bien en escritorio no lo va a usar quien apunta la
                // receta desde el taller.
                <div key={row.key} className="space-y-1.5 rounded-lg border p-2">
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="min-w-0 flex-1"
                      value={row.name}
                      maxLength={255}
                      placeholder="Nombre del insumo (ej. Cera de soya)"
                      aria-label="Nombre del insumo"
                      onChange={(e) => patchRow(row.key, { name: e.target.value })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => removeRow(row.key)}
                      aria-label={`Quitar ${row.name.trim() || "insumo"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      className="w-20 shrink-0 text-right tabular-nums"
                      value={row.quantity}
                      inputMode="decimal"
                      placeholder="Cant."
                      aria-label={`Cantidad de ${row.name.trim() || "insumo"}`}
                      onChange={(e) => patchRow(row.key, { quantity: e.target.value })}
                    />
                    <Input
                      className="w-14 shrink-0"
                      value={row.unit}
                      maxLength={16}
                      placeholder="kg"
                      aria-label={`Unidad de ${row.name.trim() || "insumo"}`}
                      onChange={(e) => patchRow(row.key, { unit: e.target.value })}
                    />
                    <Input
                      className="w-24 shrink-0 text-right tabular-nums"
                      value={row.unitPrice}
                      inputMode="decimal"
                      placeholder="$/unidad"
                      aria-label={`Valor por unidad de ${row.name.trim() || "insumo"}`}
                      onChange={(e) => patchRow(row.key, { unitPrice: e.target.value })}
                    />
                    <span className="ml-auto min-w-0 shrink-0 text-right text-xs font-medium tabular-nums">
                      {money(line.costCents)}
                    </span>
                    <span
                      className="w-[4.5rem] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground"
                      title="% de la mezcla / % del costo"
                    >
                      {line.mixPct === null ? "—" : `${line.mixPct}%`}
                      <span className="text-text-3"> / </span>
                      {line.costPct === null ? "—" : `${line.costPct}%`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
              Agregar insumo
            </Button>
            <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={busy}>
              <RotateCcw className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
              Descartar cambios
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
              {busy ? "Guardando…" : "Guardar receta"}
            </Button>
            {dirty && <Badge variant="warning" className="text-[10px]">Sin guardar</Badge>}
          </div>

          {/* Cabecera de los dos porcentajes: sin esta línea, "33 / 66" no se entiende. */}
          <p className="text-[10px] text-muted-foreground">
            El primer % es el de la mezcla (cuánto ocupa el insumo en el producto) y el segundo es
            el del costo (cuánto aporta al total).
            {!t.mixComparable && t.lineCount > 1 && (
              <>
                {" "}
                El de la mezcla aparece en «—» porque las unidades no son comparables (
                {t.units.join(", ")}): para repartir la mezcla tienen que estar todas en kg, o
                todas en g.
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-subtle px-3 py-2 text-xs">
            <span>
              Costo de producción:{" "}
              <strong className="tabular-nums">{money(t.totalCostCents)}</strong>
            </span>
            <span>
              Precio: <strong className="tabular-nums">{money(t.priceCents)}</strong>
            </span>
            <span className={negativeMargin ? "font-semibold text-destructive" : ""}>
              Margen:{" "}
              <strong className="tabular-nums">{money(t.marginCents)}</strong>
              {t.marginPct !== null && <> ({t.marginPct}%)</>}
            </span>
            {negativeMargin && (
              <Badge variant="warning" className="text-[10px]">
                Cuesta más de lo que vale
              </Badge>
            )}
          </div>

          {flatCostCents !== null && (
            <p className="text-[10px] text-muted-foreground">
              Rentabilidad sigue usando el costo plano registrado para este producto (
              {money(flatCostCents)}). La receta no lo sustituye: si quieres que ambos números
              coincidan, actualízalo en Comercial.
            </p>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
