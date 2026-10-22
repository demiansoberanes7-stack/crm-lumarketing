import { describe, expect, it } from "vitest";
import { mailtoHref, safeHttpUrl, webHref } from "@/lib/safe-url";

/**
 * El bug que cierra este archivo: una URL guardada desde datos ajenos acababa
 * literal en un `href`. `PUT /api/calendar/settings` es `withAuth` (cualquier
 * miembro), `POST /api/catalog/import` recibe el CSV que armó otro, y la ficha
 * de proveedor pinta el sitio que se escribió a mano. Un `javascript:…` en
 * cualquiera de esos tres puntos ejecuta código con la sesión de quien hace
 * clic —en el origen real del CRM, con sus cookies.
 */

describe("safeHttpUrl", () => {
  it("conserva las URL absolutas legítimas", () => {
    expect(safeHttpUrl("https://meet.google.com/abc-defg-hij")).toBe(
      "https://meet.google.com/abc-defg-hij"
    );
    expect(safeHttpUrl("http://127.0.0.1:3000/x")).toBe("http://127.0.0.1:3000/x");
  });

  it("rechaza todo esquema que no sea HTTP(S)", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(safeHttpUrl(hostile)).toBeNull();
    }
  });

  it("no deja colar el esquema por espacios en blanco o saltos de línea", () => {
    expect(safeHttpUrl("  javascript:alert(1)  ")).toBeNull();
    // El navegador quita el salto igual que `URL`: si no se normalizara, esto
    // sería `javascript:` disfrazado y pasaría cualquier prueba de prefijo.
    expect(safeHttpUrl("java\nscript:alert(1)")).toBeNull();
    expect(safeHttpUrl("\tjavascript:alert(1)")).toBeNull();
  });

  it("descarta lo relativo, lo vacío y lo que no es cadena", () => {
    expect(safeHttpUrl("/inbox?contact=1")).toBeNull();
    expect(safeHttpUrl("micarro.com/tienda")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl("   ")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });

  it("acota la longitud: un enlace kilométrico no se guarda", () => {
    expect(safeHttpUrl(`https://x.com/${"a".repeat(2000)}`)).toBeNull();
    expect(safeHttpUrl(`https://x.com/${"a".repeat(500)}`)).not.toBeNull();
  });
});

describe("webHref", () => {
  it("acepta el dominio escrito sin esquema, como ya hacía la ficha de proveedor", () => {
    expect(webHref("micarro.com/tienda")).toBe("https://micarro.com/tienda");
    expect(webHref(" https://lumarketing.digital ")).toBe("https://lumarketing.digital/");
  });

  it("convierte un `javascript:` en «no hay enlace», nunca en href", () => {
    expect(webHref("javascript:alert(1)")).toBeNull();
    // `startsWith("http")` —la defensa vieja— se conformaba con «httpx://» y
    // con cualquier cosa que empezara mal; aquí el esquema se parsea de verdad.
    expect(webHref("httpjavascript:alert(1)")).toBeNull();
  });

  it("rechaza lo que no es una URL en absoluto", () => {
    expect(webHref("")).toBeNull();
    expect(webHref("#")).toBeNull();
    expect(webHref("<script>alert(1)</script>")).toBeNull();
    expect(webHref(null)).toBeNull();
  });
});

describe("mailtoHref", () => {
  it("arma el enlace de correo con un destinatario normal", () => {
    expect(mailtoHref("ventas@micarro.mx")).toBe("mailto:ventas@micarro.mx");
    expect(mailtoHref("  o.gomez+crm@dominio.com  ")).toBe("mailto:o.gomez+crm@dominio.com");
  });

  it("no deja meter parámetros ni destinatarios extra en el enlace", () => {
    // `mailto:a@b.mx?subject=…` y la coma son la forma de que un campo de
    // texto del CRM cambie el asunto o añada copia al abrir el correo.
    expect(mailtoHref("a@b.mx?subject=hola")).toBeNull();
    expect(mailtoHref("a@b.mx, evilmexicano@otro.com")).toBeNull();
    expect(mailtoHref("\"onclick=alert(1)\"@b.mx")).toBeNull();
    expect(mailtoHref("sin-arroba")).toBeNull();
    expect(mailtoHref("")).toBeNull();
  });
});
