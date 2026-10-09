/**
 * Catálogo central de métricas.
 *
 * Una sola definición por métrica, compartida por todas las vistas
 * (dashboard, marketing hub, rentabilidad). Cada entrada documenta la fórmula
 * en texto plano, las fuentes de datos que necesita y qué pasa cuando falta
 * información, de modo que ningún componente vuelva a calcular "su propio"
 * ROAS ni presente un cero inventado como si fuera un dato real.
 */

export type MetricUnit =
  | "currency"
  | "percent"
  | "count"
  | "days"
  | "hours"
  | "ratio";

export type MetricCategory =
  | "resumen"
  | "ventas"
  | "embudo"
  | "publicidad"
  | "trafico"
  | "adquisicion"
  | "rentabilidad"
  | "experimentos"
  | "operaciones"
  | "calidad";

export type MetricSource =
  | "lead"
  | "lead_stage_event"
  | "quote"
  | "charge"
  | "payment"
  | "expense"
  | "service_cost"
  | "campaign"
  | "attribution_event"
  | "activity_event"
  | "conversation"
  | "marketplace_order"
  | "experiment_observation"
  | "ga4"
  | "meta_ads";

export type MetricDefinition = {
  id: string;
  name: string;
  category: MetricCategory;
  unit: MetricUnit;
  /** Fórmula legible: numerador / denominador, en palabras. */
  formula: string;
  /** Fuentes mínimas; si alguna falta, la métrica queda "no disponible". */
  requires: MetricSource[];
  /** true si la métrica puede devolverse como "no disponible" con explicación. */
  mayBeUnavailable: boolean;
};

export const METRIC_CATALOG: readonly MetricDefinition[] = [
  // Resumen
  { id: "revenue", name: "Ingresos cobrados", category: "resumen", unit: "currency", formula: "Suma de pagos en el periodo (MXN)", requires: ["payment"], mayBeUnavailable: false },
  { id: "net_income", name: "Resultado neto", category: "resumen", unit: "currency", formula: "Ingresos − gastos", requires: ["payment", "expense"], mayBeUnavailable: false },
  { id: "new_leads", name: "Nuevos prospectos", category: "resumen", unit: "count", formula: "Leads creados en el periodo", requires: ["lead_stage_event"], mayBeUnavailable: false },

  // Ventas
  { id: "closed_deals", name: "Tratos ganados", category: "ventas", unit: "count", formula: "Leads que entraron a una etapa kind=won en el periodo", requires: ["lead_stage_event"], mayBeUnavailable: false },
  { id: "avg_ticket", name: "Ticket promedio", category: "ventas", unit: "currency", formula: "Ingresos cobrados ÷ número de cobros", requires: ["payment"], mayBeUnavailable: true },
  { id: "win_rate", name: "Tasa de cierre", category: "ventas", unit: "percent", formula: "Tratos ganados ÷ (ganados + perdidos) × 100", requires: ["lead_stage_event"], mayBeUnavailable: true },

  // Embudo
  { id: "lead_to_qualified", name: "Prospecto → calificado", category: "embudo", unit: "percent", formula: "Calificados ÷ nuevos prospectos × 100", requires: ["lead_stage_event"], mayBeUnavailable: true },
  { id: "qualified_to_quote", name: "Calificado → cotizado", category: "embudo", unit: "percent", formula: "Cotizados ÷ calificados × 100", requires: ["lead_stage_event"], mayBeUnavailable: true },
  { id: "quote_to_won", name: "Cotizado → ganado", category: "embudo", unit: "percent", formula: "Ganados ÷ cotizados × 100", requires: ["lead_stage_event"], mayBeUnavailable: true },

  // Publicidad
  { id: "ad_spend", name: "Inversión publicitaria", category: "publicidad", unit: "currency", formula: "Suma del costo de campañas en el periodo", requires: ["campaign"], mayBeUnavailable: true },
  { id: "roas", name: "ROAS", category: "publicidad", unit: "ratio", formula: "Ingresos atribuidos ÷ inversión publicitaria", requires: ["campaign", "payment"], mayBeUnavailable: true },
  { id: "romi", name: "ROMI", category: "publicidad", unit: "percent", formula: "(Ingresos atribuidos − inversión) ÷ inversión × 100", requires: ["campaign", "payment"], mayBeUnavailable: true },
  { id: "cac", name: "CAC", category: "publicidad", unit: "currency", formula: "Costo de adquisición ÷ clientes nuevos", requires: ["campaign", "lead_stage_event"], mayBeUnavailable: true },

  // Tráfico digital (GA4)
  { id: "sessions", name: "Sesiones", category: "trafico", unit: "count", formula: "Sesiones de GA4 en el periodo", requires: ["ga4"], mayBeUnavailable: true },
  { id: "session_to_lead", name: "Sesión → prospecto", category: "trafico", unit: "percent", formula: "Nuevos prospectos ÷ sesiones × 100", requires: ["ga4", "lead_stage_event"], mayBeUnavailable: true },

  // Adquisición
  { id: "leads_by_channel", name: "Prospectos por canal", category: "adquisicion", unit: "count", formula: "Primer toque agrupado por canal de adquisición", requires: ["attribution_event"], mayBeUnavailable: true },

  // Rentabilidad
  { id: "contribution", name: "Contribución", category: "rentabilidad", unit: "currency", formula: "Ingresos − costo de prestación − inversión (si se conoce)", requires: ["payment", "service_cost"], mayBeUnavailable: true },
  { id: "contribution_margin", name: "Margen de contribución", category: "rentabilidad", unit: "percent", formula: "Contribución ÷ ingresos × 100", requires: ["payment", "service_cost"], mayBeUnavailable: true },

  // Experimentos
  { id: "experiment_lift", name: "Lift del experimento", category: "experimentos", unit: "percent", formula: "(Variante − control) ÷ control × 100 en la métrica primaria", requires: ["experiment_observation"], mayBeUnavailable: true },

  // Operaciones
  { id: "response_time_hours", name: "Tiempo de respuesta", category: "operaciones", unit: "hours", formula: "Promedio de horas entre mensaje entrante y respuesta saliente", requires: ["activity_event", "conversation"], mayBeUnavailable: true },

  // Calidad de datos
  { id: "contacts_with_channel", name: "Contactos con canal capturado", category: "calidad", unit: "percent", formula: "Contactos con canal de adquisición ÷ total de contactos × 100", requires: ["attribution_event"], mayBeUnavailable: true },
];

export function getMetric(id: string): MetricDefinition | undefined {
  return METRIC_CATALOG.find((m) => m.id === id);
}

export function metricsByCategory(category: MetricCategory): MetricDefinition[] {
  return METRIC_CATALOG.filter((m) => m.category === category);
}
