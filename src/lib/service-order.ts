/**
 * Orden de servicio — contrato puro (estados y transiciones).
 *
 * La orden de servicio es la unidad operativa que nace de una cotización
 * aceptada. Este archivo no toca la base de datos: define el vocabulario y las
 * reglas que comparten el servidor, la API y la UI.
 */

export const SERVICE_ORDER_STATUSES = [
  "pendiente",
  "asignada",
  "en_proceso",
  "en_revision",
  "entregada",
  "cancelada",
] as const;

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export const SERVICE_ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  pendiente: "Pendiente",
  asignada: "Asignada",
  en_proceso: "En proceso",
  en_revision: "En revisión",
  entregada: "Entregada",
  cancelada: "Cancelada",
};

/** Estados que cierran la orden: ya no se espera más trabajo. */
export const SERVICE_ORDER_TERMINAL_STATUSES: ServiceOrderStatus[] = [
  "entregada",
  "cancelada",
];

export function isServiceOrderStatus(value: string): value is ServiceOrderStatus {
  return (SERVICE_ORDER_STATUSES as readonly string[]).includes(value);
}

export function isTerminalServiceOrderStatus(status: string): boolean {
  return (SERVICE_ORDER_TERMINAL_STATUSES as string[]).includes(status);
}

/**
 * Transiciones permitidas del ciclo operativo. `entregada` y `cancelada` son
 * finales; una orden entregada no se reabre por esta vía (se registraría como
 * una orden nueva para conservar el historial).
 */
const TRANSITIONS: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  pendiente: ["asignada", "en_proceso", "cancelada"],
  asignada: ["en_proceso", "cancelada"],
  en_proceso: ["en_revision", "entregada", "cancelada"],
  en_revision: ["en_proceso", "entregada", "cancelada"],
  entregada: [],
  cancelada: [],
};

export function canTransitionServiceOrder(
  from: ServiceOrderStatus,
  to: ServiceOrderStatus
): boolean {
  return TRANSITIONS[from].includes(to);
}
