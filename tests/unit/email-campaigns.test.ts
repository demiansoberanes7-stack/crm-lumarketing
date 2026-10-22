import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  EMAIL_AUDIENCE_LIMIT,
  EmailImportError,
  normalizeEmail,
  normalizeRecipientList,
  parseRecipientFile,
  parseRecipientRows,
  parseRecipientText,
} from "@/server/email-campaigns/recipients";
import { personalizeEmail } from "@/server/email-campaigns/personalize";
import { createEmailCampaignSchema } from "@/server/email-campaigns/schema";

describe("normalización de correos", () => {
  it("recorta, pasa a minúsculas y entiende «Nombre <correo>» y mailto", () => {
    expect(normalizeEmail("  Juan@Empresa.COM ")).toBe("juan@empresa.com");
    expect(normalizeEmail("María López <maria@empresa.com>")).toBe("maria@empresa.com");
    expect(normalizeEmail("mailto:ventas@empresa.mx")).toBe("ventas@empresa.mx");
    expect(normalizeEmail("(soporte@empresa.mx)")).toBe("soporte@empresa.mx");
  });

  it("rechaza lo que no es una dirección usable", () => {
    for (const raw of ["", "sin-correo", "a@b", "a..b@empresa.com", "a b@empresa.com", "a@empresa", "a@empresa..com", `${"x".repeat(310)}@empresa.com`]) {
      expect(normalizeEmail(raw), raw).toBeNull();
    }
  });

  it("deduplica una lista estructurada sin perder el primer nombre", () => {
    expect(normalizeRecipientList([
      { email: "Ana@Empresa.com", name: "Ana Pérez" },
      { email: "ana@empresa.com", name: "Otra Ana" },
      { email: "sin-correo", name: "Nadie" },
      { email: "beto@empresa.mx", name: null },
    ])).toEqual([
      { email: "ana@empresa.com", name: "Ana Pérez", contactId: null },
      { email: "beto@empresa.mx", name: null, contactId: null },
    ]);
  });
});

describe("listas pegadas a mano", () => {
  it("lee líneas, comas y punto y coma, y cuenta las filas sin correo", () => {
    const parsed = parseRecipientText([
      "juan@empresa.com",
      "María López <maria@empresa.com>",
      "JUAN@empresa.com; otro@empresa.mx",
      "esta línea no trae correo",
    ].join("\n"));
    expect(parsed.recipients).toEqual([
      { email: "juan@empresa.com", name: null, contactId: null },
      { email: "maria@empresa.com", name: "María López", contactId: null },
      { email: "otro@empresa.mx", name: null, contactId: null },
    ]);
    expect(parsed.rowsWithoutEmail).toBe(1);
  });

  it("corta en el límite + 1 para que la API pueda avisar del exceso", () => {
    const text = Array.from(
      { length: EMAIL_AUDIENCE_LIMIT + 1 },
      (_, index) => `persona${index}@empresa.com`
    ).join("\n");
    expect(parseRecipientText(text).recipients).toHaveLength(EMAIL_AUDIENCE_LIMIT + 1);
  });
});

describe("tablas y archivos", () => {
  it("usa las columnas «correo» y «nombre» cuando hay encabezado", () => {
    const parsed = parseRecipientRows([
      ["Correo", "Nombre"],
      ["Ana@Empresa.com", "Ana Pérez"],
      ["", ""],
      ["sin-correo", "Nadie"],
      ["beto@empresa.mx", ""],
    ]);
    expect(parsed.recipients).toEqual([
      { email: "ana@empresa.com", name: "Ana Pérez", contactId: null },
      { email: "beto@empresa.mx", name: null, contactId: null },
    ]);
    expect(parsed.rowsWithoutEmail).toBe(1);
  });

  it("sin encabezado solo toma el nombre de «Nombre <correo>»", () => {
    const parsed = parseRecipientRows([
      ["María López <maria@empresa.com>"],
      ["juan@empresa.com", "5551234567"],
    ]);
    expect(parsed.recipients).toEqual([
      { email: "maria@empresa.com", name: "María López", contactId: null },
      { email: "juan@empresa.com", name: null, contactId: null },
    ]);
  });

  it("lee CSV/TXT y rechaza el .xls viejo con un mensaje accionable", async () => {
    const csv = await parseRecipientFile({
      filename: "lista.csv",
      buffer: Buffer.from("correo,nombre\nana@empresa.com,Ana\n", "utf8"),
    });
    expect(csv.recipients[0]).toMatchObject({ email: "ana@empresa.com" });

    await expect(
      parseRecipientFile({ filename: "lista.xls", buffer: Buffer.from("cualquier cosa") })
    ).rejects.toMatchObject({ code: "legacy_xls" });
  });

  it("rechaza archivos vacíos, enormes o de tipo desconocido", async () => {
    await expect(
      parseRecipientFile({ filename: "vacio.csv", buffer: Buffer.alloc(0) })
    ).rejects.toBeInstanceOf(EmailImportError);
    await expect(
      parseRecipientFile({ filename: "grande.csv", buffer: Buffer.alloc(3 * 1024 * 1024 + 1) })
    ).rejects.toMatchObject({ code: "file_too_large" });
    await expect(
      parseRecipientFile({ filename: "lista.pdf", buffer: Buffer.from("%PDF-1.7") })
    ).rejects.toMatchObject({ code: "file_type" });
  });

  it("lee un .xlsx real (primera hoja) con read-excel-file", async () => {
    const buffer = buildXlsx([
      ["correo", "nombre"],
      ["Ana@Empresa.com", "Ana Pérez"],
      ["beto@empresa.mx", "Beto Ruiz"],
    ]);
    const parsed = await parseRecipientFile({ filename: "contactos.xlsx", buffer });
    expect(parsed.recipients).toEqual([
      { email: "ana@empresa.com", name: "Ana Pérez", contactId: null },
      { email: "beto@empresa.mx", name: "Beto Ruiz", contactId: null },
    ]);
  });
});

describe("personalización del correo", () => {
  it("reemplaza nombre y correo, y cae a la parte local si no hay nombre", () => {
    expect(personalizeEmail("Hola {{nombre}}", { email: "ana@empresa.com", name: "Ana" }))
      .toBe("Hola Ana");
    expect(personalizeEmail("Hola {{ nombre }}", { email: "beto@empresa.mx", name: null }))
      .toBe("Hola beto");
    expect(personalizeEmail("{{Nombre}}: {{correo}}", { email: "ana@empresa.com", name: "Ana" }))
      .toBe("Ana: ana@empresa.com");
  });
});

describe("payload de campaña de correo", () => {
  const base = {
    name: "Promoción",
    senderAccountId: "emac_1",
    subject: "Hola",
    bodyText: "Mensaje",
  };

  it("acepta audiencias de contactos, buzón y listas", () => {
    expect(createEmailCampaignSchema.safeParse({ ...base, audience: { kind: "contacts" } }).success).toBe(true);
    expect(createEmailCampaignSchema.safeParse({ ...base, audience: { kind: "mailbox" } }).success).toBe(true);
    expect(createEmailCampaignSchema.safeParse({
      ...base,
      audience: { kind: "list", recipients: [{ email: "ana@empresa.com", name: "Ana" }] },
    }).success).toBe(true);
    expect(createEmailCampaignSchema.safeParse({
      ...base,
      audience: { kind: "list", text: "ana@empresa.com" },
    }).success).toBe(true);
  });

  it("una lista sin correos ni texto no pasa", () => {
    expect(createEmailCampaignSchema.safeParse({ ...base, audience: { kind: "list" } }).success).toBe(false);
    expect(createEmailCampaignSchema.safeParse({ ...base, audience: { kind: "list", text: "   " } }).success).toBe(false);
  });

  it("exige los campos de la campaña y no acepta claves ajenas", () => {
    expect(createEmailCampaignSchema.safeParse({ ...base, subject: "", audience: { kind: "contacts" } }).success).toBe(false);
    expect(createEmailCampaignSchema.safeParse({ ...base, channel: "whatsapp", audience: { kind: "contacts" } }).success).toBe(false);
  });
});

/** XLSX mínimo y determinista: hoja con celdas inline (sin sharedStrings). */
function buildXlsx(rows: string[][]): Buffer {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const column = (index: number) => String.fromCharCode(65 + index);
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) =>
      `<c r="${column(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`
    ).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Hoja1" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    ),
  };
  return Buffer.from(zipSync(files));
}
