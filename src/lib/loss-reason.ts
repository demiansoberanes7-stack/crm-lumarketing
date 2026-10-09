/**
 * Motivos de pérdida: taxonomía normalizada.
 *
 * La lista corta legada (`precio`, `no_es_perfil`, `sin_presupuesto`,
 * `eligio_otro`, `nunca_contesto`, `otro`) vive en `lib/types.ts` y sigue
 * escribiéndose en `lead_stage_event.loss_reason`. Este módulo define el
 * conjunto normalizado más amplio que el catálogo `loss_reason` persiste por
 * organización, y el mapeo de cada valor legacy a su clave normalizada, para
 * que el embudo pueda reportar con una sola taxonomía sin romper lo histórico.
 */

export const LOSS_REASON_KEYS = [
  "precio",
  "no_respondio",
  "no_interesado",
  "eligio_otro_proveedor",
  "servicio_no_disponible",
  "presupuesto_insuficiente",
  "fuera_de_alcance",
  "tiempo_entrega",
  "oportunidad_duplicada",
  "otros",
] as const;
export type LossReasonKey = (typeof LOSS_REASON_KEYS)[number];

export const LOSS_REASON_KEY_LABELS: Record<LossReasonKey, string> = {
  precio: "Precio",
  no_respondio: "No respondió",
  no_interesado: "No estaba interesado",
  eligio_otro_proveedor: "Eligió otro proveedor",
  servicio_no_disponible: "Servicio no disponible",
  presupuesto_insuficiente: "Presupuesto insuficiente",
  fuera_de_alcance: "Fuera del alcance",
  tiempo_entrega: "Tiempo de entrega",
  oportunidad_duplicada: "Oportunidad duplicada",
  otros: "Otros",
};

/** Valor legacy (`types.ts`) → clave normalizada. */
const LEGACY_TO_NORMALIZED: Record<string, LossReasonKey> = {
  precio: "precio",
  no_es_perfil: "fuera_de_alcance",
  sin_presupuesto: "presupuesto_insuficiente",
  eligio_otro: "eligio_otro_proveedor",
  nunca_contesto: "no_respondio",
  otro: "otros",
};

/**
 * Traduce un motivo legado a su clave normalizada. Un valor que no viene de la
 * lista corta (por ejemplo, una clave ya normalizada) se conserva tal cual si
 * es reconocida; si no, cae en `otros` — nunca se inventa una categoría.
 */
export function normalizeLossReason(value: string | null | undefined): LossReasonKey {
  if (!value) return "otros";
  if ((LOSS_REASON_KEYS as readonly string[]).includes(value)) {
    return value as LossReasonKey;
  }
  return LEGACY_TO_NORMALIZED[value] ?? "otros";
}

export function lossReasonLabel(key: string | null | undefined): string | null {
  const normalized = key ? normalizeLossReason(key) : null;
  return normalized ? LOSS_REASON_KEY_LABELS[normalized] : null;
}
