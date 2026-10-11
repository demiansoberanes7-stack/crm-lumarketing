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

/** Divide una línea CSV respetando comillas dobles. */
function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (inQuotes) {
      if (ch === '"') {
        // "" dentro de comillas = comilla literal
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === sep) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/**
 * Parsea texto CSV a array de objetos usando la fila de encabezados como keys.
 * La primera línea no vacía es el header. Filas vacías se descartan.
 */
export function parseCsv(text: string): Record<string, string>[] {
  // Quitar BOM si viene de Excel
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headerLine = lines[0] ?? "";
  const sep = detectSeparator(headerLine);
  const headers = splitLine(headerLine, sep).map((h) =>
    h.toLowerCase().replace(/\s+/g, "_")
  );
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const cells = splitLine(line, sep);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] ?? "";
    });
    rows.push(row);
  }
  return rows;
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
