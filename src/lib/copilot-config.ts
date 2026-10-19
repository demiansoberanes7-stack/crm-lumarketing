/**
 * Fuentes que el copiloto de consulta puede leer para preparar cada respuesta.
 * La autorización real siempre se aplica en el servidor; estas preferencias no
 * conceden acceso fuera de la organización ni añaden capacidades de escritura.
 */
export const COPILOT_DATA_SOURCES = [
  { key: "metrics", label: "Métricas y dashboard", description: "KPIs agregados de ventas, conversaciones, marketing y finanzas." },
  { key: "pipeline", label: "Pipeline y prospectos", description: "Etapas, volumen y actividad de oportunidades." },
  { key: "contacts", label: "Contactos y fichas", description: "Datos de contacto y campos de calificación configurados." },
  { key: "conversations", label: "Conversaciones", description: "Últimas conversaciones y mensajes relevantes." },
  { key: "notes", label: "Notas e historial comercial", description: "Notas registradas por el equipo o el agente." },
  { key: "quotes", label: "Cotizaciones", description: "Estados, importes y datos comerciales de cotizaciones recientes." },
  { key: "finances", label: "Finanzas y cobranza", description: "Cargos pendientes, vencimientos y pagos registrados." },
  { key: "agenda", label: "Agenda y citas", description: "Citas futuras y configuración de disponibilidad." },
  { key: "projects_tasks", label: "Proyectos y tareas", description: "Estado de proyectos, tareas abiertas y vencimientos." },
  { key: "integrations", label: "Estado de conexiones", description: "Configuración guardada y diagnósticos conocidos; no garantiza acceso en vivo." },
  { key: "system_docs", label: "Guía del CRM", description: "Funcionamiento de módulos y relaciones documentadas del sistema." },
] as const;

export type CopilotDataSource = (typeof COPILOT_DATA_SOURCES)[number]["key"];
export type CopilotAccessMode = "selected" | "all";

/** Configuración inicial compatible con el contexto que ya tenía el copiloto. */
export const DEFAULT_COPILOT_SETTINGS = {
  accessMode: "selected" as const,
  dataSources: ["metrics", "pipeline", "contacts", "agenda"] as CopilotDataSource[],
};

const knownSources = new Set<string>(COPILOT_DATA_SOURCES.map((source) => source.key));

export function normalizeCopilotDataSources(value: unknown): CopilotDataSource[] {
  if (!Array.isArray(value)) return [...DEFAULT_COPILOT_SETTINGS.dataSources];
  const sources = [...new Set(value.filter((item): item is CopilotDataSource =>
    typeof item === "string" && knownSources.has(item)
  ))];
  return sources.length ? sources : [...DEFAULT_COPILOT_SETTINGS.dataSources];
}

export function enabledCopilotDataSources(input: {
  accessMode: string;
  dataSources: unknown;
}): Set<CopilotDataSource> {
  if (input.accessMode === "all") return new Set(COPILOT_DATA_SOURCES.map((source) => source.key));
  return new Set(normalizeCopilotDataSources(input.dataSources));
}
