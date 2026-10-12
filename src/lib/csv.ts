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

/** Escapa un valor para celda CSV. */
function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes(";")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
  const header = cols.map(escapeCell).join(",");
  const body = rows
    .map((row) => cols.map((c) => escapeCell(row[c] == null ? "" : String(row[c]))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

/** Convierte texto CSV a Blob descargable. */
export function csvBlob(text: string): Blob {
  // BOM para que Excel abra UTF-8 correctamente
  return new Blob([`\uFEFF${text}`], { type: "text/csv;charset=utf-8" });
}
