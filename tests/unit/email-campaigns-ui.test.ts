import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (...rel: string[]) => readFileSync(path.join(RAIZ, ...rel), "utf8");

const cliente = leer("src", "components", "broadcasts", "broadcasts-client.tsx");
const nav = leer("src", "config", "nav.ts");

describe("pantalla de Envíos masivos por correo", () => {
  it("habla con la API de campañas de correo, no con la de canales de chat", () => {
    expect(cliente).toContain("/api/email-campaigns");
    expect(cliente).toContain("/api/email-campaigns/audience");
    expect(cliente).toContain("/api/email-campaigns/parse");
    expect(cliente).not.toContain("WhatsappTemplatePicker");
    expect(cliente).not.toContain("templateName");
  });

  it("ofrece las dos fuentes pedidas: correos del CRM y segmentos cargados", () => {
    expect(cliente).toContain('title="Contactos del CRM"');
    expect(cliente).toContain('title="Remitentes del buzón"');
    expect(cliente).toContain('title="Cargar a mano"');
    expect(cliente).toContain('title="Archivo Excel o CSV"');
    expect(cliente).toContain('accept=".xlsx,.csv,.tsv,.txt"');
  });

  it("deja elegir la cuenta remitente y avisa su límite diario", () => {
    expect(cliente).toContain("senderAccountId");
    expect(cliente).toContain("dailyLimit");
    expect(cliente).toContain("Límite diario de esta cuenta");
  });

  it("el menú sigue llamándose Envíos masivos y usa el icono de correo", () => {
    expect(nav).toMatch(/href: "\/broadcasts", label: "Envíos masivos", icon: Mail/);
  });
});
