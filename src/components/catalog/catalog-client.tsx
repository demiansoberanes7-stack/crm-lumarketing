"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Package, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Product {
  id: string;
  name: string;
  price: number;
  description: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  imageUrl: string | null;
  available: boolean;
}

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

/** Sube un archivo al endpoint local de uploads y devuelve la URL pública */
async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/media/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error("No se pudo subir la imagen");
  const data = (await res.json()) as { url: string };
  return data.url;
}

const EMPTY_FORM = {
  name: "",
  price: "",
  description: "",
  shortDescription: "",
  longDescription: "",
  imageUrl: "",
};

export function CatalogClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/catalog").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { products: Product[] };
    setProducts(data.products);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  function closeNew() {
    setShowNew(false);
    setForm(EMPTY_FORM);
    setImagePreview(null);
  }

  async function handleImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    // Local preview instantáneo
    const objectUrl = URL.createObjectURL(file);
    setImagePreview(objectUrl);
    // Subida real
    setUploading(true);
    try {
      const url = await uploadImage(file);
      setForm((f) => ({ ...f, imageUrl: url }));
      // Reemplaza el object URL con el permanente
      setImagePreview(url);
    } catch {
      setImagePreview(null);
    } finally {
      setUploading(false);
    }
  }

  async function addProduct() {
    if (!form.name.trim() || !form.price) return;
    setSaving(true);
    await fetch("/api/catalog", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        price: Math.round(Number(form.price) * 100),
        description: form.description || undefined,
        shortDescription: form.shortDescription || undefined,
        longDescription: form.longDescription || undefined,
        imageUrl: form.imageUrl || undefined,
      }),
    }).catch(() => null);
    closeNew();
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
            <Package className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium">Sin productos</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Agrega productos o servicios a tu catálogo. El bot los usará para
              armar cotizaciones y fichas técnicas completas.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <li
                key={p.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Imagen del producto */}
                {p.imageUrl ? (
                  <div className="aspect-video w-full overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center bg-muted/50">
                    <Package className="h-10 w-10 text-muted-foreground/30" />
                  </div>
                )}

                <div className="flex flex-1 flex-col gap-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      {p.shortDescription && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {p.shortDescription}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => void deleteProduct(p.id)}
                      aria-label="Eliminar producto"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-2">
                    <Badge variant={p.available ? "success" : "secondary"} className="text-[10px]">
                      {p.available ? "Disponible" : "No disponible"}
                    </Badge>
                    <span className="text-sm font-bold tabular-nums">{formatMXN(p.price)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal nuevo producto */}
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
              <h3 className="font-semibold">Nuevo Producto / Servicio</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeNew}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 p-5">
              {/* Upload de imagen */}
              <div className="space-y-1.5">
                <Label>Imagen del producto</Label>
                <div
                  className="relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/40 transition-colors hover:border-primary/50 hover:bg-muted/60"
                  onClick={() => fileRef.current?.click()}
                >
                  {imagePreview ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreview} alt="preview" className="h-full w-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
                        <ImagePlus className="h-8 w-8 text-white" />
                        <span className="ml-2 text-sm font-medium text-white">Cambiar imagen</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <ImagePlus className="h-8 w-8" />
                      <span className="text-xs">{uploading ? "Subiendo…" : "Haz clic para subir imagen"}</span>
                    </div>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImageFile(file);
                  }}
                />
                {/* URL manual como fallback */}
                <Input
                  placeholder="…o pega una URL de imagen directamente"
                  value={form.imageUrl}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, imageUrl: e.target.value }));
                    if (e.target.value) setImagePreview(e.target.value);
                  }}
                />
              </div>

              {/* Nombre */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-name">Nombre del producto / servicio *</Label>
                <Input
                  id="prod-name"
                  placeholder="Ej. Diseño de sitio web corporativo"
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
                  placeholder="Ej. Sitio web responsivo en 15 días, con SEO incluido"
                  value={form.shortDescription}
                  onChange={(e) => setForm((f) => ({ ...f, shortDescription: e.target.value }))}
                />
                <p className="text-right text-[10px] text-muted-foreground">
                  {form.shortDescription.length}/500
                </p>
              </div>

              {/* Descripción larga (ficha técnica) */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-long">
                  Ficha técnica completa{" "}
                  <span className="text-xs text-muted-foreground">(para el agente y PDF de cotización)</span>
                </Label>
                <Textarea
                  id="prod-long"
                  rows={4}
                  placeholder="Describe características, alcance, tiempos de entrega, qué incluye, condiciones, etc."
                  value={form.longDescription}
                  onChange={(e) => setForm((f) => ({ ...f, longDescription: e.target.value }))}
                />
              </div>

              {/* Descripción interna (legacy) */}
              <div className="space-y-1.5">
                <Label htmlFor="prod-desc">
                  Nota interna{" "}
                  <span className="text-xs text-muted-foreground">(solo visible en el CRM)</span>
                </Label>
                <Input
                  id="prod-desc"
                  placeholder="Notas para tu equipo"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <Button variant="ghost" onClick={closeNew}>Cancelar</Button>
              <Button
                disabled={saving || uploading || !form.name.trim() || !form.price}
                onClick={() => void addProduct()}
              >
                {saving ? "Guardando…" : "Guardar producto"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
