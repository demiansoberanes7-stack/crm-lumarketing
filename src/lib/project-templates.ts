/**
 * Procesos de proyecto por negocio — tipos, validación y sembrado.
 *
 * `PROJECT_TYPES` sigue siendo la definición declarativa de los tres procesos
 * base, pero a partir de la migración 0079 la fuente de verdad en ejecución es
 * `project_template`. Cada negocio recibe una copia propia: la de la cuenta
 * principal queda marcada como sistema (no editable) y las demás son editables.
 */
import { z } from "zod";
import {
  GENERAL_STEP,
  PROJECT_TASK_TEMPLATES,
  PROJECT_TYPES,
  type ProjectFieldDef,
  type ProjectFieldType,
  type ProjectStepDef,
} from "@/lib/project-types";

export const PROJECT_TEMPLATE_LIMITS = {
  maxTemplatesPerOrg: 20,
  maxSteps: 20,
  maxFieldsPerStep: 30,
  maxTasks: 30,
  maxOptions: 30,
  label: 80,
  description: 500,
  stepDescription: 300,
  fieldHelp: 300,
  placeholder: 120,
  optionLabel: 80,
  optionValue: 60,
  taskTitle: 120,
  taskDescription: 1000,
} as const;

export const PROJECT_TEMPLATE_ICONS = [
  "layers",
  "hammer",
  "monitor",
  "briefcase",
  "rocket",
  "settings",
  "wrench",
  "palette",
  "chart",
  "users",
  "target",
  "sparkles",
] as const;

export type ProjectTemplateIcon = (typeof PROJECT_TEMPLATE_ICONS)[number];

export const PROJECT_TEMPLATE_ICON_LABELS: Record<ProjectTemplateIcon, string> = {
  layers: "Capas",
  hammer: "Herramienta",
  monitor: "Pantalla",
  briefcase: "Maletín",
  rocket: "Cohete",
  settings: "Engranaje",
  wrench: "Llave",
  palette: "Paleta",
  chart: "Gráfica",
  users: "Personas",
  target: "Objetivo",
  sparkles: "Destellos",
};

export const PROJECT_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "currency",
  "date",
  "select",
  "multiselect",
  "checkbox",
  "contact",
  "member",
] as const satisfies readonly ProjectFieldType[];

export const PROJECT_FIELD_TYPE_LABELS: Record<ProjectFieldType, string> = {
  text: "Texto corto",
  textarea: "Texto largo",
  number: "Número",
  currency: "Moneda (MXN)",
  date: "Fecha",
  select: "Lista de opciones",
  multiselect: "Selección múltiple",
  checkbox: "Casilla",
  contact: "Contacto",
  member: "Miembro del equipo",
};

export interface ProjectTemplateStep {
  key: string;
  label: string;
  description?: string | null;
  fields: ProjectFieldDef[];
}

export interface ProjectTemplateTask {
  title: string;
  description?: string | null;
}

/** Definición congelada de un paso dentro de un proyecto. */
export interface ProjectStepDefinition {
  label: string;
  description: string | null;
  kind: "project" | "data";
  fields: ProjectFieldDef[];
}

export interface ProjectTemplateSummary {
  id: string;
  key: string;
  label: string;
  description: string | null;
  icon: string;
  position: number;
  isSystem: boolean;
  isDefault: boolean;
  stepsCount: number;
  tasksCount: number;
  projectCount: number;
}

export interface ProjectTemplateDetail {
  id: string;
  key: string;
  label: string;
  description: string | null;
  icon: string;
  position: number;
  isSystem: boolean;
  isDefault: boolean;
  steps: ProjectTemplateStep[];
  tasks: ProjectTemplateTask[];
}

const KEY_RE = /^[a-z][a-z0-9_]{0,49}$/;
const OPTION_VALUE_RE = /^[a-zA-Z0-9_-]+$/;

/** Convierte un nombre visible en una clave estable (sin acentos ni símbolos). */
export function slugifyProjectKey(value: string, fallback = "proceso"): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const safe = base || fallback;
  return /^[a-z]/.test(safe) ? safe : `p_${safe}`;
}

/** Clave única frente a las ya usadas, respetando el límite de 50 caracteres. */
export function uniqueProjectKey(
  value: string,
  taken: Set<string>,
  fallback = "proceso"
): string {
  const root = slugifyProjectKey(value, fallback).slice(0, 40);
  if (root !== GENERAL_STEP.key && !taken.has(root)) return root;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${root.slice(0, 45)}_${i}`;
    if (candidate !== GENERAL_STEP.key && !taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 36)}_${Date.now().toString(36)}`;
}

const optionSchema = z
  .object({
    value: z
      .string()
      .trim()
      .min(1, "El valor de la opción es obligatorio")
      .max(PROJECT_TEMPLATE_LIMITS.optionValue)
      .regex(OPTION_VALUE_RE, "Usa letras, números, guiones o guiones bajos"),
    label: z
      .string()
      .trim()
      .min(1, "La etiqueta de la opción es obligatoria")
      .max(PROJECT_TEMPLATE_LIMITS.optionLabel),
  })
  .strict();

const fieldSchema = z
  .object({
    key: z.string().trim().regex(KEY_RE, "Clave de campo inválida"),
    label: z.string().trim().min(1, "El nombre del campo es obligatorio").max(80),
    type: z.enum(PROJECT_FIELD_TYPES),
    required: z.boolean().optional(),
    placeholder: z.string().trim().max(PROJECT_TEMPLATE_LIMITS.placeholder).optional(),
    help: z.string().trim().max(PROJECT_TEMPLATE_LIMITS.fieldHelp).optional(),
    options: z.array(optionSchema).max(PROJECT_TEMPLATE_LIMITS.maxOptions).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.type === "select" || field.type === "multiselect") {
      if (!field.options?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Agrega al menos una opción en "${field.label}"`,
          path: ["options"],
        });
      }
      const values = (field.options ?? []).map((option) => option.value);
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Hay opciones repetidas en "${field.label}"`,
          path: ["options"],
        });
      }
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `El mínimo no puede ser mayor que el máximo en "${field.label}"`,
        path: ["min"],
      });
    }
  });

const stepSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(KEY_RE, "Clave de paso inválida")
      .refine((key) => key !== GENERAL_STEP.key, "La clave general está reservada"),
    label: z.string().trim().min(1, "El nombre del paso es obligatorio").max(80),
    description: z
      .string()
      .trim()
      .max(PROJECT_TEMPLATE_LIMITS.stepDescription)
      .nullable()
      .optional(),
    fields: z.array(fieldSchema).max(PROJECT_TEMPLATE_LIMITS.maxFieldsPerStep),
  })
  .strict()
  .superRefine((step, ctx) => {
    const keys = step.fields.map((field) => field.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Hay campos con la misma clave en "${step.label}"`,
        path: ["fields"],
      });
    }
  });

const taskSchema = z
  .object({
    title: z.string().trim().min(1, "El título del seguimiento es obligatorio").max(
      PROJECT_TEMPLATE_LIMITS.taskTitle
    ),
    description: z
      .string()
      .trim()
      .max(PROJECT_TEMPLATE_LIMITS.taskDescription)
      .nullable()
      .optional(),
  })
  .strict();

export const projectTemplateInputSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, "El nombre del proceso es obligatorio")
      .max(PROJECT_TEMPLATE_LIMITS.label),
    description: z
      .string()
      .trim()
      .max(PROJECT_TEMPLATE_LIMITS.description)
      .nullable()
      .optional(),
    icon: z.enum(PROJECT_TEMPLATE_ICONS).optional(),
    steps: z
      .array(stepSchema)
      .min(1, "Agrega al menos un paso")
      .max(PROJECT_TEMPLATE_LIMITS.maxSteps),
    tasks: z.array(taskSchema).max(PROJECT_TEMPLATE_LIMITS.maxTasks).optional(),
  })
  .strict()
  .superRefine((template, ctx) => {
    const keys = template.steps.map((step) => step.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hay pasos con la misma clave",
        path: ["steps"],
      });
    }
  });

export type ProjectTemplateInput = z.infer<typeof projectTemplateInputSchema>;

export interface DefaultProjectTemplateSeed {
  key: string;
  label: string;
  description: string;
  icon: ProjectTemplateIcon;
  steps: ProjectTemplateStep[];
  tasks: ProjectTemplateTask[];
}

const DEFAULT_ICONS: Record<string, ProjectTemplateIcon> = {
  marketing: "layers",
  maintenance: "hammer",
  web_service: "monitor",
};

/** Los tres procesos base, derivados del registro declarativo. */
export const DEFAULT_PROJECT_TEMPLATE_SEEDS: DefaultProjectTemplateSeed[] =
  PROJECT_TYPES.map((type) => ({
    key: type.key,
    label: type.label,
    description: type.description,
    icon: DEFAULT_ICONS[type.key] ?? "layers",
    steps: type.steps.map((step) => ({
      key: step.key,
      label: step.label,
      description: step.description ?? null,
      fields: step.fields,
    })),
    tasks: (PROJECT_TASK_TEMPLATES[type.key] ?? []).map((task) => ({
      title: task.title,
      description: task.description ?? null,
    })),
  }));

/** Resuelve el paso de un proyecto: definición congelada, estática o vacía. */
export function resolveStepDefinition(
  stepKey: string,
  stored: ProjectStepDefinition | null | undefined,
  fallback?: ProjectStepDef
): ProjectStepDef {
  if (stored && typeof stored === "object" && Array.isArray(stored.fields)) {
    return {
      key: stepKey,
      label: typeof stored.label === "string" && stored.label ? stored.label : stepKey,
      description: stored.description ?? undefined,
      kind: stored.kind === "project" ? "project" : "data",
      fields: stored.fields,
    };
  }
  if (fallback) return fallback;
  return {
    key: stepKey,
    label: stepKey,
    kind: "data",
    fields: [],
  };
}

/** Definición que se guarda cuando nace un proyecto. */
export function frozenStepDefinition(step: ProjectStepDef): ProjectStepDefinition {
  return {
    label: step.label,
    description: step.description ?? null,
    kind: step.kind,
    fields: step.fields,
  };
}
