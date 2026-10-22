/**
 * Utilidades compartidas por los paneles de Inteligencia.
 *
 * El export se hace en el navegador (no hay ruta nueva): las tablas ya traen
 * sus filas y Google Trends exporta lo que está en pantalla, no el catálogo
 * completo. `window` está tipado a propósito: estos helpers solo corren en
 * cliente.
 */

import { escapeCsvCell } from "@/lib/csv";

export type CsvCell = string | number | null | undefined;

/**
 * La regla vive en `src/lib/csv.ts` para que el export del servidor (Contactos,
 * Inventario) y este, que corre en el navegador, no puedan divergir: una celda
 * que empieza por `=`, `+`, `-`, `@` —o por un espacio previo más uno de esos—
 * Excel la EVALÚA, y aquí se exportan consultas que buscó gente ajena.
 */
function csvValue(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  return escapeCsvCell(String(v));
}

/** Descarga un CSV (con BOM para que Excel lo abra en UTF-8). */
export function downloadCsv(filename: string, header: string[], rows: CsvCell[][]): void {
  const lines = [header, ...rows].map((r) => r.map(csvValue).join(","));
  const blob = new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

/** Copiar al portapapeles sin fallar: devuelve si de verdad se pudo. */
export async function copyList(items: string[]): Promise<boolean> {
  const text = items.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Marca de tiempo relativa, en español de México: «hace 5 horas». */
export function relativeStart(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((now - then) / 60_000);
  if (mins < 1) return "ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return new Date(then).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/** Volumen sin inventar: si la fuente no lo publica, «—». */
export function formatVolume(n: number | null): string {
  return n === null ? "—" : new Intl.NumberFormat("es-MX").format(n);
}
