"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ContactPicker } from "@/components/contact-picker";
import { QuoteItem, formatMXNDisplay } from "./shared";

interface CatalogProduct {
  id: string;
  name: string;
  price: number;
  available: boolean;
}

const EMPTY_ITEM: QuoteItem = { name: "", quantity: 1, unitPrice: 0 };

function computeSubtotal(items: QuoteItem[]): number {
  return items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
}

export function NewQuoteDialog({
  onClose,
  onCreated,
  initial,
}: {
  onClose: () => void;
  onCreated: () => void;
  initial?: { id: string; items: QuoteItem[]; contactId: string | null; discountType: string | null; discountValue: number | null; taxRate: number; validUntil: string | null; message: string | null };
}) {
  const [items, setItems] = useState<QuoteItem[]>(initial ? initial.items.map((item) => ({ ...item, unitPrice: item.unitPrice / 100 })) : [{ ...EMPTY_ITEM }]);
  const [discountType, setDiscountType] = useState(initial?.discountType ?? "none");
  const [discountValue, setDiscountValue] = useState(initial?.discountValue != null ? String(initial.discountValue / (initial.discountType === "fixed" ? 100 : 1)) : "");
  const [taxRate, setTaxRate] = useState(String(initial?.taxRate ?? 16));
  const [validDays, setValidDays] = useState("30");
  const [notes, setNotes] = useState(initial?.message ?? "");
  const [contactId, setContactId] = useState<string | null>(initial?.contactId ?? null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((d: { products: CatalogProduct[] }) => setCatalog(d.products.filter((p) => p.available)))
      .catch(() => {});
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateItem = useCallback((index: number, field: keyof QuoteItem, value: string | number) => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, [field]: value } : it))
    );
  }, []);

  const selectCatalogProduct = useCallback((index: number, productId: string) => {
    const product = catalog.find((p) => p.id === productId);
    if (!product) return;
    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? { ...it, name: product.name, unitPrice: product.price / 100 }
          : it
      )
    );
  }, [catalog]);

  const subtotal = computeSubtotal(items);
  const discount =
    discountType === "fixed"
      ? Number(discountValue) || 0
      : discountType === "percentage"
        ? (subtotal * (Number(discountValue) || 0)) / 100
        : 0;
  const taxable = subtotal - discount;
  const tax = taxable * ((Number(taxRate) || 0) / 100);
  const total = taxable + tax;

  async function handleSave() {
    const validItems = items.filter((it) => it.name.trim() && it.unitPrice > 0);
    if (validItems.length === 0) return;
    setSaving(true);
    setError("");
    const response = await fetch(initial ? `/api/quotes/${initial.id}` : "/api/quotes", {
      method: initial ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contactId,
        items: validItems.map((item) => ({ ...item, unitPrice: Math.round(item.unitPrice * 100) })),
        discountType: discountType === "none" ? null : discountType,
        discountValue: discountValue ? (discountType === "fixed" ? Math.round(Number(discountValue) * 100) : Number(discountValue)) : undefined,
        taxRate: Number(taxRate),
        validDays: Number(validDays) || 30,
        notes: notes || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) { setError((await response?.json())?.error?.message ?? "No se pudo guardar la cotización"); return; }
    onCreated();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">{initial ? "Editar cotización" : "Nueva Cotización"}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <ContactPicker value={contactId} onChange={setContactId} />
          <div>
            <Label className="mb-2 block">Items</Label>
            <div className="space-y-3">
              {items.map((item, i) => (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Nombre del item"
                          value={item.name}
                          onChange={(e) => updateItem(i, "name", e.target.value)}
                          list={`catalog-names-${i}`}
                        />
                        <datalist id={`catalog-names-${i}`}>
                          {catalog.map((p) => (
                            <option key={p.id} value={p.name} />
                          ))}
                        </datalist>
                        <select
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) selectCatalogProduct(i, e.target.value);
                          }}
                        >
                          <option value="">Catálogo…</option>
                          {catalog.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {formatMXNDisplay(p.price / 100)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Label className="text-xs text-muted-foreground">Cantidad</Label>
                          <Input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateItem(i, "quantity", Number(e.target.value))}
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs text-muted-foreground">Precio unitario</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice || ""}
                            onChange={(e) => updateItem(i, "unitPrice", Number(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>
                    {items.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mt-6 shrink-0"
                        onClick={() => removeItem(i)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={addItem}>
              + Agregar item
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Descuento</Label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="none">Sin descuento</option>
                <option value="fixed">Monto fijo</option>
                <option value="percentage">Porcentaje</option>
              </select>
            </div>
            {discountType !== "none" && (
              <div className="space-y-1.5">
                <Label>Valor descuento</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>IVA (%)</Label>
              <Input
                type="number"
                min="0"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vigencia (días)</Label>
              <Input
                type="number"
                min="1"
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notas</Label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-md bg-secondary p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatMXNDisplay(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-destructive">
                <span>Descuento</span>
                <span>-{formatMXNDisplay(discount)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">IVA ({Number(taxRate) || 0}%)</span>
              <span>{formatMXNDisplay(tax)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border-strong pt-1 font-semibold">
              <span>Total</span>
              <span>{formatMXNDisplay(total)}</span>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={saving || items.every((it) => !it.name.trim() || it.unitPrice <= 0)}
              onClick={() => void handleSave()}
            >
              {saving ? "Guardando…" : "Crear cotización"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
