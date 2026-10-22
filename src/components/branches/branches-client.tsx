"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Check,
  MapPin,
  Package,
  Pencil,
  Phone,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { BranchDto, BranchInventoryDto } from "@/lib/types";
import { BRANCH_QUANTITY_MAX } from "@/lib/branch-schema";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LoadError } from "@/components/load-error";

type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  currency: string;
  stock: number | null;
  available: boolean;
};

type BranchForm = {
  name: string;
  address: string;
  phone: string;
  notes: string;
  active: boolean;
};

const EMPTY_FORM: BranchForm = {
  name: "",
  address: "",
  phone: "",
  notes: "",
  active: true,
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(amount / 100);
  } catch {
    return `$${(amount / 100).toFixed(2)} ${currency}`;
  }
}

function stockText(stock: number | null): string {
  if (stock === null) return "sin control";
  if (stock <= 0) return "agotado";
  return `${stock} pieza${stock === 1 ? "" : "s"}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function BranchDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: BranchDto | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            name: initial.name,
            address: initial.address ?? "",
            phone: initial.phone ?? "",
            notes: initial.notes ?? "",
            active: initial.active,
          }
        : EMPTY_FORM
    );
    setError(null);
  }, [open, initial]);

  if (!open) return null;

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);

    const res = await fetch(initial ? `/api/branches/${initial.id}` : "/api/branches", {
      method: initial ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        notes: form.notes.trim() || null,
        active: form.active,
      }),
    }).catch(() => null);

    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo guardar la sucursal.");
      return;
    }

    await onSaved();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "Editar sucursal" : "Nueva sucursal"}
        className="my-auto max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">
            {initial ? "Editar sucursal" : "Nueva sucursal"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Nombre *
            </label>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ej. Sucursal Centro"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Dirección
            </label>
            <Input
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
              placeholder="Calle, número, colonia, ciudad"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Teléfono
            </label>
            <Input
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="Teléfono de la sucursal"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Notas
            </label>
            <Textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Horario, responsable, referencias…"
              rows={3}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm({ ...form, active: event.target.checked })}
              className="accent-primary"
            />
            Sucursal activa
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={saving || !form.name.trim()}>
            {saving ? "Guardando…" : initial ? "Guardar cambios" : "Crear sucursal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InventoryRow({
  item,
  onSave,
  onRemove,
}: {
  item: BranchInventoryDto;
  onSave: (quantity: number) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(String(item.quantity));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(String(item.quantity));
  }, [item.quantity]);

  const parsed = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= BRANCH_QUANTITY_MAX;
  const dirty = value !== String(item.quantity);

  async function save() {
    if (!valid || !dirty || saving) return;
    setSaving(true);
    const ok = await onSave(parsed);
    setSaving(false);
    if (!ok) setValue(String(item.quantity));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium">{item.name}</p>
          {!item.available && <Badge variant="warning">No disponible</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatMoney(item.price, item.currency)} · Stock general: {stockText(item.stock)}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label
          htmlFor={`branch-qty-${item.id}`}
          className="text-xs text-muted-foreground"
        >
          Cantidad
        </label>
        <Input
          id={`branch-qty-${item.id}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={BRANCH_QUANTITY_MAX}
          step={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          className="w-24 tabular-nums"
        />
        <Button
          size="icon"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty || !valid || saving}
          onClick={() => void save()}
          title="Guardar cantidad"
          aria-label={`Guardar cantidad de ${item.name}`}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onRemove}
          title="Quitar de la sucursal"
          aria-label={`Quitar ${item.name} de la sucursal`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {!valid && (
        <p className="w-full text-xs text-destructive">
          La cantidad debe ser un entero entre 0 y{" "}
          {BRANCH_QUANTITY_MAX.toLocaleString("es-MX")}.
        </p>
      )}
    </div>
  );
}

export function BranchesClient() {
  const [branches, setBranches] = useState<BranchDto[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [items, setItems] = useState<BranchInventoryDto[]>([]);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [productsFailed, setProductsFailed] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BranchDto | null>(null);
  const [addProductId, setAddProductId] = useState("");
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetchBranches = useCallback(async () => {
    const res = await fetch("/api/branches").catch(() => null);
    if (!res?.ok) {
      setListFailed(true);
      setLoadingBranches(false);
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      branches?: BranchDto[];
    } | null;
    if (!data?.branches) {
      setListFailed(true);
      setLoadingBranches(false);
      return;
    }
    setBranches(data.branches);
    setListFailed(false);
    setLoadingBranches(false);
  }, []);

  const refetchProducts = useCallback(async () => {
    const res = await fetch("/api/catalog?limit=500").catch(() => null);
    if (!res?.ok) {
      setProductsFailed(true);
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      products?: CatalogProduct[];
    } | null;
    if (!data?.products) {
      setProductsFailed(true);
      return;
    }
    setProducts(data.products);
    setProductsFailed(false);
  }, []);

  const loadItems = useCallback(async (branchId: string) => {
    setLoadingItems(true);
    const res = await fetch(`/api/branches/${branchId}/inventory`).catch(
      () => null
    );
    if (!res?.ok) {
      setItems([]);
      setItemsFailed(true);
      setLoadingItems(false);
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      items?: BranchInventoryDto[];
    } | null;
    if (!data?.items) {
      setItems([]);
      setItemsFailed(true);
      setLoadingItems(false);
      return;
    }
    setItems(data.items);
    setItemsFailed(false);
    setLoadingItems(false);
  }, []);

  useEffect(() => {
    void refetchBranches();
    void refetchProducts();
  }, [refetchBranches, refetchProducts]);

  useEffect(() => {
    if (branches.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !branches.some((branch) => branch.id === selectedId)) {
      setSelectedId(branches[0]!.id);
    }
  }, [branches, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setItems([]);
      setItemsFailed(false);
      return;
    }
    void loadItems(selectedId);
  }, [selectedId, loadItems]);

  const selected = branches.find((branch) => branch.id === selectedId) ?? null;
  const linkedIds = new Set(items.map((item) => item.productId));
  const availableProducts = products.filter((product) => !linkedIds.has(product.id));
  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  async function saveQuantity(
    branchId: string,
    productId: string,
    quantity: number
  ): Promise<boolean> {
    setActionError(null);
    const res = await fetch(`/api/branches/${branchId}/inventory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, quantity }),
    }).catch(() => null);

    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setActionError(data?.error?.message ?? "No se pudo guardar la cantidad.");
      return false;
    }

    await Promise.all([loadItems(branchId), refetchBranches()]);
    return true;
  }

  async function addProduct() {
    if (!selectedId || !addProductId) return;
    setAdding(true);
    const ok = await saveQuantity(selectedId, addProductId, 0);
    setAdding(false);
    if (ok) setAddProductId("");
  }

  async function removeProduct(branchId: string, item: BranchInventoryDto) {
    if (
      !confirm(
        `¿Quitar «${item.name}» de ${selected?.name ?? "esta sucursal"}? El producto sigue en el catálogo.`
      )
    ) {
      return;
    }
    setActionError(null);
    const res = await fetch(
      `/api/branches/${branchId}/inventory?productId=${encodeURIComponent(item.productId)}`,
      { method: "DELETE" }
    ).catch(() => null);
    if (!res?.ok) {
      setActionError("No se pudo quitar el producto de la sucursal.");
      return;
    }
    await Promise.all([loadItems(branchId), refetchBranches()]);
  }

  async function deleteBranch(branch: BranchDto) {
    if (
      !confirm(
        `¿Eliminar la sucursal «${branch.name}» y todo su inventario? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    setActionError(null);
    const res = await fetch(`/api/branches/${branch.id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      setActionError("No se pudo eliminar la sucursal.");
      return;
    }
    if (selectedId === branch.id) setSelectedId(null);
    await refetchBranches();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <div>
          <h2 className="text-[17px] font-bold tracking-tight">Sucursales</h2>
          <p className="text-xs text-muted-foreground">
            Inventario físico por sucursal, separado del stock general del catálogo.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
          Nueva sucursal
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <section aria-label="Sucursales" className="space-y-3">
            {loadingBranches ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-sm">
                Cargando sucursales…
              </p>
            ) : listFailed && branches.length === 0 ? (
              <LoadError
                message="No se pudo leer la lista de sucursales."
                detail="No es que no haya sucursales: la lista no llegó. Reintenta."
                onRetry={() => void refetchBranches()}
              />
            ) : branches.length === 0 ? (
              <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
                <Building2 className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-semibold">Sin sucursales todavía</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                  Da de alta la primera para enlazarle productos y llevar la
                  cantidad de piezas que hay en cada una.
                </p>
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Nueva sucursal
                </Button>
              </div>
            ) : (
              branches.map((branch) => {
                const isSelected = branch.id === selectedId;
                return (
                  <div
                    key={branch.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 shadow-sm transition-colors",
                      isSelected && "border-brand-text bg-brand-tint"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(branch.id)}
                      className="block w-full text-left"
                      aria-pressed={isSelected}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">{branch.name}</p>
                        <Badge variant={branch.active ? "success" : "secondary"}>
                          {branch.active ? "Activa" : "Inactiva"}
                        </Badge>
                      </div>
                      {branch.address && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {branch.address}
                        </p>
                      )}
                      {branch.phone && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          {branch.phone}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Package className="h-3.5 w-3.5" />
                          {plural(branch.skuCount, "producto", "productos")}
                        </span>
                        <span>{plural(branch.totalUnits, "pieza", "piezas")}</span>
                      </div>
                    </button>
                    <div className="mt-3 flex items-center justify-end gap-1 border-t pt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(branch);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => void deleteBranch(branch)}
                        aria-label={`Eliminar ${branch.name}`}
                        title="Eliminar sucursal"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          <section
            aria-label="Inventario de la sucursal"
            className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"
          >
            {!selected ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-semibold">
                  {branches.length === 0
                    ? "Crea tu primera sucursal"
                    : "Elige una sucursal"}
                </p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {branches.length === 0
                    ? "Cuando la des de alta aquí podrás enlazarle productos del catálogo y poner cuántas piezas hay en ella."
                    : "Selecciona una sucursal de la lista para ver y editar su inventario."}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{selected.name}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {plural(items.length, "producto enlazado", "productos enlazados")}{" "}
                      · {plural(totalUnits, "pieza", "piezas")} en esta sucursal
                    </p>
                  </div>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  El stock general del catálogo (el que usa el cotizador) no
                  cambia desde aquí: esta cantidad es el control físico de la
                  sucursal.
                </p>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <select
                    value={addProductId}
                    onChange={(event) => setAddProductId(event.target.value)}
                    disabled={adding || availableProducts.length === 0}
                    className="h-9 min-w-[200px] flex-1 rounded-lg border bg-background px-3 text-sm"
                    aria-label="Producto del catálogo para agregar"
                  >
                    <option value="">
                      {availableProducts.length === 0
                        ? "Todos los productos ya están enlazados"
                        : "Producto del catálogo…"}
                    </option>
                    {availableProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={() => void addProduct()}
                    disabled={!addProductId || adding}
                  >
                    {adding ? "Agregando…" : "Agregar"}
                  </Button>
                  {productsFailed && (
                    <button
                      type="button"
                      onClick={() => void refetchProducts()}
                      className="text-xs font-medium text-brand-text underline-offset-2 hover:underline"
                    >
                      No se pudo leer el catálogo. Reintentar
                    </button>
                  )}
                </div>

                {actionError && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {actionError}
                  </div>
                )}

                {itemsFailed ? (
                  <div className="mt-4">
                    <LoadError
                      message="No se pudo leer el inventario de esta sucursal."
                      detail="La sucursal existe, pero sus cantidades no llegaron. Reintenta."
                      onRetry={() => void loadItems(selected.id)}
                    />
                  </div>
                ) : loadingItems ? (
                  <p className="mt-4 rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                    Cargando inventario…
                  </p>
                ) : items.length === 0 ? (
                  <div className="mt-4 rounded-lg border bg-background p-5 text-center">
                    <Package className="mx-auto h-6 w-6 text-muted-foreground/50" />
                    <p className="mt-2 text-sm font-medium">
                      Esta sucursal aún no tiene productos
                    </p>
                    <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                      Elige un producto del catálogo arriba para enlazarlo y
                      anotar cuántas piezas hay. Si el catálogo está vacío,{" "}
                      <a
                        href="/catalog"
                        className="font-medium text-brand-text underline-offset-2 hover:underline"
                      >
                        créalo en Inventario
                      </a>
                      .
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 divide-y rounded-lg border bg-background">
                    {items.map((item) => (
                      <InventoryRow
                        key={item.id}
                        item={item}
                        onSave={(quantity) =>
                          saveQuantity(selected.id, item.productId, quantity)
                        }
                        onRemove={() => void removeProduct(selected.id, item)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <BranchDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={async () => {
          await refetchBranches();
          if (selectedId) await loadItems(selectedId);
        }}
      />
    </div>
  );
}
