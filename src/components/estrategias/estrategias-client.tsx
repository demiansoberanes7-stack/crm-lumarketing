"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Target, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Strategy {
  id: string;
  name: string;
  description: string | null;
  objectType: "offer" | "experiment" | "campaign";
  objectId: string;
  acquisitionChannelId: string | null;
  revenueTargetCents: number | null;
  conversionTarget: number | null;
  status: "active" | "paused" | "completed";
}

const OBJECT_TYPE_LABELS: Record<Strategy["objectType"], string> = {
  offer: "Oferta",
  experiment: "Experimento",
  campaign: "Campaña",
};

const STATUS_LABELS: Record<Strategy["status"], string> = {
  active: "Activa",
  paused: "Pausada",
  completed: "Completada",
};

function formatMXN(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

const EMPTY_FORM = {
  name: "",
  description: "",
  objectType: "offer" as Strategy["objectType"],
  objectId: "",
  revenueTargetCents: "",
  conversionTarget: "",
};

export function EstrategiasClient() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/strategies").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { strategies: Strategy[] };
      setStrategies(data.strategies);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  function closeNew() {
    setShowNew(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  function editStrategy(strategy: Strategy) {
    setEditingId(strategy.id);
    setForm({
      name: strategy.name,
      description: strategy.description ?? "",
      objectType: strategy.objectType,
      objectId: strategy.objectId,
      revenueTargetCents: strategy.revenueTargetCents?.toString() ?? "",
      conversionTarget: strategy.conversionTarget?.toString() ?? "",
    });
    setShowNew(true);
  }

  async function saveStrategy() {
    if (!form.name.trim()) {
      setFormError("El nombre es obligatorio");
      return;
    }
    if (!form.objectId.trim()) {
      setFormError("El ID del activo es obligatorio");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: form.name.trim(),
        // null explícito (no undefined): JSON.stringify ELIMINA las claves
        // undefined, así que el servidor las interpretaría como "no cambiar"
        // y un campo vaciado volvería a mostrar el valor viejo.
        description: form.description.trim() || null,
        objectType: form.objectType,
        objectId: form.objectId.trim(),
        revenueTargetCents: form.revenueTargetCents ? parseInt(form.revenueTargetCents) : null,
        conversionTarget: form.conversionTarget ? parseInt(form.conversionTarget) : null,
      };
      const res = await fetch(
        editingId ? `/api/strategies/${editingId}` : "/api/strategies",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setFormError(err?.error?.message ?? "Error al guardar");
        return;
      }
      closeNew();
      await refetch();
    } finally {
      setSaving(false);
    }
  }

  /** Lee {error:{message}} si la respuesta no es ok; null si no se pudo leer. */
  async function apiErrorMessage(res: Response | null): Promise<string | null> {
    if (!res || res.ok) return null;
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return err?.error?.message ?? "No se pudo completar la operación";
  }

  async function deleteStrategy(id: string) {
    if (!confirm("¿Eliminar esta estrategia?")) return;
    const res = await fetch(`/api/strategies/${id}`, { method: "DELETE" }).catch(() => null);
    const message = await apiErrorMessage(res);
    if (message) {
      // Sin esto el DELETE fallido se traga y la estrategia "revive" en el
      // refetch sin ningún aviso al usuario.
      alert(message);
    }
    await refetch();
  }

  async function toggleStatus(strategy: Strategy) {
    const next = strategy.status === "active" ? "paused" : "active";
    const res = await fetch(`/api/strategies/${strategy.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    const message = await apiErrorMessage(res);
    if (message) alert(message);
    await refetch();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Estrategias</h1>
          <p className="text-muted-foreground">
            Objetivos de ingresos y conversiones por activo
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nueva estrategia
        </Button>
      </div>

      {/* Formulario */}
      {showNew && (
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {editingId ? "Editar estrategia" : "Nueva estrategia"}
            </h2>
            <button onClick={closeNew} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Estrategia Q4"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="objectType">Tipo de activo</Label>
              <select
                id="objectType"
                value={form.objectType}
                onChange={(e) =>
                  setForm({ ...form, objectType: e.target.value as Strategy["objectType"] })
                }
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              >
                <option value="offer">Oferta</option>
                <option value="experiment">Experimento</option>
                <option value="campaign">Campaña</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="objectId">ID del activo</Label>
              <Input
                id="objectId"
                value={form.objectId}
                onChange={(e) => setForm({ ...form, objectId: e.target.value })}
                placeholder="ofr_xxx, exp_xxx, cmp_xxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Descripción opcional"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="revenueTarget">Objetivo de ingresos (centavos)</Label>
              <Input
                id="revenueTarget"
                type="number"
                value={form.revenueTargetCents}
                onChange={(e) => setForm({ ...form, revenueTargetCents: e.target.value })}
                placeholder="1000000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conversionTarget">Objetivo de conversiones</Label>
              <Input
                id="conversionTarget"
                type="number"
                value={form.conversionTarget}
                onChange={(e) => setForm({ ...form, conversionTarget: e.target.value })}
                placeholder="50"
              />
            </div>
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex gap-2">
            <Button onClick={saveStrategy} disabled={saving}>
              {saving ? "Guardando..." : editingId ? "Actualizar" : "Crear"}
            </Button>
            <Button variant="outline" onClick={closeNew}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : strategies.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="font-semibold mb-2">No hay estrategias</h3>
          <p className="text-muted-foreground mb-4">
            Crea estrategias para trackear objetivos de ingresos y conversiones
          </p>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Crear estrategia
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted">
                  <th className="p-3 text-left font-medium">Nombre</th>
                  <th className="p-3 text-left font-medium">Tipo</th>
                  <th className="p-3 text-left font-medium">Estado</th>
                  <th className="p-3 text-right font-medium">Ingreso objetivo</th>
                  <th className="p-3 text-right font-medium">Conversiones</th>
                  <th className="p-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {strategies.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{s.name}</div>
                      {s.description && (
                        <div className="text-sm text-muted-foreground">{s.description}</div>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline">{OBJECT_TYPE_LABELS[s.objectType]}</Badge>
                    </td>
                    <td className="p-3">
                      <button onClick={() => toggleStatus(s)}>
                        <Badge variant={s.status === "active" ? "success" : "secondary"}>
                          {STATUS_LABELS[s.status]}
                        </Badge>
                      </button>
                    </td>
                    <td className="p-3 text-right">
                      {s.revenueTargetCents != null ? formatMXN(s.revenueTargetCents) : "—"}
                    </td>
                    <td className="p-3 text-right">{s.conversionTarget ?? "—"}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => editStrategy(s)}>
                          Editar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteStrategy(s.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
