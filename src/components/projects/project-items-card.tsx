"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMXNCents } from "@/components/quotes/shared";
import { taskRequest } from "@/components/tasks/api";

interface ProjectItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  currency: string;
}

const EMPTY = { name: "", description: "", quantity: 1, unitPrice: 0 };

/**
 * Productos / servicios del expediente: la lista que imprime el PDF.
 * Los precios van en centavos (integer en DB); aquí se capturan en pesos.
 */
export function ProjectItemsCard({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [draft, setDraft] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await taskRequest<{ items: ProjectItem[] }>(`/api/projects/${projectId}/items`);
      setItems(res.items);
    } catch {
      // El PDF simplemente no mostrará la sección; no tira la vista.
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  async function addItem() {
    if (!draft.name.trim()) return;
    setBusy(true); setError("");
    try {
      await taskRequest(`/api/projects/${projectId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          quantity: draft.quantity,
          unitPrice: Math.round(draft.unitPrice * 100),
        }),
      });
      setDraft({ ...EMPTY });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo agregar la partida"); }
    finally { setBusy(false); }
  }

  async function removeItem(id: string) {
    setBusy(true); setError("");
    try {
      await taskRequest(`/api/projects/${projectId}/items/${id}`, { method: "DELETE" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar la partida"); }
    finally { setBusy(false); }
  }

  const total = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Productos / Servicios</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">Sección que aparece en el PDF del expediente.</p>
        </div>
        {!!items.length && <span className="text-sm font-semibold">{formatMXNCents(total)}</span>}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {items.length ? (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.quantity} × {formatMXNCents(item.unitPrice)}
                  </p>
                </div>
                <span className="font-semibold">{formatMXNCents(item.quantity * item.unitPrice)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Eliminar ${item.name}`}
                  disabled={busy}
                  onClick={() => void removeItem(item.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Sin productos todavía</p>
        )}

        <div className="space-y-2 rounded-md border border-dashed p-3">
          <div className="flex gap-2">
            <Input
              placeholder="Nombre del producto o servicio"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </div>
          <Input
            placeholder="Descripción (opcional, va en letra chica al PDF)"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Cantidad</Label>
              <Input
                type="number"
                min={1}
                value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: Math.max(1, Number(e.target.value) || 1) }))}
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Precio unitario</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.unitPrice || ""}
                onChange={(e) => setDraft((d) => ({ ...d, unitPrice: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" disabled={busy || !draft.name.trim()} onClick={() => void addItem()}>
                <Plus className="mr-1 h-4 w-4" /> Agregar
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
