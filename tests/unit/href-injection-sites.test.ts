import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeLink } from "@/server/agenda/settings";

/**
 * Dónde se materializa el saneado de URL.
 *
 * `safeHttpUrl`/`webHref` son la regla; estas pruebas atan la regla a los
 * sumideros reales, porque el agujero vuelve en cuanto alguien escribe otra vez
 * `href={dato}` en un componente u omite la validación en una ruta de escritura.
 * Cada anclaje se verifica con `not.toBeNull()` para que un cambio de forma en
 * el JSX o en el `mapRow` haga fallar la prueba en lugar de dejarla vacía.
 */
const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const leer = (...rel: string[]) => readFileSync(path.join(RAIZ, ...rel), "utf8");

describe("normalizeLink (enlace de reunión de la agenda)", () => {
  it("guarda el enlace legítimo y normaliza el ruido", () => {
    expect(normalizeLink("https://meet.google.com/sxy-abcw-vrs")).toBe(
      "https://meet.google.com/sxy-abcw-vrs"
    );
    expect(normalizeLink("  https://zoom.us/j/123  ")).toBe("https://zoom.us/j/123");
  });

  it("vaciar el campo sigue significando null", () => {
    expect(normalizeLink("")).toBeNull();
    expect(normalizeLink("   ")).toBeNull();
    expect(normalizeLink(null)).toBeNull();
    expect(normalizeLink(undefined)).toBeNull();
  });

  it("un `javascript:` no se guarda: `PUT /api/calendar/settings` es withAuth y lo escribía cualquier miembro", () => {
    expect(normalizeLink("javascript:alert(document.cookie)")).toBeNull();
    expect(normalizeLink("data:text/html,<script>alert(1)</script>")).toBeNull();
  });
});

describe("los sumideros siguen anclados al saneado", () => {
  it("la importación de catálogo valida la URL antes de escribir", () => {
    const src = leer("src", "app", "api", "catalog", "import", "route.ts");
    expect(src.match(/const websiteUrl = safeHttpUrl\(/)).not.toBeNull();
    // El `slice` viejo recortaba a 1024 pero no miraba el esquema.
    expect(src).not.toContain("websiteUrl.slice(0, 1024)");
  });

  it("la tarjeta del producto no pinta un href crudo", () => {
    const src = leer("src", "components", "catalog", "catalog-client.tsx");
    expect(src.match(/href=\{webHref\(p\.websiteUrl\)/)).not.toBeNull();
    expect(src).not.toMatch(/href=\{p\.websiteUrl\}/);
  });

  it("el enlace de reunión de Citas pasa por webHref", () => {
    const src = leer("src", "components", "bookings", "bookings-client.tsx");
    expect(src.match(/href=\{webHref\(b\.meetingLink\)/)).not.toBeNull();
    expect(src).not.toMatch(/href=\{b\.meetingLink\}/);
  });

  it("la ficha de proveedor usa los tres hrefs saneados", () => {
    const src = leer("src", "components", "suppliers", "suppliers-client.tsx");
    expect(src.match(/href=\{mailtoHref\(value\)/)).not.toBeNull();
    expect(src.match(/href=\{dialHref\(value\)/)).not.toBeNull();
    expect(src.match(/href=\{webHref\(value\)/)).not.toBeNull();
    // El `startsWith("http")` aceptaba `httpjavascript:…` y no limitaba el resto.
    expect(src).not.toContain('value.startsWith("http")');
    expect(src).not.toMatch(/href=\{`mailto:/);
    expect(src).not.toMatch(/href=\{`tel:/);
  });

  it("el export de Inteligencia comparte el escapado del servidor", () => {
    const src = leer("src", "components", "inteligencia", "intel-export.ts");
    expect(src.match(/import \{ escapeCsvCell \} from "@\/lib\/csv"/)).not.toBeNull();
    expect(src).toContain("escapeCsvCell(String(v))");
  });
});
