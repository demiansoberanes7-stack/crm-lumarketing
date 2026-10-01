/**
 * Registro de tipos de proyecto — fuente única de verdad del módulo de proyectos.
 *
 * Cada tipo declara sus pasos y cada paso declara sus campos. De esta
 * definición se derivan: el schema Zod del servidor, el formulario del
 * stepper en el cliente, el orden del expediente y la estructura del PDF.
 *
 * Para agregar un tipo nuevo basta con una entrada en PROJECT_TYPES
 * (ej. diseño gráfico, automatización, consultoría…): no se requiere
 * tocar componentes, endpoints ni base de datos.
 */
import { z } from "zod";

/* ─── Estados de workflow del proyecto ─── */

export const PROJECT_STATUSES = [
  "borrador",
  "planeacion",
  "en_proceso",
  "en_revision",
  "completado",
  "cancelado",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  borrador: "Borrador",
  planeacion: "Planeación",
  en_proceso: "En proceso",
  en_revision: "En revisión",
  completado: "Completado",
  cancelado: "Cancelado",
};

export const PROJECT_STATUS_BADGE: Record<ProjectStatus, BadgeVariant> = {
  borrador: "secondary",
  planeacion: "outline",
  en_proceso: "default",
  en_revision: "warning",
  completado: "success",
  cancelado: "destructive",
};

/** Estados que cierran el ciclo y se reflejan en el `estado` legado. */
export function statusToEstado(status: ProjectStatus): "activo" | "cerrado" {
  return status === "completado" || status === "cancelado" ? "cerrado" : "activo";
}

/* ─── Campos ─── */

export type ProjectFieldType =
  | "text"
  | "textarea"
  | "number"
  | "currency"
  | "date"
  | "select"
  | "multiselect"
  | "checkbox"
  | "contact"
  | "member";

export interface ProjectFieldOption {
  value: string;
  label: string;
}

export interface ProjectFieldDef {
  key: string;
  label: string;
  type: ProjectFieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: ProjectFieldOption[];
  min?: number;
  max?: number;
}

/* ─── Pasos ─── */

export type ProjectStepKind =
  /** Los datos viven en columnas de `project` (paso general). */
  | "project"
  /** Los datos viven en `project_step.data`. */
  | "data";

export interface ProjectStepDef {
  key: string;
  label: string;
  description?: string;
  kind: ProjectStepKind;
  fields: ProjectFieldDef[];
}

/** Paso 0 de todo proyecto, sin importar el tipo: datos generales. */
export const GENERAL_STEP: ProjectStepDef = {
  key: "general",
  label: "Información general",
  description:
    "Datos base del proyecto: nombre, cliente, responsable, fechas y descripción.",
  kind: "project",
  fields: [
    {
      key: "name",
      label: "Nombre del proyecto",
      type: "text",
      required: true,
      placeholder: "Campaña de lanzamiento 2026",
    },
    { key: "contactId", label: "Cliente", type: "contact" },
    { key: "assignedUserId", label: "Responsable", type: "member" },
    { key: "startDate", label: "Fecha de inicio", type: "date" },
    { key: "endDate", label: "Fecha de término", type: "date" },
    {
      key: "notas",
      label: "Descripción",
      type: "textarea",
      placeholder: "Contexto, alcance o acuerdos del proyecto…",
    },
  ],
};

/* ─── Tipos de proyecto ─── */

export interface ProjectTypeDef {
  key: string;
  label: string;
  description: string;
  steps: ProjectStepDef[];
}

const opts = (...pairs: [string, string][]): ProjectFieldOption[] =>
  pairs.map(([value, label]) => ({ value, label }));

export const PROJECT_TYPES: ProjectTypeDef[] = [
  {
    key: "marketing",
    label: "Marketing",
    description:
      "Campañas, redes sociales, contenido y publicidad con objetivos y métricas.",
    steps: [
      {
        key: "objetivos",
        label: "Objetivos",
        description: "Qué debe lograr la estrategia y cómo se medirá.",
        kind: "data",
        fields: [
          {
            key: "objetivo",
            label: "Objetivo principal",
            type: "textarea",
            required: true,
            placeholder: "Aumentar la generación de leads calificados…",
          },
          {
            key: "meta",
            label: "Meta medible",
            type: "text",
            required: true,
            placeholder: "+30% de leads en 90 días",
          },
          {
            key: "alcance",
            label: "Alcance geográfico",
            type: "select",
            options: opts(
              ["local", "Local"],
              ["regional", "Regional"],
              ["nacional", "Nacional"],
              ["internacional", "Internacional"],
            ),
          },
        ],
      },
      {
        key: "presupuesto",
        label: "Presupuesto",
        description: "Inversión aprobada y duración de la estrategia.",
        kind: "data",
        fields: [
          {
            key: "presupuesto",
            label: "Presupuesto total (MXN)",
            type: "currency",
            required: true,
            min: 0,
          },
          {
            key: "inversion_mensual",
            label: "Inversión mensual en medios (MXN)",
            type: "currency",
            min: 0,
          },
          {
            key: "duracion_dias",
            label: "Duración de la campaña (días)",
            type: "number",
            min: 1,
            max: 730,
          },
          { key: "fecha_inicio_campana", label: "Inicio de campaña", type: "date" },
        ],
      },
      {
        key: "canales",
        label: "Canales y audiencia",
        description: "Dónde se publica y a quién se le habla.",
        kind: "data",
        fields: [
          {
            key: "canales",
            label: "Canales",
            type: "multiselect",
            required: true,
            options: opts(
              ["instagram", "Instagram"],
              ["facebook", "Facebook"],
              ["tiktok", "TikTok"],
              ["google_ads", "Google Ads"],
              ["email", "Email marketing"],
              ["youtube", "YouTube"],
            ),
          },
          {
            key: "audiencia",
            label: "Audiencia objetivo",
            type: "textarea",
            placeholder: "Edad, intereses, comportamiento de compra…",
          },
          {
            key: "frecuencia",
            label: "Frecuencia de publicación",
            type: "select",
            options: opts(
              ["diaria", "Diaria"],
              ["3_semanal", "3 veces por semana"],
              ["semanal", "Semanal"],
              ["quincenal", "Quincenal"],
            ),
          },
        ],
      },
      {
        key: "contenido",
        label: "Plan de contenido",
        description: "Pilares, tono y entregables creativos.",
        kind: "data",
        fields: [
          {
            key: "pilares",
            label: "Pilares de contenido",
            type: "textarea",
            required: true,
            placeholder: "Educación, casos de éxito, promociones…",
          },
          {
            key: "tono",
            label: "Tono de voz",
            type: "select",
            options: opts(
              ["profesional", "Profesional"],
              ["casual", "Casual"],
              ["divertido", "Divertido"],
              ["tecnico", "Técnico"],
            ),
          },
          {
            key: "entregables_semanales",
            label: "Entregables por semana",
            type: "number",
            min: 1,
            max: 50,
          },
          {
            key: "fecha_entrega_contenido",
            label: "Fecha de entrega de contenido",
            type: "date",
          },
        ],
      },
      {
        key: "metricas",
        label: "Métricas y reportes",
        description: "KPIs, herramientas y ritmo de reporte al cliente.",
        kind: "data",
        fields: [
          {
            key: "kpis",
            label: "KPIs a perseguir",
            type: "textarea",
            required: true,
            placeholder: "Alcance, engagement, CPL, ROAS…",
          },
          {
            key: "frecuencia_reporte",
            label: "Frecuencia de reporte",
            type: "select",
            options: opts(
              ["semanal", "Semanal"],
              ["quincenal", "Quincenal"],
              ["mensual", "Mensual"],
            ),
          },
          { key: "herramientas", label: "Herramientas de medición", type: "text" },
          { key: "fecha_primer_reporte", label: "Primer reporte", type: "date" },
        ],
      },
      {
        key: "cierre",
        label: "Entregables y cierre",
        description: "Qué se entrega al final y con quién se cierra.",
        kind: "data",
        fields: [
          {
            key: "entregables",
            label: "Entregables finales",
            type: "textarea",
            placeholder: "Reporte final, archivos editables, calendario…",
          },
          { key: "responsable_cliente", label: "Contacto de cierre", type: "text" },
          { key: "notas", label: "Notas adicionales", type: "textarea" },
        ],
      },
    ],
  },
  {
    key: "maintenance",
    label: "Mantenimiento",
    description:
      "Servicio preventivo o correctivo de equipos, inventario y visitas programadas.",
    steps: [
      {
        key: "inventario",
        label: "Inventario del equipo",
        description: "Identificación del equipo o instalación a dar mantenimiento.",
        kind: "data",
        fields: [
          {
            key: "tipo_equipo",
            label: "Tipo de equipo",
            type: "text",
            required: true,
            placeholder: "Aire acondicionado, generador, bomba…",
          },
          {
            key: "marca_modelo",
            label: "Marca y modelo",
            type: "text",
            required: true,
            placeholder: "Carrier 48TC",
          },
          { key: "numero_serie", label: "Número de serie", type: "text" },
          { key: "ubicacion", label: "Ubicación", type: "text", placeholder: "Planta baja, azotea…" },
        ],
      },
      {
        key: "condicion",
        label: "Condición actual",
        description: "Estado del equipo al momento de iniciar el servicio.",
        kind: "data",
        fields: [
          {
            key: "estado_general",
            label: "Estado general",
            type: "select",
            required: true,
            options: opts(
              ["operativo", "Operativo"],
              ["con_revision", "Bajo revisión"],
              ["fuera_de_servicio", "Fuera de servicio"],
            ),
          },
          { key: "ultima_revision", label: "Última revisión", type: "date" },
          {
            key: "fallas_reportadas",
            label: "Fallas reportadas",
            type: "textarea",
            placeholder: "Ruidos, fugas, errores en pantalla…",
          },
          {
            key: "prioridad_mantenimiento",
            label: "Prioridad",
            type: "select",
            options: opts(
              ["baja", "Baja"],
              ["media", "Media"],
              ["alta", "Alta"],
              ["critica", "Crítica"],
            ),
          },
        ],
      },
      {
        key: "plan",
        label: "Plan de mantenimiento",
        description: "Frecuencia, tipo de servicio y ventana de ejecución.",
        kind: "data",
        fields: [
          {
            key: "frecuencia",
            label: "Frecuencia",
            type: "select",
            required: true,
            options: opts(
              ["semanal", "Semanal"],
              ["quincenal", "Quincenal"],
              ["mensual", "Mensual"],
              ["trimestral", "Trimestral"],
              ["semestral", "Semestral"],
              ["anual", "Anual"],
            ),
          },
          {
            key: "tipo_servicio",
            label: "Tipos de servicio",
            type: "multiselect",
            required: true,
            options: opts(
              ["preventivo", "Preventivo"],
              ["correctivo", "Correctivo"],
              ["predictivo", "Predictivo"],
              ["limpieza", "Limpieza"],
              ["calibracion", "Calibración"],
            ),
          },
          { key: "proveedor", label: "Proveedor o técnico", type: "text" },
          {
            key: "ventana_horaria",
            label: "Ventana horaria",
            type: "text",
            placeholder: "Lunes a viernes 9:00–17:00",
          },
        ],
      },
      {
        key: "costos",
        label: "Costos y refacciones",
        description: "Presupuesto del servicio y piezas involucradas.",
        kind: "data",
        fields: [
          { key: "costo_estimado", label: "Costo estimado (MXN)", type: "currency", min: 0 },
          { key: "refacciones", label: "Refacciones necesarias", type: "textarea" },
          { key: "garantia_hasta", label: "Garantía hasta", type: "date" },
        ],
      },
      {
        key: "ejecucion",
        label: "Ejecución y seguimiento",
        description: "Quién ejecuta, cuándo y con qué checklist.",
        kind: "data",
        fields: [
          { key: "tecnico_asignado", label: "Técnico asignado", type: "text" },
          { key: "fecha_proxima_visita", label: "Próxima visita", type: "date" },
          {
            key: "checklist",
            label: "Checklist de trabajo",
            type: "textarea",
            placeholder: "Una tarea por línea…",
          },
          { key: "observaciones", label: "Observaciones", type: "textarea" },
        ],
      },
    ],
  },
  {
    key: "web_service",
    label: "Servicio Web",
    description:
      "Sitios, landings y sistemas a medida: requisitos, diseño, alcance técnico y entrega.",
    steps: [
      {
        key: "requisitos",
        label: "Requisitos del sitio",
        description: "Objetivo del sitio y situación actual del cliente.",
        kind: "data",
        fields: [
          {
            key: "objetivo_sitio",
            label: "Objetivo del sitio",
            type: "textarea",
            required: true,
            placeholder: "Captar clientes, vender en línea, mostrar portafolio…",
          },
          {
            key: "tipo_sitio",
            label: "Tipo de sitio",
            type: "select",
            required: true,
            options: opts(
              ["landing", "Landing page"],
              ["corporativo", "Sitio corporativo"],
              ["ecommerce", "E-commerce"],
              ["blog", "Blog / contenido"],
              ["sistema", "Sistema a medida"],
            ),
          },
          { key: "dominio_actual", label: "Dominio actual", type: "text" },
          { key: "hosting_actual", label: "Hosting actual", type: "text" },
        ],
      },
      {
        key: "contenido",
        label: "Contenido y estructura",
        description: "Páginas, secciones e idiomas del sitio.",
        kind: "data",
        fields: [
          { key: "paginas_estimadas", label: "Páginas estimadas", type: "number", min: 1, max: 500 },
          {
            key: "secciones",
            label: "Secciones",
            type: "multiselect",
            required: true,
            options: opts(
              ["home", "Inicio"],
              ["nosotros", "Nosotros"],
              ["servicios", "Servicios"],
              ["blog", "Blog"],
              ["galeria", "Galería"],
              ["faqs", "Preguntas frecuentes"],
              ["contacto", "Contacto"],
            ),
          },
          {
            key: "idiomas",
            label: "Idiomas",
            type: "multiselect",
            options: opts(["es", "Español"], ["en", "Inglés"], ["otro", "Otro"]),
          },
          {
            key: "contenido_disponible",
            label: "El cliente ya tiene textos e imágenes",
            type: "checkbox",
          },
        ],
      },
      {
        key: "diseno",
        label: "Diseño y marca",
        description: "Referencias visuales y aprobación del diseño.",
        kind: "data",
        fields: [
          { key: "referencias", label: "Referencias o inspiración", type: "textarea" },
          { key: "paleta_colores", label: "Paleta de colores", type: "text", placeholder: "#0D5BFF, #0A0A0A…" },
          { key: "tipografia_preferida", label: "Tipografía preferida", type: "text" },
          { key: "fecha_aprobacion_diseno", label: "Aprobación de diseño", type: "date" },
        ],
      },
      {
        key: "tecnico",
        label: "Alcance técnico",
        description: "Tecnologías, integraciones y accesos.",
        kind: "data",
        fields: [
          {
            key: "tecnologias",
            label: "Tecnologías",
            type: "multiselect",
            options: opts(
              ["next", "Next.js"],
              ["react", "React"],
              ["wordpress", "WordPress"],
              ["shopify", "Shopify"],
              ["woocommerce", "WooCommerce"],
              ["estatico", "HTML estático"],
              ["otra", "Otra"],
            ),
          },
          {
            key: "integraciones",
            label: "Integraciones",
            type: "textarea",
            placeholder: "Pasarela de pago, CRM, correo transaccional…",
          },
          { key: "correos_requeridos", label: "Se requieren correos corporativos", type: "checkbox" },
          { key: "dominios_adicionales", label: "Dominios adicionales", type: "text" },
        ],
      },
      {
        key: "entrega",
        label: "Entrega y soporte",
        description: "Lanzamiento, capacitación y soporte posterior.",
        kind: "data",
        fields: [
          { key: "fecha_lanzamiento", label: "Fecha de lanzamiento", type: "date" },
          { key: "capacitacion", label: "Incluye capacitación al cliente", type: "checkbox" },
          { key: "soporte_meses", label: "Soporte incluido (meses)", type: "number", min: 0, max: 60 },
          { key: "accesos_entregados", label: "Accesos entregados", type: "textarea" },
          { key: "notas_finales", label: "Notas finales", type: "textarea" },
        ],
      },
    ],
  },
];

export const PROJECT_TYPE_KEYS = PROJECT_TYPES.map((t) => t.key) as [
  string,
  ...string[],
];

export type ProjectTypeKey = (typeof PROJECT_TYPE_KEYS)[number];

export function getProjectType(key: string): ProjectTypeDef | undefined {
  return PROJECT_TYPES.find((t) => t.key === key);
}

export function isProjectTypeKey(key: string): key is ProjectTypeKey {
  return PROJECT_TYPES.some((t) => t.key === key);
}

/** Stepper completo de un tipo: paso general + pasos propios del tipo. */
export function stepsForType(typeKey: string): ProjectStepDef[] {
  const type = getProjectType(typeKey);
  if (!type) return [GENERAL_STEP];
  return [GENERAL_STEP, ...type.steps];
}

export function findStep(typeKey: string, stepKey: string): ProjectStepDef | undefined {
  return stepsForType(typeKey).find((s) => s.key === stepKey);
}

/* ─── Validación derivada de los campos ─── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function fieldZod(field: ProjectFieldDef): z.ZodTypeAny {
  const required = field.required === true;

  switch (field.type) {
    case "number":
    case "currency": {
      let num = z.coerce.number({ invalid_type_error: `${field.label} debe ser un número` });
      if (field.min !== undefined) num = num.min(field.min, `Debe ser al menos ${field.min}`);
      if (field.max !== undefined) num = num.max(field.max, `Debe ser como máximo ${field.max}`);
      if (!required) {
        // Vacío → null (coercionar "" daría 0)
        return z.preprocess(
          (v) => (v === "" || v === undefined ? null : v),
          num.nullable().optional()
        );
      }
      // Vacío → NaN → error de validación
      return z.preprocess((v) => (v === "" ? Number.NaN : v), num);
    }
    case "checkbox":
      return required ? z.boolean() : z.boolean().optional();
    case "select": {
      const values = (field.options ?? []).map((o) => o.value);
      if (!values.length) return required ? z.string().min(1) : z.string().optional().nullable();
      const en = z.enum(values as [string, ...string[]]);
      return required ? en : en.nullable().optional();
    }
    case "multiselect": {
      const values = (field.options ?? []).map((o) => o.value);
      if (!values.length) return z.array(z.string()).optional();
      const arr = z.array(z.enum(values as [string, ...string[]]));
      return required
        ? arr.min(1, `Selecciona al menos una opción en ${field.label}`)
        : arr.optional();
    }
    case "date": {
      const date = z.string().regex(DATE_RE, "Usa el formato AAAA-MM-DD");
      return required ? date : date.nullable().optional();
    }
    case "contact":
    case "member": {
      const id = z.string().min(1);
      return required ? id : id.nullable().optional();
    }
    default: {
      const str = z.string().max(5000, "Texto demasiado largo");
      return required
        ? str.min(1, `${field.label} es obligatorio`)
        : str.optional().nullable();
    }
  }
}

/** Schema Zod de un paso, generado desde sus campos (`.strict()`). */
export function stepZodSchema(step: ProjectStepDef): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  for (const field of step.fields) shape[field.key] = fieldZod(field);
  return z.object(shape).strict();
}

/** Valida los datos capturados de un paso contra el registro. */
export function parseStepData(
  step: ProjectStepDef,
  data: unknown
): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } {
  const parsed = stepZodSchema(step).safeParse(data ?? {});
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> };
  const detail = parsed.error.issues
    .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
    .join("; ");
  return { ok: false, message: detail };
}

/** Valores por defecto de un paso (form vacío). */
export function stepDataDefaults(step: ProjectStepDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of step.fields) {
    out[field.key] =
      field.type === "multiselect" ? [] : field.type === "checkbox" ? false : null;
  }
  return out;
}

/** Formato de campos monetarios del expediente (pesos MXN, no centavos). */
export function formatProjectCurrency(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(value);
}

/** Valor legible de un campo para exportaciones (PDF/reportes). */
export function formatFieldValue(field: ProjectFieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "checkbox":
      return value === true || value === "true" ? "Sí" : "No";
    case "multiselect": {
      const list = Array.isArray(value) ? (value as string[]) : [String(value)];
      if (!list.length) return "";
      return list
        .map((v) => field.options?.find((o) => o.value === v)?.label ?? v)
        .join(", ");
    }
    case "select":
      return field.options?.find((o) => o.value === value)?.label ?? String(value);
    case "currency":
      return formatProjectCurrency(Number(value));
    case "number":
      return String(value);
    default:
      return String(value);
  }
}
