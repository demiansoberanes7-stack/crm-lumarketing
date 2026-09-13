"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ESTADOS = ["activo", "reunion", "cerrado"] as const;
const PRIORIDADES = ["alta", "media", "baja"] as const;
const RIESGOS = ["bajo", "medio", "alto"] as const;

export function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [service, setService] = useState("");
  const [estado, setEstado] = useState<(typeof ESTADOS)[number]>("activo");
  const [prioridad, setPrioridad] = useState<(typeof PRIORIDADES)[number]>("media");
  const [riesgo, setRiesgo] = useState<(typeof RIESGOS)[number]>("bajo");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        service: service.trim() || undefined,
        estado,
        prioridad,
        riesgo,
        notas: notas.trim() || undefined,
      }),
    }).catch(() => null);
    setSaving(false);

    if (!res) {
      setError("No se pudo guardar. Revisa tu conexión.");
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      setError(data?.error?.message ?? "No se pudo guardar el proyecto");
      return;
    }
    onCreated();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Nuevo proyecto"
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Nuevo proyecto</h3>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">Nombre</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campaña de Social Media"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="np-service">Servicio (opcional)</Label>
            <Input
              id="np-service"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="Social Media, Branding, Web..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-estado">Estado</Label>
              <select
                id="np-estado"
                value={estado}
                onChange={(e) => setEstado(e.target.value as (typeof ESTADOS)[number])}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                {ESTADOS.map((e) => (
                  <option key={e} value={e}>
                    {e === "activo" ? "Activo" : e === "reunion" ? "Reunión" : "Cerrado"}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-prioridad">Prioridad</Label>
              <select
                id="np-prioridad"
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value as (typeof PRIORIDADES)[number])}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="np-riesgo">Riesgo</Label>
            <select
              id="np-riesgo"
              value={riesgo}
              onChange={(e) => setRiesgo(e.target.value as (typeof RIESGOS)[number])}
              className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
            >
              {RIESGOS.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="np-notas">Notas (opcional)</Label>
            <Textarea
              id="np-notas"
              rows={3}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-danger-text">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!name.trim() || saving} onClick={() => void guardar()}>
            {saving ? "Guardando..." : "Crear proyecto"}
          </Button>
        </div>
      </div>
    </div>
  );
}
