"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StepFields } from "./step-fields";
import { PdfActions } from "@/components/pdf-actions";
import { taskRequest } from "@/components/tasks/api";
import { cn } from "@/lib/utils";
import {
  GENERAL_STEP,
  PROJECT_STATUS_BADGE,
  PROJECT_STATUS_LABELS,
  findStep,
  getProjectType,
  stepZodSchema,
  type ProjectStatus,
  type ProjectStepDef,
} from "@/lib/project-types";

type StepStatus = "pendiente" | "en_proceso" | "completado";

interface StepView {
  key: string;
  label: string;
  description: string | null;
  kind: ProjectStepDef["kind"];
  position: number;
  status: StepStatus;
  data: Record<string, unknown>;
  completedAt: string | null;
}

interface ProjectInfo {
  id: string;
  code: string;
  name: string;
  projectType: string;
  status: ProjectStatus;
  avance: number;
  archivedAt: string | null;
}

interface SaveResult {
  step: StepView;
  avance: number;
  status: ProjectStatus;
  completedSteps: number;
  totalSteps: number;
}

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pendiente: "Pendiente",
  en_proceso: "Borrador guardado",
  completado: "Completado",
};

/**
 * Wizard de proyecto: stepper por tipo, borradores por paso,
 * salida/reanudación sin pérdida de datos y finalización + PDF.
 */
export function ProjectWizard({
  projectId,
  initialStep,
  onClose,
  onUpdated,
}: {
  projectId: string;
  initialStep?: number;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState(0);
  const [avance, setAvance] = useState(0);
  const [status, setStatus] = useState<ProjectStatus>("borrador");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        taskRequest<{ project: ProjectInfo }>(`/api/projects/${projectId}`),
        taskRequest<{ steps: StepView[]; avance: number; status: ProjectStatus }>(
          `/api/projects/${projectId}/steps`
        ),
      ]);
      setProject(p.project);
      setSteps(s.steps);
      setAvance(s.avance);
      setStatus(s.status);
      setValues(Object.fromEntries(s.steps.map((step) => [step.key, step.data])));
      setDirty({});
      const firstPending = s.steps.findIndex((step) => step.status !== "completado");
      setCurrent(initialStep ?? (firstPending >= 0 ? firstPending : 0));
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el proyecto");
      setLoading(false);
    }
  }, [projectId, initialStep]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestClose = useCallback(() => {
    const hasDirty = Object.values(dirty).some(Boolean);
    if (hasDirty && !confirm("Tienes cambios sin guardar. ¿Salir sin guardar?")) return;
    onUpdated?.();
    onClose();
  }, [dirty, onClose, onUpdated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const step = steps[current];
  const def: ProjectStepDef | undefined = step
    ? step.kind === "project"
      ? GENERAL_STEP
      : project
        ? findStep(project.projectType, step.key)
        : undefined
    : undefined;

  const goTo = (index: number) => {
    const cur = steps[current];
    if (cur && dirty[cur.key]) {
      if (!confirm("Tienes cambios sin guardar en este paso. ¿Descartarlos?")) return;
      setValues((v) => ({ ...v, [cur.key]: cur.data }));
      setDirty((d) => ({ ...d, [cur.key]: false }));
    }
    setError("");
    setFieldErrors({});
    setCurrent(index);
  };

  const setValue = (key: string, field: string, value: unknown) => {
    setValues((v) => ({
      ...v,
      [key]: { ...(v[key] ?? {}), [field]: value },
    }));
    setDirty((d) => ({ ...d, [key]: true }));
    setFieldErrors((e) => {
      if (!e[field]) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  };

  const save = async (complete: boolean): Promise<boolean> => {
    if (!step || !def) return false;
    const parsed = stepZodSchema(def).safeParse(values[step.key] ?? {});
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      setError("Revisa los campos marcados antes de guardar.");
      return false;
    }

    setSaving(true);
    setError("");
    try {
      const res = await taskRequest<SaveResult>(
        `/api/projects/${projectId}/steps/${step.key}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: parsed.data, complete }),
        }
      );
      setSteps((prev) =>
        prev.map((s) =>
          s.key === step.key
            ? { ...s, status: res.step.status, data: res.step.data, completedAt: res.step.completedAt }
            : s
        )
      );
      setValues((v) => ({ ...v, [step.key]: res.step.data }));
      setDirty((d) => ({ ...d, [step.key]: false }));
      setAvance(res.avance);
      setStatus(res.status);
      setFieldErrors({});
      if (step.kind === "project") {
        setProject((p) => (p ? { ...p, name: String(parsed.data.name ?? p.name), avance: res.avance, status: res.status } : p));
      }
      onUpdated?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el paso");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndNext = async () => {
    const ok = await save(true);
    if (ok) goTo(current + 1);
  };

  const finish = async () => {
    const cur = steps[current];
    // Guarda el paso actual aunque no esté "sucio": si sigue pendiente, finalizar
    // sin guardar dejaría el expediente incompleto (el backend lo rechaza con 422).
    if (cur && (dirty[cur.key] || cur.status !== "completado")) {
      const ok = await save(true);
      if (!ok) return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await taskRequest<{ avance: number; status: ProjectStatus }>(
        `/api/projects/${projectId}/status`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "completado" }),
        }
      );
      setAvance(res.avance);
      setStatus(res.status);
      setProject((p) => (p ? { ...p, avance: res.avance, status: res.status } : p));
      setCurrent(steps.length);
      onUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo finalizar el proyecto");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !project) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <p role="status" className="text-sm text-muted-foreground">
          {error || "Cargando expediente…"}
        </p>
        {error && (
          <Button variant="outline" className="ml-3" onClick={onClose}>
            Cerrar
          </Button>
        )}
      </div>
    );
  }

  const typeLabel = getProjectType(project.projectType)?.label ?? project.projectType;
  const isSummary = current >= steps.length;
  const completedCount = steps.filter((s) => s.status === "completado").length;
  const lastStep = steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={`Expediente de ${project.name}`}
    >
      {/* Cabecera */}
      <header className="flex flex-wrap items-center gap-3 border-b px-3 py-3 sm:px-6">
        <Button variant="ghost" size="icon" aria-label="Salir del expediente" onClick={requestClose}>
          <X className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground">
            {project.code} · {typeLabel}
          </p>
          <h3 className="truncate text-sm font-bold">{project.name}</h3>
        </div>
        <Badge variant={PROJECT_STATUS_BADGE[status] ?? "secondary"}>
          {PROJECT_STATUS_LABELS[status] ?? status}
        </Badge>
        <div className="flex w-32 items-center gap-2 sm:w-44">
          <div
            role="progressbar"
            aria-label="Avance del proyecto"
            aria-valuenow={avance}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 flex-1 overflow-hidden rounded-full bg-secondary"
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${avance}%` }} />
          </div>
          <span className="text-xs font-medium tabular-nums text-muted-foreground">{avance}%</span>
        </div>
      </header>

      {/* Stepper */}
      <nav className="overflow-x-auto border-b px-3 py-3 sm:px-6" aria-label="Pasos del proyecto">
        <ol className="flex min-w-max items-center gap-1.5">
          {steps.map((s, i) => {
            const active = i === current;
            const done = s.status === "completado";
            return (
              <li key={s.key}>
                <button
                  type="button"
                  aria-current={active ? "step" : undefined}
                  onClick={() => goTo(i)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-brand bg-primary/10 text-foreground"
                      : done
                        ? "border-border text-success-text hover:bg-accent"
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border text-[10px]",
                      done ? "border-success-text bg-success-tint" : active ? "border-brand" : "border-border-strong"
                    )}
                  >
                    {done ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {error && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}

          {isSummary ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" /> Proyecto finalizado
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {completedCount} de {steps.length} pasos completados · avance {avance}%
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={PROJECT_STATUS_BADGE[status] ?? "secondary"}>
                    {PROJECT_STATUS_LABELS[status] ?? status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{typeLabel}</span>
                </div>
                <p className="text-sm">
                  El expediente quedó guardado. Puedes descargar el PDF o volver al detalle para
                  revisarlo, editarlo o reabrirlo cuando lo necesites.
                </p>
                <div className="flex flex-wrap gap-2">
                  <PdfActions url={`/api/projects/${projectId}/pdf`} filename={`${project.code}.pdf`} />
                  <Button variant="outline" onClick={() => goTo(lastStep)}>
                    Seguir editando
                  </Button>
                  <Button onClick={onClose}>Ver expediente</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            step &&
            def && (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {current + 1}. {step.label}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">{STEP_STATUS_LABEL[step.status]}</span>
                  </div>
                  {step.description && (
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  )}
                </CardHeader>
                <CardContent>
                  <StepFields
                    step={def}
                    values={values[step.key] ?? {}}
                    onChange={(field, value) => setValue(step.key, field, value)}
                    disabled={saving}
                    errors={fieldErrors}
                  />
                </CardContent>
              </Card>
            )
          )}
        </div>
      </div>

      {/* Acciones */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-3 sm:px-6">
        {isSummary ? (
          <span className="text-xs text-muted-foreground">
            Guardado · {new Date().toLocaleDateString("es-MX")}
          </span>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={current === 0 || saving}
              onClick={() => goTo(current - 1)}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Anterior
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={() => void save(false)}
              >
                {saving ? "Guardando…" : "Guardar borrador"}
              </Button>
              {current < lastStep ? (
                <Button size="sm" disabled={saving} onClick={() => void saveAndNext()}>
                  Guardar y continuar <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" disabled={saving} onClick={() => void finish()}>
                  {saving ? "Guardando…" : "Guardar y finalizar"}
                </Button>
              )}
            </div>
          </>
        )}
      </footer>
    </div>
  );
}
