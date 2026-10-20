"use client";

import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PROJECT_FIELD_TYPES,
  PROJECT_FIELD_TYPE_LABELS,
  PROJECT_TEMPLATE_ICONS,
  PROJECT_TEMPLATE_ICON_LABELS,
  slugifyProjectKey,
  type ProjectTemplateDetail,
  type ProjectTemplateInput,
  type ProjectTemplateStep,
  type ProjectTemplateTask,
} from "@/lib/project-templates";
import type { ProjectFieldDef, ProjectFieldOption } from "@/lib/project-types";

/**
 * Editor de un proceso de proyecto: pasos, campos de cada paso y seguimientos
 * iniciales. Los proyectos ya creados no se tocan — ellos congelaron su
 * definición al nacer.
 */

const FIELD_KEY_FALLBACK = "campo";
const STEP_KEY_FALLBACK = "paso";

type Draft = {
  label: string;
  description: string;
  icon: string;
  steps: ProjectTemplateStep[];
  tasks: ProjectTemplateTask[];
};

function emptyDraft(): Draft {
  return { label: "", description: "", icon: "layers", steps: [newStep(1)], tasks: [] };
}

function toDraft(template: ProjectTemplateDetail): Draft {
  return {
    label: template.label,
    description: template.description ?? "",
    icon: template.icon,
    steps: template.steps.map((step) => ({
      key: step.key,
      label: step.label,
      description: step.description ?? null,
      fields: step.fields.map((field) => ({ ...field })),
    })),
    tasks: template.tasks.map((task) => ({
      title: task.title,
      description: task.description ?? null,
    })),
  };
}

/** Clave única dentro del conjunto, derivada del nombre visible. */
function uniqueKey(base: string, taken: Set<string>, fallback: string): string {
  const root = slugifyProjectKey(base, fallback);
  if (!taken.has(root)) return root;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${root}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root}_${Date.now().toString(36)}`;
}

function newStep(index: number): ProjectTemplateStep {
  return {
    key: `paso_${index}`,
    label: `Paso ${index}`,
    description: null,
    fields: [{ key: `campo_${index}`, label: "Nuevo campo", type: "text" }],
  };
}

function newField(index: number): ProjectFieldDef {
  return { key: `campo_${index}`, label: "Nuevo campo", type: "text" };
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: ProjectFieldOption[];
  onChange: (next: ProjectFieldOption[]) => void;
}) {
  return (
    <div className="space-y-1.5 rounded border bg-subtle p-2">
      <p className="text-[11px] font-medium text-text-3">Opciones de la lista</p>
      {options.map((option, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            aria-label={`Valor de opción ${i + 1}`}
            className="h-8 w-28 text-xs"
            value={option.value}
            onChange={(e) => {
              const next = options.slice();
              next[i] = { ...option, value: e.target.value.trim() };
              onChange(next);
            }}
          />
          <Input
            aria-label={`Etiqueta de opción ${i + 1}`}
            className="h-8 flex-1 text-xs"
            value={option.label}
            onChange={(e) => {
              const next = options.slice();
              next[i] = { ...option, label: e.target.value };
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => onChange(options.filter((_, j) => j !== i))}
            aria-label={`Quitar opción ${i + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...options,
            { value: uniqueKey(`opcion${options.length + 1}`, new Set(options.map((o) => o.value)), "opcion"), label: "" },
          ])
        }
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Añadir opción
      </Button>
    </div>
  );
}

function FieldEditor({
  field,
  onChange,
  onRemove,
}: {
  field: ProjectFieldDef;
  onChange: (next: ProjectFieldDef) => void;
  onRemove: () => void;
}) {
  const needsOptions = field.type === "select" || field.type === "multiselect";
  const isNumber = field.type === "number" || field.type === "currency";
  return (
    <div className="space-y-2 rounded-lg border p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-3" aria-hidden="true" />
        <Input
          aria-label="Nombre del campo"
          className="h-8 min-w-32 flex-1 text-sm"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          placeholder="Nombre del campo"
        />
        <select
          aria-label="Tipo de campo"
          className="h-8 rounded border bg-background px-2 text-xs"
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as ProjectFieldDef["type"];
            onChange({
              ...field,
              type,
              options: type === "select" || type === "multiselect" ? field.options ?? [] : undefined,
            });
          }}
        >
          {PROJECT_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>{PROJECT_FIELD_TYPE_LABELS[type]}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-text-2">
          <input
            type="checkbox"
            checked={field.required === true}
            onChange={(e) => onChange({ ...field, required: e.target.checked ? true : undefined })}
          />
          Obligatorio
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-danger-text"
          onClick={onRemove}
          aria-label={`Quitar campo ${field.label}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        <Input
          aria-label="Texto de ayuda"
          className="h-8 text-xs"
          value={field.help ?? ""}
          onChange={(e) => onChange({ ...field, help: e.target.value || undefined })}
          placeholder="Texto de ayuda (opcional)"
        />
        <Input
          aria-label="Valor sugerido"
          className="h-8 text-xs"
          value={field.placeholder ?? ""}
          onChange={(e) => onChange({ ...field, placeholder: e.target.value || undefined })}
          placeholder="Valor sugerido (opcional)"
        />
      </div>

      {isNumber && (
        <div className="flex gap-1.5">
          <Input
            aria-label="Mínimo"
            type="number"
            className="h-8 w-28 text-xs"
            value={field.min ?? ""}
            onChange={(e) => onChange({ ...field, min: e.target.value === "" ? undefined : Number(e.target.value) })}
            placeholder="mín."
          />
          <Input
            aria-label="Máximo"
            type="number"
            className="h-8 w-28 text-xs"
            value={field.max ?? ""}
            onChange={(e) => onChange({ ...field, max: e.target.value === "" ? undefined : Number(e.target.value) })}
            placeholder="máx."
          />
        </div>
      )}

      {needsOptions && (
        <OptionsEditor options={field.options ?? []} onChange={(options) => onChange({ ...field, options })} />
      )}
    </div>
  );
}

export function ProjectTemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: ProjectTemplateDetail | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (template ? toDraft(template) : emptyDraft()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = template === null;
  const readOnly = template?.isSystem === true;

  function setStep(index: number, next: ProjectTemplateStep) {
    setDraft((d) => ({ ...d, steps: d.steps.map((s, i) => (i === index ? next : s)) }));
  }

  function moveStep(index: number, delta: -1 | 1) {
    setDraft((d) => {
      const target = index + delta;
      if (target < 0 || target >= d.steps.length) return d;
      const steps = d.steps.slice();
      const a = steps[index];
      const b = steps[target];
      if (!a || !b) return d;
      steps[index] = b;
      steps[target] = a;
      return { ...d, steps };
    });
  }

  /** El servidor exige claves válidas y únicas: se derivan del nombre visible. */
  function normalize(draft: Draft): ProjectTemplateInput {
    const usedSteps = new Set<string>();
    const steps: ProjectTemplateStep[] = draft.steps.map((step, i) => {
      const key = usedSteps.has(step.key) || !step.key
        ? uniqueKey(step.label, usedSteps, `${STEP_KEY_FALLBACK}_${i + 1}`)
        : step.key;
      usedSteps.add(key);
      const usedFields = new Set<string>();
      return {
        key,
        label: step.label.trim(),
        description: step.description?.trim() || null,
        fields: step.fields.map((field, j) => {
          const key2 = usedFields.has(field.key) || !field.key
            ? uniqueKey(field.label, usedFields, `${FIELD_KEY_FALLBACK}_${j + 1}`)
            : field.key;
          usedFields.add(key2);
          const options =
            field.type === "select" || field.type === "multiselect"
              ? (field.options ?? []).filter((o) => o.value && o.label)
              : undefined;
          return {
            ...field,
            key: key2,
            label: field.label.trim(),
            placeholder: field.placeholder?.trim() || undefined,
            help: field.help?.trim() || undefined,
            options: options?.length ? options : undefined,
            min: field.min,
            max: field.max,
            required: field.required || undefined,
          };
        }),
      };
    });
    return {
      label: draft.label.trim(),
      description: draft.description.trim() || null,
      icon: draft.icon as ProjectTemplateInput["icon"],
      steps,
      tasks: draft.tasks
        .filter((task) => task.title.trim())
        .map((task) => ({
          title: task.title.trim(),
          description: task.description?.trim() || null,
        })),
    };
  }

  function validate(input: ProjectTemplateInput): string | null {
    if (!input.label) return "Ponle nombre al proceso";
    if (input.steps.length === 0) return "El proceso necesita al menos un paso";
    for (const step of input.steps) {
      if (!step.label) return "Hay un paso sin nombre";
      if (step.fields.length === 0) return `El paso «${step.label}» necesita al menos un campo`;
      for (const field of step.fields) {
        if (!field.label) return `El paso «${step.label}» tiene un campo sin nombre`;
        if (
          (field.type === "select" || field.type === "multiselect") &&
          (!field.options || field.options.length === 0)
        ) {
          return `«${field.label}» es una lista y necesita al menos una opción`;
        }
      }
    }
    return null;
  }

  async function save() {
    const input = normalize(draft);
    const invalid = validate(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        isNew || !template ? "/api/project-templates" : `/api/project-templates/${template.id}`,
        {
          method: isNew ? "POST" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
          details?: Array<{ message?: string; path?: string[] }>;
        } | null;
        const detail = data?.details?.[0]?.message;
        setError(data?.error?.message ?? detail ?? "No se pudo guardar el proceso");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={isNew ? "Nuevo proceso" : `Editar ${template?.label ?? "proceso"}`}
        aria-modal="true"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-lg border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-5 py-3">
          <h3 className="text-base font-semibold">
            {isNew ? "Nuevo proceso de proyecto" : template?.label}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {readOnly
              ? "Proceso del sistema: solo lectura. Crea una copia personalizada si necesitas cambiarlo."
              : "Los proyectos ya creados conservan los pasos con los que nacieron."}
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="pt-label">Nombre del proceso</Label>
              <Input
                id="pt-label"
                value={draft.label}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Instalación de cámaras"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pt-icon">Ícono</Label>
              <select
                id="pt-icon"
                className="h-9 rounded border bg-background px-2 text-sm"
                value={draft.icon}
                disabled={readOnly}
                onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
              >
                {PROJECT_TEMPLATE_ICONS.map((icon) => (
                  <option key={icon} value={icon}>{PROJECT_TEMPLATE_ICON_LABELS[icon]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pt-desc">Descripción</Label>
            <Textarea
              id="pt-desc"
              rows={2}
              value={draft.description}
              disabled={readOnly}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Qué tipo de trabajo usa este proceso"
            />
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Pasos</h4>
              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, steps: [...d.steps, newStep(d.steps.length + 1)] }))}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Añadir paso
                </Button>
              )}
            </div>

            {draft.steps.map((step, i) => (
              <div key={i} className="space-y-2 rounded-lg border bg-subtle p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-5 shrink-0 text-center text-xs font-semibold text-text-3">{i + 1}</span>
                  <Input
                    aria-label={`Nombre del paso ${i + 1}`}
                    className="h-8 min-w-40 flex-1 text-sm"
                    value={step.label}
                    disabled={readOnly}
                    onChange={(e) => setStep(i, { ...step, label: e.target.value })}
                  />
                  {!readOnly && (
                    <>
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2" aria-label="Subir paso"
                        onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</Button>
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2" aria-label="Bajar paso"
                        onClick={() => moveStep(i, 1)} disabled={i === draft.steps.length - 1}>↓</Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-danger-text"
                        aria-label={`Quitar paso ${step.label}`}
                        onClick={() => setDraft((d) => ({ ...d, steps: d.steps.filter((_, j) => j !== i) }))}
                        disabled={draft.steps.length <= 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                <Input
                  aria-label={`Descripción del paso ${i + 1}`}
                  className="h-8 text-xs"
                  value={step.description ?? ""}
                  disabled={readOnly}
                  placeholder="Descripción breve del paso (opcional)"
                  onChange={(e) => setStep(i, { ...step, description: e.target.value || null })}
                />

                <div className="space-y-1.5 pl-5">
                  {step.fields.map((field, j) => (
                    <FieldEditor
                      key={j}
                      field={field}
                      onChange={(next) =>
                        setStep(i, { ...step, fields: step.fields.map((f, k) => (k === j ? next : f)) })
                      }
                      onRemove={() =>
                        setStep(i, { ...step, fields: step.fields.filter((_, k) => k !== j) })
                      }
                    />
                  ))}
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setStep(i, { ...step, fields: [...step.fields, newField(step.fields.length + 1)] })
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Añadir campo
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Seguimientos iniciales</h4>
              {!readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft((d) => ({ ...d, tasks: [...d.tasks, { title: "", description: null }] }))
                  }
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Añadir seguimiento
                </Button>
              )}
            </div>
            <p className="text-[11px] text-text-3">
              Tareas que se crean automáticamente en cada proyecto nuevo de este proceso.
            </p>
            {draft.tasks.map((task, i) => (
              <div key={i} className="flex flex-wrap gap-1.5">
                <Input
                  aria-label={`Título del seguimiento ${i + 1}`}
                  className="h-8 min-w-40 flex-1 text-sm"
                  value={task.title}
                  disabled={readOnly}
                  placeholder="Llamar al cliente para confirmar medidas"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      tasks: d.tasks.map((t, j) => (j === i ? { ...t, title: e.target.value } : t)),
                    }))
                  }
                />
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-danger-text"
                    aria-label={`Quitar seguimiento ${i + 1}`}
                    onClick={() => setDraft((d) => ({ ...d, tasks: d.tasks.filter((_, j) => j !== i) }))
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </section>

          {error && (
            <p role="alert" className="rounded border border-danger-soft bg-danger-tint px-3 py-2 text-xs text-danger-text">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {readOnly ? "Cerrar" : "Cancelar"}
          </Button>
          {!readOnly && (
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Guardando…" : "Guardar proceso"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
