"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string | null;
  available: boolean;
}

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

export function CatalogClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/catalog").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { products: Product[] };
    setProducts(data.products);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function addProduct() {
    if (!newName.trim() || !newPrice) return;
    setSaving(true);
    await fetch("/api/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        price: Math.round(Number(newPrice) * 100),
        description: newDesc || undefined,
      }),
    }).catch(() => null);
    setNewName("");
    setNewPrice("");
    setNewDesc("");
    setShowNew(false);
    setSaving(false);
    void refetch();
  }

  async function deleteProduct(id: string) {
    await fetch(`/api/catalog/${id}`, { method: "DELETE" }).catch(() => null);
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Catálogo de Productos</h2>
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nuevo Producto
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {products.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">Sin productos</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Agrega productos a tu catálogo para usarlos al crear cotizaciones.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {products.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3 sm:flex-nowrap"
              >
                <div className="min-w-[60%] flex-1 sm:min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge variant={p.available ? "success" : "secondary"}>
                      {p.available ? "Disponible" : "No disponible"}
                    </Badge>
                  </div>
                  {p.description && (
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{formatMXN(p.price)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void deleteProduct(p.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
          onClick={() => setShowNew(false)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 font-semibold">Nuevo Producto</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="prod-name">Nombre</Label>
                <Input
                  id="prod-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-price">Precio (MXN)</Label>
                <Input
                  id="prod-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-desc">Descripción (opcional)</Label>
                <Input
                  id="prod-desc"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowNew(false)}>
                Cancelar
              </Button>
              <Button
                disabled={saving || !newName.trim() || !newPrice}
                onClick={() => void addProduct()}
              >
                {saving ? "Guardando…" : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
