/**
 * Parser y serializador CSV mínimo (RFC 4180) sin dependencias.
 * Soporta: comillas dobles para escapar, comas y saltos de línea dentro
 * de campos, BOM UTF-8, y separador configurable.
 */

/** Detecta el separador (coma o punto y coma) mirando la primera línea. */
function detectSeparator(line: string): string {
  const commas = (line.match(/,/g) ?? []).length;
  const semis = (line.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

/**
 * Parsea el texto COMPLETO a filas de celdas respetando RFC 4180: comillas
 * dobles, `""` como comilla literal y saltos de línea DENTRO de campos
 * entrecomillados. Dividir por líneas antes de parsear rompía cualquier
 * campo con salto interno (direcciones, notas).
 */
function parseRows(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let current = "";
  let inQuotes = false;
  let cellStarted = false;

  const endCell = () => {
    cells.push(current.trim());
    current = "";
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    // Filas completamente vacías se descartan.
    if (!(cells.length === 1 && cells[0] === "")) rows.push(cells);
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === sep) {
      endCell();
    } else if (ch === "\n" || ch === "\r") {
      // \r\n cuenta como un solo salto.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (cellStarted || current.length > 0 || cells.length > 0) endRow();
    } else {
      current += ch;
      cellStarted = true;
    }
  }
  // La última fila sin salto final.
  if (cellStarted || current.length > 0 || cells.length > 0) endRow();
  return rows;
}

/**
 * Parsea texto CSV a array de objetos usando la fila de encabezados como keys.
 * La primera fila no vacía es el header. Filas vacías se descartan.
 */
export function parseCsv(text: string): Record<string, string>[] {
  // Quitar BOM si viene de Excel
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const rows = parseRows(clean, detectSeparator(firstLine));
  const headerRow = rows[0];
  if (!headerRow || rows.length < 2) return [];
  const headers = headerRow.map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const out: Record<string, string>[] = [];
  for (const cells of rows.slice(1)) {
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] ?? "";
    });
    out.push(row);
  }
  return out;
}

/**
 * Inyección de fórmulas. Una celda que empieza por `=`, `+`, `-` o `@` (o por
 * un tabulador/salto, que Excel ignora antes de mirar el primer carácter) no es
 * texto: Excel y Sheets la EVALÚAN al abrir el archivo. Como el CSV de este
 * CRM se genera con datos que escribió gente de fuera —notas de un contacto,
 * nombres de prospectos tomados del chat—, un `=HYPERLINK("http://…","ver")`
 * en una nota sale convertida en un clic que manda a la víctima a otro sitio.
 *
 * Se neutraliza con comilla simple inicial, que es la convención que Excel
 * respeta como «esto es texto». Los números negativos se dejan intactos: `-5`
 * en `monto_compra` es una devolución, no una fórmula, y convertirlo en texto
 * rompería las sumas del dueño.
 */
const FORMULA_START = /^[\t\r\n ]*[=+\-@]/;
const PURE_NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * Escapa un valor para celda CSV: comillas según RFC 4180 y blindaje de
 * fórmulas. Se exporta porque el export de Inteligencia (`intel-export.ts`) se
 * hace en el navegador y necesita la MISMA regla; duplicarla es cómo una de
 * las dos se queda vieja.
 */
export function escapeCsvCell(value: string): string {
  const safe =
    FORMULA_START.test(value) && !PURE_NUMBER.test(value.trim()) ? `'${value}` : value;
  if (safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes(";")) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/**
 * Convierte array de objetos a texto CSV. Usa las keys del primer objeto
 * como encabezados. Valores null/undefined → cadena vacía.
 */
export function stringifyCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "";
  const first = rows[0];
  if (!first) return "";
  const cols = columns ?? Object.keys(first);
  const header = cols.map(escapeCsvCell).join(",");
  const body = rows
    .map((row) => cols.map((c) => escapeCsvCell(row[c] == null ? "" : String(row[c]))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

/** Convierte texto CSV a Blob descargable. */
export function csvBlob(text: string): Blob {
  // BOM para que Excel abra UTF-8 correctamente
  return new Blob([`\uFEFF${text}`], { type: "text/csv;charset=utf-8" });
}
