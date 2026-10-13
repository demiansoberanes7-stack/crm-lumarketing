"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COPILOT_DATA_SOURCES, type CopilotAccessMode, type CopilotDataSource } from "@/lib/copilot-config";

type Settings = { accessMode: CopilotAccessMode; dataSources: CopilotDataSource[] };

export function CopilotClient() {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/copilot/settings", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { settings?: Settings; error?: { message?: string } } | null;
      if (!response.ok || !data?.settings) throw new Error(data?.error?.message ?? "No se pudo cargar la configuración");
      setSaved(data.settings);
      setDraft(data.settings);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la configuración");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/copilot/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await response.json().catch(() => null) as { settings?: Settings; error?: { message?: string } } | null;
      if (!response.ok || !result?.settings) throw new Error(result?.error?.message ?? "No se pudo guardar la configuración");
      setSaved(result.settings);
      setDraft(result.settings);
      setNotice("Alcance del Copiloto guardado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la configuración");
    } finally {
      setBusy(false);
    }
  }

  function toggleSource(source: CopilotDataSource) {
    setDraft((current) => {
      if (!current) return current;
      const next = new Set(current.dataSources);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return { accessMode: "selected", dataSources: [...next] };
    });
    setNotice("");
  }

  if (!draft) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        {busy && <RefreshCw className="h-4 w-4 animate-spin" />}
        {error ? <span role="alert">{error}</span> : <span>Cargando la configuración del Copiloto…</span>}
        {error && <Button variant="outline" size="sm" onClick={() => void load()}>Reintentar</Button>}
      </div>
    );
  }

  const dirty = !saved || saved.accessMode !== draft.accessMode ||
    saved.dataSources.length !== draft.dataSources.length ||
    saved.dataSources.some((source) => !draft.dataSources.includes(source));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <p className="kicker">Asistente de consulta</p>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-brand" /> Alcance de datos del Copiloto
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-text-2">
          Define qué información puede consultar este asistente. Es independiente de la configuración del Agente de la bandeja.
        </p>
      </header>

      {error && <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">{error}</p>}
      {notice && <p role="status" className="rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Fuentes que puede consultar</CardTitle>
          <CardDescription>
            El Copiloto es de solo lectura. El permiso del usuario y el aislamiento de la organización se aplican en el servidor aunque selecciones todo el sistema.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
            <input
              type="radio"
              name="copilot-access-mode"
              checked={draft.accessMode === "all"}
              onChange={() => { setDraft({ accessMode: "all", dataSources: COPILOT_DATA_SOURCES.map((source) => source.key) }); setNotice(""); }}
            />
            <span>
              <span className="block text-sm font-semibold">Todo el sistema</span>
              <span className="mt-1 block text-xs text-muted-foreground">Habilita todas las fuentes de consulta que estén implementadas y autorizadas.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
            <input
              type="radio"
              name="copilot-access-mode"
              checked={draft.accessMode === "selected"}
              onChange={() => { setDraft({ ...draft, accessMode: "selected" }); setNotice(""); }}
            />
            <span>
              <span className="block text-sm font-semibold">Elegir fuentes</span>
              <span className="mt-1 block text-xs text-muted-foreground">El Copiloto solo construirá contexto con los módulos seleccionados.</span>
            </span>
          </label>

          <div className={`grid gap-3 sm:grid-cols-2 ${draft.accessMode === "all" ? "opacity-60" : ""}`}>
            {COPILOT_DATA_SOURCES.map((source) => (
              <label key={source.key} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
                <input
                  type="checkbox"
                  checked={draft.accessMode === "all" || draft.dataSources.includes(source.key)}
                  disabled={draft.accessMode === "all"}
                  onChange={() => toggleSource(source.key)}
                />
                <span>
                  <span className="block text-sm font-medium">{source.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{source.description}</span>
                </span>
              </label>
            ))}
          </div>

          {draft.accessMode === "selected" && draft.dataSources.length === 0 && (
            <p role="alert" className="text-sm text-danger-text">Selecciona al menos una fuente o elige todo el sistema.</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <span className="text-xs text-muted-foreground">Este ajuste no cambia el Agente de la bandeja ni sus reglas.</span>
            <Button disabled={busy || !dirty || (draft.accessMode === "selected" && draft.dataSources.length === 0)} onClick={() => void save()}>
              {busy ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Guardar alcance
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
