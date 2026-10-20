"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Briefcase,
  ChartLine,
  Hammer,
  Layers,
  MonitorSmartphone,
  Palette,
  Pencil,
  Plus,
  Rocket,
  Settings,
  Sparkles,
  Target,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProjectTemplateEditor } from "./project-template-editor";
import { taskRequest } from "@/components/tasks/api";
import { cn } from "@/lib/utils";
import type { ProjectTemplateDetail, ProjectTemplateSummary } from "@/lib/project-templates";

/**
 * Selector de proceso de proyecto: punto de entrada de "Nuevo Proyecto".
 *
 * La lista viene de `/api/project-templates`, así que cada negocio ve SUS
 * procesos: los tres base de la cuenta principal son de solo lectura (`isSystem`)
 * y en los demás negocios son copias editables. El owner puede crear, editar y
 * borrar desde aquí mismo; los proyectos ya creados no cambian, porque congelan
 * su definición al nacer.
 *
 * El nombre del proyecto es un DESPLEGABLE de cotizaciones sin proyecto
 * vinculado: al elegir una, el nombre pasa a ser "COT-0042 — Contacto" y el
 * proyecto queda relacionado con esa cotización (project_quote).
 */

const PROCESS_ICONS: Record<string, typeof Layers> = {
  layers: Layers,
  hammer: Hammer,
  monitor: MonitorSmartphone,
  briefcase: Briefcase,
  rocket: Rocket,
  settings: Settings,
  wrench: Wrench,
  palette: Palette,
  chart: ChartLine,
  users: Users,
  target: Target,
  sparkles: Sparkles,
};

type QuoteOption = { id: string; label: string };

type Editing =
  | { mode: "new" }
  | { mode: "edit"; template: ProjectTemplateDetail }
  | null;

export function ProjectTypePicker({
  onClose,
  onCreated,
  manageOnly = false,
}: {
  onClose: () => void;
  onCreated: (projectId: string) => void;
  /** Solo administrar procesos, sin alta de proyecto. */
  manageOnly?: boolean;
}) {
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<ProjectTemplateSummary | null>(null);
  const [name, setName] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [quotesFailed, setQuotesFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/project-templates", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as {
        templates?: ProjectTemplateSummary[];
        canManage?: boolean;
      } | null;
      if (!res.ok || !Array.isArray(data?.templates)) throw new Error("sin procesos");
      setTemplates(data.templates);
      setCanManage(data.canManage === true);
      setSelected((prev) => data.templates?.find((t) => t.key === prev?.key) ?? null);
      setLoaded(true);
    } catch {
      setError("No se pudieron cargar los procesos de tu negocio.");
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/quotes?forProject=1&limit=100", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as {
          quotes?: Array<{ id: string; quoteNumber: string; contactName: string | null }>;
        } | null;
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data?.quotes)) throw new Error("sin cotizaciones");
        setQuotes(
          data.quotes.map((q) => ({
            id: q.id,
            label: `${q.quoteNumber} — ${q.contactName?.trim() || "Sin contacto"}`,
          }))
        );
      } catch {
        if (!cancelled) setQuotesFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedQuote = quotes.find((q) => q.id === quoteId) ?? null;
  const finalName = selectedQuote ? selectedQuote.label : name.trim();

  async function crear() {
    if (!selected || !finalName) return;
    setSaving(true);
    setError(null);
    try {
      const res = await taskRequest<{ projectId: string }>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: finalName,
          projectType: selected.key,
          quoteId: selectedQuote?.id || undefined,
        }),
      });
      onCreated(res.projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el proyecto");
      setSaving(false);
    }
  }

  async function borrar(template: ProjectTemplateSummary) {
    const note =
      template.projectCount > 0
        ? ` Tiene ${template.projectCount} proyecto(s); conservan los pasos con los que nacieron.`
        : "";
    if (!window.confirm(`¿Borrar el proceso «${template.label}»?${note}`)) {
      return;
    }
    setDeleting(template.id);
    setError(null);
    try {
      const res = await fetch(`/api/project-templates/${template.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(data?.error?.message ?? "No se pudo borrar el proceso");
      } else {
        if (selected?.id === template.id) setSelected(null);
        await load();
      }
    } finally {
      setDeleting(null);
    }
  }

  async function abrirDetalle(template: ProjectTemplateSummary) {
    const res = await fetch(`/api/project-templates/${template.id}`, { cache: "no-store" });
    if (!res.ok) {
      setError("No se pudo abrir el proceso");
      return;
    }
    const data = (await res.json().catch(() => null)) as { template?: ProjectTemplateDetail } | null;
    if (data?.template) setEditing({ mode: "edit", template: data.template });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={manageOnly ? "Procesos de proyecto" : "Nuevo proyecto"}
        aria-modal="true"
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">
              {manageOnly ? "Procesos de proyecto" : "Nuevo proyecto"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {manageOnly
                ? "Cada negocio define sus propios procesos. Aquí se crean los pasos y seguimientos de los proyectos futuros."
                : "Elige el proceso. Cada uno define su propio expediente de pasos."}
            </p>
          </div>
          {canManage && !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing({ mode: "new" })}>
              <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
              Nuevo proceso
            </Button>
          )}
        </div>

        {loaded && templates.length === 0 && (
          <p className="mt-4 rounded border bg-subtle p-3 text-xs text-muted-foreground">
            Este negocio no tiene procesos configurados. {canManage ? "Crea el primero." : "Pide al propietario que cree el primero."}
          </p>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {templates.map((template) => {
            const Icon = PROCESS_ICONS[template.icon] ?? Layers;
            const active = selected?.key === template.key;
            return (
              <div
                key={template.id}
                className={cn(
                  "rounded-lg border transition-colors",
                  active && !manageOnly
                    ? "border-brand bg-primary/10 ring-1 ring-brand"
                    : "border-border"
                )}
              >
                <button
                  type="button"
                  aria-pressed={active}
                  disabled={manageOnly}
                  onClick={() => setSelected(template)}
                  className={cn(
                    "flex w-full flex-col items-start gap-1.5 p-3 text-left",
                    !manageOnly && "hover:bg-accent"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon className="h-4 w-4 text-brand" strokeWidth={1.8} />
                    <span className="text-sm font-semibold">{template.label}</span>
                    {template.isDefault && (
                      <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] text-text-2">por defecto</span>
                    )}
                    {template.isSystem && (
                      <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] text-text-2">fijo</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{template.description}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {template.stepsCount + 1} pasos · {template.tasksCount} seguimientos ·{" "}
                    {template.projectCount} proyectos
                  </span>
                </button>
                {canManage && (
                  <div className="flex items-center gap-1 border-t px-3 py-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void abrirDetalle(template)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      {template.isSystem ? "Ver" : "Editar"}
                    </Button>
                    {!template.isSystem && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-danger-text"
                        onClick={() => void borrar(template)}
                        disabled={deleting === template.id}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {deleting === template.id ? "Borrando…" : "Borrar"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!manageOnly && (
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="np-quote">Nombre del proyecto</Label>
            <select
              id="np-quote"
              value={quoteId}
              onChange={(e) => setQuoteId(e.target.value)}
              className="w-full rounded border bg-background p-2 text-sm"
            >
              <option value="">Sin cotización (escribir nombre)</option>
              {quotes.map((q) => (
                <option key={q.id} value={q.id}>{q.label}</option>
              ))}
            </select>
            {selectedQuote ? (
              <p className="text-xs text-muted-foreground">
                El proyecto llevará el nombre{" "}
                <span className="font-medium text-foreground">{selectedQuote.label}</span>{" "}
                y quedará vinculado a esta cotización.
              </p>
            ) : (
              <>
                <Input
                  id="np-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Campaña de lanzamiento 2026"
                />
                {quotesFailed && (
                  <p className="text-xs text-danger-text">
                    No se pudieron cargar las cotizaciones; puedes crear el proyecto sin vincular.
                  </p>
                )}
                {loaded && !quotesFailed && quotes.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No hay cotizaciones disponibles para vincular.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger-text">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cerrar
          </Button>
          {!manageOnly && (
            <Button disabled={!selected || !finalName || saving} onClick={() => void crear()}>
              {saving ? "Creando…" : "Crear y continuar"}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>

        {editing && (
          <ProjectTemplateEditor
            template={editing.mode === "edit" ? editing.template : null}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setError(null);
              void load();
            }}
          />
        )}
      </div>
    </div>
  );
}
