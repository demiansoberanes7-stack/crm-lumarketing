"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Package, Pencil, Plus, Send, Trash2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadError } from "@/components/load-error";
import { webHref } from "@/lib/safe-url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImportInventoryDialog } from "@/components/catalog/import-inventory-dialog";
import { SendProductDialog } from "@/components/catalog/send-product-dialog";

interface Product {
  id: string;
  name: string;
  price: number;
  shortDescription: string | null;
  websiteUrl: string | null;
  stock: number | null;
  available: boolean;
}

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

const EMPTY_FORM = {
  name: "",
  price: "",
  shortDescription: "",
  websiteUrl: "",
  stock: "",
};

/** Inventario a payload: vacío = sin control (null). */
function stockPayload(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function stockLabel(stock: number | null): { text: string; variant: "success" | "secondary" | "warning" } {
  if (stock === null) return { text: "Consultar", variant: "secondary" };
  if (stock <= 0) return { text: "Agotado", variant: "warning" };
  return { text: `${stock} pieza${stock === 1 ? "" : "s"}`, variant: "success" };
}

export function CatalogClient({ compact = false, onClose }: { compact?: boolean; onClose?: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [sendingProduct, setSendingProduct] = useState<Product | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/catalog").catch(() => null);
    if (!res?.ok) {
      setListFailed(true);
      return;
    }
    const data = (await res.json()) as { products: Product[] };
    setProducts(data.products);
    setListFailed(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  function closeNew() {
    setShowNew(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  function editProduct(product: Product) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      price: (product.price / 100).toFixed(2),
      shortDescription: product.shortDescription ?? "",
      websiteUrl: product.websiteUrl ?? "",
      stock: product.stock === null ? "" : String(product.stock),
    });
    setFormError("");
    setShowNew(true);
  }

  async function saveProduct() {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch(editingId ? `/api/catalog/${editingId}` : "/api/catalog", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          price: Math.round(Number(form.price) * 100),
          shortDescription: form.shortDescription || null,
          websiteUrl: form.websiteUrl.trim() || null,
          stock: stockPayload(form.stock),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setFormError(data?.error?.message ?? "No se pudo guardar el producto.");
        return;
      }
      closeNew();
      await refetch();
    } catch {
      setFormError("No se pudo guardar el producto por un error de red.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(id: string) {
    await fetch(`/api/catalog/${id}`, { method: "DELETE" }).catch(() => null);
    void refetch();
  }

  return (
    <div className={`flex h-full flex-col ${compact ? "min-h-[70dvh]" : ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Inventario</h2>
          <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
            <Upload className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Importar
          </Button>
          <Button size="sm" variant="outline" onClick={() => { window.location.href = "/api/catalog/export"; }}>
            <Download className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Exportar
          </Button>
          <Button size="sm" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setFormError(""); setShowNew(true); }}>
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nuevo producto
          </Button>
        </div>
        {onClose && <Button size="sm" variant="ghost" onClick={onClose}>Cerrar</Button>}
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {listFailed && products.length === 0 ? (
          <LoadError
            message="No se pudo leer el inventario."
            detail="«Sin productos» sería otra cosa: la lista no llegó y el bot sí puede tener catálogo. Reintenta."
            onRetry={() => void refetch()}
          />
        ) : products.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Package className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium">Sin productos</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Agrega productos o servicios a tu inventario. El bot los usará para
              armar cotizaciones y responder disponibilidad.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <li
                key={p.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      {p.shortDescription && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {p.shortDescription}
                        </p>
                      )}
                      {p.websiteUrl && (
                        <a
                          href={webHref(p.websiteUrl) ?? undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block truncate text-xs text-primary hover:underline"
                        >
                          {p.websiteUrl}
                        </a>
                      )}
                    </div>
                     {!compact && (
                       <Button
                         variant="ghost"
                         size="icon"
                         className="h-7 w-7 shrink-0"
                         onClick={() => setSendingProduct(p)}
                         aria-label={`Enviar ${p.name}`}
                         title="Enviar producto a un chat"
                       >
                         <Send className="h-3.5 w-3.5" />
                       </Button>
                     )}
                     <Button
                       variant="ghost"
                       size="icon"
                       className="h-7 w-7 shrink-0"
                       onClick={() => editProduct(p)}
                       aria-label={`Editar ${p.name}`}
                     >
                       <Pencil className="h-3.5 w-3.5" />
                     </Button>
                     <Button
                       variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 opacity-100 transition-opacity sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover:opacity-100"
                      onClick={() => void deleteProduct(p.id)}
                      aria-label="Eliminar producto"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {(() => {
                        const s = stockLabel(p.stock);
                        return <Badge variant={s.variant} className="text-[10px]">{s.text}</Badge>;
                      })()}
                      {!p.available && <Badge variant="secondary" className="text-[10px]">No cotizable</Badge>}
                    </div>
                    <span className="text-sm font-bold tabular-nums">{formatMXN(p.price)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal nuevo o editar producto */}
      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
          onClick={closeNew}
        >
          <div
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="font-semibold">{editingId ? "Editar producto / servicio" : "Nuevo producto / servicio"}</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeNew}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 p-5">
              {/* Nombre */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-name">Nombre del producto / servicio *</Label>
                <Input
                  id="prod-name"
                  placeholder="Ej. Romance vintage"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>

              {/* Precio */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-price">Precio (MXN) *</Label>
                <Input
                  id="prod-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  onBlur={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) setForm((f) => ({ ...f, price: val.toFixed(2) }));
                  }}
                />
              </div>

              {/* Descripción corta (para WhatsApp) */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-short">
                  Descripción corta{" "}
                  <span className="text-xs text-muted-foreground">(aparece en el mensaje de WhatsApp)</span>
                </Label>
                <Input
                  id="prod-short"
                  maxLength={500}
                  placeholder="Ej. Ramo pequeño"
                  value={form.shortDescription}
                  onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))}
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {form.shortDescription.length}/500
                </p>
              </div>

              {/* URL del sitio web */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-url">
                  URL del sitio web{" "}
                  <span className="text-xs text-muted-foreground">(opcional — tienda, marketplace o landing del producto)</span>
                </Label>
                <Input
                  id="prod-url"
                  type="url"
                  placeholder="https://…"
                  value={form.websiteUrl}
                  onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
                />
              </div>

              {/* Inventario */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-stock">
                  Inventario (piezas){" "}
                  <span className="text-xs text-muted-foreground">(vacío = sin control, el agente dirá &quot;consultar&quot;)</span>
                </Label>
                <Input
                  id="prod-stock"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Ej. 12"
                  value={form.stock}
                  onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                />
              </div>

              {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <Button variant="ghost" onClick={closeNew}>Cancelar</Button>
              <Button
                disabled={saving || !form.name.trim() || !form.price}
                onClick={() => void saveProduct()}
              >
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Guardar producto"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportInventoryDialog
          onClose={() => setShowImport(false)}
          onImported={() => void refetch()}
        />
      )}

      {sendingProduct && (
        <SendProductDialog
          productId={sendingProduct.id}
          productName={sendingProduct.name}
          onClose={() => setSendingProduct(null)}
        />
      )}
    </div>
  );
}
