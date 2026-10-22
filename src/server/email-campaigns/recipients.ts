/**
 * Lectura de destinatarios para campañas de correo.
 *
 * Acepta tres entradas: direcciones pegadas a mano, CSV/TSV/TXT y hojas de
 * cálculo .xlsx (primera hoja). Todo se normaliza a minúsculas y se deduplica
 * por correo: el índice único de la cola es (campaña, email) y un envío doble
 * al mismo buzón es siempre un error del operador, no un destinatario más.
 */

export const EMAIL_AUDIENCE_LIMIT = 5_000;
export const EMAIL_IMPORT_MAX_BYTES = 3 * 1024 * 1024;

export type EmailRecipientInput = {
  email: string;
  name?: string | null;
  contactId?: string | null;
};

export type EmailRecipient = {
  email: string;
  name: string | null;
  contactId: string | null;
};

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const EMAIL_COLUMN = /^(e-?mail|correo|correo electr[oó]nico|mail)$/i;
const NAME_COLUMN = /^(nombre( completo)?|name|contacto)$/i;
const MAX_EMAIL_LENGTH = 320;
const MAX_NAME_LENGTH = 255;

/** Un correo válido y en minúsculas; `null` si la celda no es una dirección. */
export function normalizeEmail(raw: string): string | null {
  let value = raw.trim();
  // "Nombre <correo@dominio>" y "mailto:correo@dominio".
  const angle = value.match(/<([^<>]+)>/);
  if (angle?.[1]) value = angle[1].trim();
  value = value.replace(/^mailto:/i, "").replace(/^["'()]+|["'(),;]+$/g, "").trim().toLowerCase();
  if (!value || value.length > MAX_EMAIL_LENGTH) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return null;
  if (value.includes("..") || value.startsWith(".") || value.includes(".@") || value.includes("@.")) return null;
  return value;
}

/** Correos contenidos en un texto libre (una celda, una línea o un párrafo). */
export function emailsInText(text: string): string[] {
  const found = text.match(EMAIL_PATTERN) ?? [];
  const unique: string[] = [];
  for (const candidate of found) {
    const email = normalizeEmail(candidate);
    if (email && !unique.includes(email)) unique.push(email);
  }
  return unique;
}

function cleanName(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return null;
  // Un nombre que trae un correo o un teléfono no es un nombre.
  if (emailsInText(value).length > 0) return null;
  return value.slice(0, MAX_NAME_LENGTH);
}

function nameFromAngleSyntax(line: string, email: string): string | null {
  // "Juan Pérez <juan@x.com>"
  const pattern = new RegExp(`^\\s*(.+?)\\s*<\\s*${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>`, "i");
  return cleanName(line.match(pattern)?.[1]);
}

function addUnique(
  target: EmailRecipient[],
  seen: Set<string>,
  email: string,
  name: string | null,
  contactId: string | null = null
): void {
  if (seen.has(email)) {
    if (target.length > 0) {
      const existing = target.find((recipient) => recipient.email === email);
      if (existing && !existing.name && name) existing.name = name;
    }
    return;
  }
  seen.add(email);
  target.push({ email, name: name?.slice(0, MAX_NAME_LENGTH) ?? null, contactId });
}

export type ParsedEmails = {
  recipients: EmailRecipient[];
  /** Filas con contenido que no aportaron ningún correo. */
  rowsWithoutEmail: number;
};

/** Extrae destinatarios de texto pegado o de un CSV/TSV. */
export function parseRecipientText(text: string): ParsedEmails {
  const recipients: EmailRecipient[] = [];
  const seen = new Set<string>();
  let rowsWithoutEmail = 0;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const emails = emailsInText(line);
    if (emails.length === 0) {
      rowsWithoutEmail++;
      continue;
    }
    for (const email of emails) {
      addUnique(recipients, seen, email, nameFromAngleSyntax(line, email));
      if (recipients.length > EMAIL_AUDIENCE_LIMIT) break;
    }
    if (recipients.length > EMAIL_AUDIENCE_LIMIT) break;
  }

  return { recipients, rowsWithoutEmail };
}

/**
 * Extrae destinatarios de una tabla (filas ya leídas de la hoja).
 * Si la primera fila trae encabezados «correo/email» y «nombre», se usan las
 * columnas; si no, se buscan correos celda a celda y el nombre solo se toma
 * de la sintaxis «Nombre <correo>».
 */
export function parseRecipientRows(rows: Array<Array<string | null>>): ParsedEmails {
  const recipients: EmailRecipient[] = [];
  const seen = new Set<string>();
  let rowsWithoutEmail = 0;
  const nonEmpty = rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return { recipients, rowsWithoutEmail };

  const header = nonEmpty[0]!;
  const emailColumn = header.findIndex((cell) => EMAIL_COLUMN.test(String(cell ?? "").trim()));
  const nameColumn = header.findIndex((cell) => NAME_COLUMN.test(String(cell ?? "").trim()));
  const hasHeader = emailColumn >= 0;
  const dataRows = hasHeader ? nonEmpty.slice(1) : nonEmpty;

  for (const row of dataRows) {
    let emails: string[] = [];
    if (hasHeader) {
      const cell = String(row[emailColumn] ?? "");
      emails = emailsInText(cell);
    } else {
      emails = emailsInText(row.map((cell) => String(cell ?? "")).join(" "));
    }
    if (emails.length === 0) {
      rowsWithoutEmail++;
      continue;
    }
    for (const email of emails) {
      const name = hasHeader && nameColumn >= 0
        ? cleanName(String(row[nameColumn] ?? ""))
        : nameFromAngleSyntax(row.map((cell) => String(cell ?? "")).join(" "), email);
      addUnique(recipients, seen, email, name);
      if (recipients.length > EMAIL_AUDIENCE_LIMIT) break;
    }
    if (recipients.length > EMAIL_AUDIENCE_LIMIT) break;
  }

  return { recipients, rowsWithoutEmail };
}

export class EmailImportError extends Error {
  constructor(readonly code: "file_too_large" | "file_type" | "legacy_xls" | "file_empty", message: string) {
    super(message);
    this.name = "EmailImportError";
  }
}

function extensionOf(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

/**
 * Lee un archivo de destinatarios. `.xlsx` se parsea con read-excel-file;
 * `.csv`, `.tsv` y `.txt` como texto. El `.xls` binario de Excel 97 no está
 * soportado: se pide guardarlo como .xlsx o CSV en vez de fallar en silencio.
 */
export async function parseRecipientFile(input: {
  filename: string;
  buffer: Buffer;
}): Promise<ParsedEmails> {
  if (input.buffer.byteLength === 0) {
    throw new EmailImportError("file_empty", "El archivo está vacío.");
  }
  if (input.buffer.byteLength > EMAIL_IMPORT_MAX_BYTES) {
    throw new EmailImportError(
      "file_too_large",
      `El archivo supera el límite de ${Math.round(EMAIL_IMPORT_MAX_BYTES / 1024 / 1024)} MB.`
    );
  }
  const extension = extensionOf(input.filename);
  if (extension === "xls") {
    throw new EmailImportError(
      "legacy_xls",
      "El formato .xls antiguo no se puede leer. Guarda la hoja como .xlsx o CSV y vuelve a cargarla."
    );
  }
  if (extension === "xlsx") {
    const { default: readXlsxFile } = await import("read-excel-file/node");
    const sheets = await readXlsxFile(input.buffer);
    const first = sheets[0]?.data ?? [];
    const rows = first.map((row) =>
      row.map((cell) => (typeof cell === "string" ? cell : cell === null || cell === undefined ? null : String(cell)))
    );
    return parseRecipientRows(rows);
  }
  if (extension === "csv" || extension === "tsv" || extension === "txt") {
    return parseRecipientText(input.buffer.toString("utf8"));
  }
  // Sin extensión reconocible: si es un ZIP, probablemente sea un .xlsx.
  if (input.buffer[0] === 0x50 && input.buffer[1] === 0x4b) {
    const { default: readXlsxFile } = await import("read-excel-file/node");
    const sheets = await readXlsxFile(input.buffer);
    const first = sheets[0]?.data ?? [];
    return parseRecipientRows(
      first.map((row) =>
        row.map((cell) => (typeof cell === "string" ? cell : cell === null || cell === undefined ? null : String(cell)))
      )
    );
  }
  throw new EmailImportError(
    "file_type",
    "Formato no reconocido. Usa .xlsx, .csv, .tsv o .txt."
  );
}

/** Normaliza una lista ya estructurada (audiencia manual o archivo ya leído). */
export function normalizeRecipientList(recipients: EmailRecipientInput[]): EmailRecipient[] {
  const result: EmailRecipient[] = [];
  const seen = new Set<string>();
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.email);
    if (!email) continue;
    addUnique(result, seen, email, cleanName(recipient.name), recipient.contactId ?? null);
    if (result.length > EMAIL_AUDIENCE_LIMIT) break;
  }
  return result;
}
