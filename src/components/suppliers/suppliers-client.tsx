"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { SupplierDto } from "@/lib/types";
import { SUPPLIER_CATEGORIES } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  SUPPLIER_CATEGORIES.map((c) => [c.value, c.label])
);

function Stars({ rating, onChange }: { rating: number; onChange?: (r: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          className={`${i <= (hover || rating) ? "text-amber-500" : "text-muted-foreground/30"} ${onChange ? "cursor-pointer hover:text-amber-400" : "cursor-default"}`}
          onClick={() => onChange?.(i === rating ? 0 : i)}
          onMouseEnter={() => onChange && setHover(i)}
          onMouseLeave={() => onChange && setHover(0)}
        >
          <Star className="h-4 w-4" fill={i <= (hover || rating) ? "currentColor" : "none"} strokeWidth={1.5} />
        </button>
      ))}
    </span>
  );
}

function SupplierDialog({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial?: SupplierDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    tradeName: "",
    contactName: "",
    phone: "",
    email: "",
    rfc: "",
    address: "",
    website: "",
    category: "",
    paymentTerms: "",
    rating: 0,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({
        name: initial.name ?? "",
        tradeName: initial.tradeName ?? "",
        contactName: initial.contactName ?? "",
        phone: initial.phone ?? "",
        email: initial.email ?? "",
        rfc: initial.rfc ?? "",
        address: initial.address ?? "",
        website: initial.website ?? "",
        category: initial.category ?? "",
        paymentTerms: initial.paymentTerms ?? "",
        rating: initial.rating ?? 0,
        notes: initial.notes ?? "",
      });
    } else {
      setForm({ name: "", tradeName: "", contactName: "", phone: "", email: "", rfc: "", address: "", website: "", category: "", paymentTerms: "", rating: 0, notes: "" });
    }
  }, [initial, open]);

  if (!open) return null;

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    setSaveError(null);
    const method = initial ? "PATCH" : "POST";
    const url = initial ? `/api/suppliers/${initial.id}` : "/api/suppliers";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        name: form.name.trim() || undefined,
        tradeName: form.tradeName || null,
        contactName: form.contactName || null,
        phone: form.phone || null,
        email: form.email || null,
        rfc: form.rfc || null,
        address: form.address || null,
        website: form.website || null,
        category: form.category || null,
        paymentTerms: form.paymentTerms || null,
        rating: form.rating || null,
        notes: form.notes || null,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      onSaved();
      onClose();
    } else {
      const data = await res?.json().catch(() => null);
      setSaveError(data?.error?.message ?? "Error al guardar");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold">{initial ? "Editar proveedor" : "Nuevo proveedor"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre de la empresa" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre comercial</label>
              <Input value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} placeholder="Alias" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Contacto</label>
              <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Persona de contacto" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefono</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Telefono" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="correo@ejemplo.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">RFC</label>
              <Input value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} placeholder="RFC" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Sitio web</label>
              <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Direccion</label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Direccion completa" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Categoria</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Sin categoria</option>
                {SUPPLIER_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Condiciones de pago</label>
              <Input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="Ej: Credito 30 dias" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Calificacion</label>
            <Stars rating={form.rating} onChange={(r) => setForm({ ...form, rating: r })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Notas</label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas sobre el proveedor..." rows={3} />
          </div>
        </div>
        {saveError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {saveError}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? "Guardando..." : initial ? "Guardar cambios" : "Crear proveedor"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SuppliersClient() {
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (category) params.set("category", category);
    if (showArchived) params.set("archived", "1");
    const res = await fetch(`/api/suppliers?${params}`).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { suppliers: SupplierDto[] };
    setSuppliers(data.suppliers);
  }, [query, category, showArchived]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/suppliers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    void refetch();
  }

  async function deleteSupplier(id: string, name: string) {
    if (!confirm(`Eliminar proveedor "${name}"?`)) return;
    await fetch(`/api/suppliers/${id}`, { method: "DELETE" }).catch(() => null);
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight">Proveedores</h2>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nuevo proveedor
          </Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-primary" />
            Archivados
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-xs"
          >
            <option value="">Todas las categorias</option>
            {SUPPLIER_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Buscar proveedor..."
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {suppliers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">Sin proveedores</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Agrega tus proveedores para tener su informacion centralizada.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {suppliers.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-3 sm:flex-nowrap sm:gap-x-4 sm:px-4"
              >
                {/* Avatar with initials */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                  {s.name.slice(0, 2).toUpperCase()}
                </div>

                <div className="min-w-[60%] flex-1 sm:min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    {s.category && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {CATEGORY_LABELS[s.category] ?? s.category}
                      </span>
                    )}
                    {s.archivedAt && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        Archivado
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {s.contactName && <span>{s.contactName}</span>}
                    {s.phone && <span>{s.phone}</span>}
                    {s.email && <span className="truncate">{s.email}</span>}
                    {s.rfc && <span className="font-mono">RFC: {s.rfc}</span>}
                    {s.rating != null && s.rating > 0 && <Stars rating={s.rating} />}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar"
                    onClick={() => { setEditing(s); setDialogOpen(true); }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={s.archivedAt ? "Desarchivar" : "Archivar"}
                    onClick={() => void patch(s.id, { archived: !s.archivedAt })}
                  >
                    {s.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Eliminar"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void deleteSupplier(s.id, s.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <SupplierDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        onSaved={refetch}
      />
    </div>
  );
}
