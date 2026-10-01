"use client";

import { useState } from "react";
import { ArrowRight, Layers, Hammer, MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PROJECT_TYPES, type ProjectTypeDef } from "@/lib/project-types";
import { taskRequest } from "@/components/tasks/api";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, typeof Layers> = {
  marketing: Layers,
  maintenance: Hammer,
  web_service: MonitorSmartphone,
};

/**
 * Selector de tipo de proyecto: punto de entrada de "Nuevo Proyecto".
 * Crea el proyecto en borrador y abre el stepper (wizard).
 */
export function ProjectTypePicker({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [selected, setSelected] = useState<ProjectTypeDef | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function crear() {
    if (!selected || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await taskRequest<{ projectId: string }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), projectType: selected.key }),
      });
      onCreated(res.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el proyecto");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Nuevo proyecto"
        aria-modal="true"
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold">Nuevo proyecto</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige el tipo de servicio. Cada tipo define su propio expediente de pasos.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {PROJECT_TYPES.map((type) => {
            const Icon = TYPE_ICONS[type.key] ?? Layers;
            const active = selected?.key === type.key;
            return (
              <button
                key={type.key}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected(type)}
                className={cn(
                  "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
                  active ? "border-brand bg-primary/10 ring-1 ring-brand" : "border-border"
                )}
              >
                <Icon className="h-4 w-4 text-brand" strokeWidth={1.8} />
                <span className="text-sm font-semibold">{type.label}</span>
                <span className="text-xs text-muted-foreground">{type.description}</span>
                <span className="text-[11px] text-muted-foreground">
                  {type.steps.length + 1} pasos
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="np-name">Nombre del proyecto</Label>
          <Input
            id="np-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaña de lanzamiento 2026"
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-text">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={!selected || !name.trim() || saving} onClick={() => void crear()}>
            {saving ? "Creando…" : "Crear y continuar"}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
