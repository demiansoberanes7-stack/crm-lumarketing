/**
 * Quote types compartidos entre list, detail y dialog.
 */

export interface QuoteItem {
  name: string;
  quantity: number;
  unitPrice: number;
  /** Descripción corta (del catálogo o escrita a mano); va al PDF. */
  description?: string;
  /** Vínculo con catálogo para trazabilidad y descuento de inventario. */
  productId?: string | null;
  /**
   * Foto que el PDF va a imprimir para esta partida. En una cotización guardada
   * es la congelada en `quote_item`; en el compositor, la portada actual del
   * producto recién elegido. El servidor ignora este campo: la foto se decide
   * contra el catálogo, nunca desde el navegador.
   */
  imageUrl?: string | null;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  sent: "Enviada",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

export const STATUS_VARIANT: Record<string, "secondary" | "outline" | "success" | "destructive"> = {
  draft: "secondary",
  sent: "outline",
  accepted: "success",
  rejected: "destructive",
};

/** Formatea centavos (integer de la DB) a MXN display. */
export function formatMXNCents(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount / 100);
}

/** Formatea pesos (display) a MXN. Para uso en dialogs que ya dividieron /100. */
export function formatMXNDisplay(amount: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(amount);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
