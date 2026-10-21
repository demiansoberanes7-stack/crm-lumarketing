import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureContactPhoneFromText,
  extractPhoneFromText,
} from "@/server/inbox/phone-capture";

/**
 * El teléfono que el cliente escribe en el chat.
 *
 * Cubre las dos confusiones que arruinarían la pantalla de Prospectos:
 *  - capturar un precio como número (chats de cotización van llenos de cifras);
 *  - partir una cifra larga y llamar teléfono a un sufijo de 10 dígitos.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

let returned: unknown[] = [];
let whereArgs: unknown[] = [];

function phoneOf(text: string | null): string | null {
  return extractPhoneFromText(text)?.phone ?? null;
}

describe("extractPhoneFromText: formatos reales de chat", () => {
  it.each([
    ["4621345678", "4621345678"],
    ["mi número es 462 134 5678", "4621345678"],
    ["hola, mi cel es 4621345678, me llamo Luis", "4621345678"],
    ["me marcó al 5512345678 cuando pueda", "5512345678"],
    ["mi numero 462-134-56-78", "4621345678"],
    ["462 13 45 678", "4621345678"],
    ["(462) 134 56 78", "4621345678"],
    ["les dejo mi whatsapp: 443 123 45 67", "4431234567"],
    ["escríbanme al 33 1234 5678 porfa", "3312345678"],
  ])("toma el número de %j", (text, expected) => {
    expect(phoneOf(text)).toBe(expected);
  });

  it("colapsa el tronco 521 de Meta al formato con el que se envía", () => {
    expect(phoneOf("5214621345678")).toBe("524621345678");
  });

  it("respeta el código de país cuando viene con +", () => {
    expect(phoneOf("+52 462 134 5678")).toBe("524621345678");
    // Sin `+`, "52" podría ser una cantidad: se guarda el bloque de 10.
    expect(phoneOf("52 4621345678")).toBe("4621345678");
  });

  it("no ve teléfonos donde hay precios, fechas o cantidades cortas", () => {
    expect(phoneOf("¿cuánto cuesta? 1200")).toBeNull();
    expect(phoneOf("el equipo está en $4621345678 pesos")).toBeNull();
    expect(phoneOf("lo quiero para el 20261015")).toBeNull();
    expect(phoneOf("factura 20261015143000")).toBeNull();
    expect(phoneOf("hola 12345")).toBeNull();
    expect(phoneOf("gracias")).toBeNull();
    expect(phoneOf(null)).toBeNull();
  });

  it("no parte una cifra larga: toma el bloque completo, nunca un sufijo", () => {
    // "0012345678" sería la lectura falsa (sufijo de 10 dígitos que arranca en 0).
    expect(phoneOf("mi folio 50012345678")).toBe("50012345678");
  });

  it("con una cantidad pegada al número, gana el número", () => {
    expect(phoneOf("hola 10 4621345678")).toBe("4621345678");
  });

  it("rechaza lo que empieza por 0 (nadie marca así un teléfono)", () => {
    expect(phoneOf("04421345678")).toBeNull();
  });

  it("con dos números iguales, deja el primero que aparece", () => {
    expect(phoneOf("luis 4621123456 y ana 4622233344")).toBe("4621123456");
  });
});

describe("captureContactPhoneFromText", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    returned = [];
    whereArgs = [];
    mocks.getDb.mockReturnValue({
      update: mocks.update.mockImplementation(() => ({
        set: () => ({
          where: (condition: unknown) => {
            whereArgs.push(condition);
            return { returning: () => Promise.resolve(returned) };
          },
        }),
      })),
    });
  });

  it("con número escrito y contacto sin teléfono, lo guarda", async () => {
    returned = [{ id: "ct_1" }];
    const captured = await captureContactPhoneFromText({
      organizationId: "org_1",
      contactId: "ct_1",
      existingPhone: null,
      text: "mi cel es 4621345678",
    });
    expect(captured).toBe("4621345678");
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("NUNCA pisa un teléfono que ya existe: ni consulta", async () => {
    const captured = await captureContactPhoneFromText({
      organizationId: "org_1",
      contactId: "ct_1",
      existingPhone: "524621345678",
      text: "ahora es 5588889999",
    });
    expect(captured).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("sin número en el mensaje no escribe nada", async () => {
    const captured = await captureContactPhoneFromText({
      organizationId: "org_1",
      contactId: "ct_1",
      existingPhone: null,
      text: "¿tienen disponibles?",
    });
    expect(captured).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("el UPDATE exige tenant y `phone is null` en el WHERE", async () => {
    returned = [{ id: "ct_1" }];
    await captureContactPhoneFromText({
      organizationId: "org_1",
      contactId: "ct_1",
      existingPhone: null,
      text: "4621345678",
    });
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { sql: query, params } = new PgDialect().sqlToQuery(whereArgs[0] as never);
    expect(query).toContain('"contact"."organization_id"');
    expect(query).toMatch(/"contact"\."phone" is null/);
    expect(params).toContain("org_1");
    expect(params).toContain("ct_1");
  });

  it("si otro proceso llenó el teléfono entre tanto, no reporta captura", async () => {
    returned = [];
    const captured = await captureContactPhoneFromText({
      organizationId: "org_1",
      contactId: "ct_1",
      existingPhone: null,
      text: "4621345678",
    });
    expect(captured).toBeNull();
  });
});
