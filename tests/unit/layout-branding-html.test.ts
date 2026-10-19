import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El HTML que recibe el navegador, no la función interna.
 *
 * El síntoma que reportó el dueño: guardó «Dorado» en Ajustes → Marca y la
 * interfaz siguió lima. `getBrandingForRequest()` puede dar verde sola y aun
 * así no reflejarse, porque quien decide el color es el `<style>` que el layout
 * raíz pinta en `<head>`. Aquí se renderiza el layout de verdad y se lee el
 * HTML: eso es lo que ve el usuario.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSessionOrNull: vi.fn(),
}));

vi.mock("next/font/local", () => ({
  default: () => ({ variable: "--font-test" }),
}));

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

// `next/image` necesita el cargador de Next; en prueba basta un `<img>`.
// El `react` se importa dentro del factory: la burla se hoisted y arriba dejaría
// la referencia en TDZ.
vi.mock("next/image", async () => {
  const { createElement } = await import("react");
  return {
    default: (props: Record<string, unknown>) =>
      createElement("img", {
        src: props.src as string,
        alt: props.alt as string,
        className: props.className as string,
      }),
  };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: mocks.getSessionOrNull,
  UnauthorizedError: class extends Error {},
  requireSession: vi.fn(),
  getOrphanSession: vi.fn(),
}));

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import {
  accentCssVariables,
  DEFAULT_BRANDING,
  resolveAccentSet,
} from "@/lib/branding";
import RootLayout, { generateMetadata } from "@/app/layout";
import AuthLayout from "@/app/(auth)/layout";

const session = { userId: "u_1", organizationId: "org_2", role: "owner" };
const honeycat = { id: "org_2", metadata: JSON.stringify({ branding: { name: "Honeycat", accent: "#b8963e" } }) };

/** Falso de Drizzle que respeta el `limit` y anota si la consulta filtró. */
let filtrada: boolean;

function dbReturning(rows: unknown[]) {
  const box: Record<string, unknown> = {
    from: () => box,
    where: () => {
      filtrada = true;
      return box;
    },
    limit: (n?: number) => Promise.resolve(typeof n === "number" ? rows.slice(0, n) : rows),
  };
  box.then = (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve);
  mocks.getDb.mockImplementation(() => ({ select: () => box }));
}

async function html(rows: unknown[], withSession: boolean): Promise<string> {
  mocks.getSessionOrNull.mockResolvedValue(withSession ? session : null);
  dbReturning(rows);
  const element = await RootLayout({ children: null as unknown as ReactNode });
  return renderToStaticMarkup(element);
}

/** La pantalla de acceso se siempre sin sesión: eso es justo lo que prueba. */
async function authHtml(rows: unknown[]): Promise<string> {
  mocks.getSessionOrNull.mockResolvedValue(null);
  dbReturning(rows);
  const element = await AuthLayout({ children: null as unknown as ReactNode });
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  filtrada = false;
});

describe("layout raíz: el color guardado llega al navegador", () => {
  it("negocio en sesión con acento propio → su dorado en el <style>", async () => {
    const markup = await html([honeycat], true);
    expect(markup).toContain(accentCssVariables("#b8963e"));
    expect(markup).not.toContain(DEFAULT_BRANDING.accent);
    // La marca se busca POR negocio: sin el filtro, con dos tenants ganar la
    // consulta de la ruta pública y el color volvería a caerse.
    expect(filtrada).toBe(true);
  });

  it("sin sesión y dos negocios → lima neutro (el login no viste a un cliente)", async () => {
    const markup = await html([honeycat, { id: "org_1", metadata: null }], false);
    expect(markup).toContain(accentCssVariables(DEFAULT_BRANDING.accent));
    expect(filtrada).toBe(false);
  });

  it("el negocio en sesión es otro: su nombre manda en el <title>", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbReturning([honeycat]);
    await expect(generateMetadata()).resolves.toMatchObject({
      title: {
        default: "Honeycat — CRM de WhatsApp",
        template: "%s — Honeycat",
      },
    });
  });

  it("sin marca guardada el documento sigue pintando el acento por defecto", async () => {
    const markup = await html([{ id: "org_2", metadata: null }], true);
    expect(markup).toContain(accentCssVariables(DEFAULT_BRANDING.accent));
  });
});

describe("layout de acceso: la escenografía también es white-label", () => {
  it("instancia de un solo negocio → su nombre y su acento en la puerta", async () => {
    const markup = await authHtml([honeycat]);
    expect(markup).toContain("Honeycat");
    const dorado = resolveAccentSet("#b8963e", "light");
    expect(markup).toContain(`--zx-accent:${dorado.accent}`);
    expect(markup).toContain(`--zx-hover:${dorado.hover}`);
    expect(markup).toContain(`--zx-text:${dorado.text}`);
    expect(markup).not.toContain(DEFAULT_BRANDING.name);
  });

  it("dos negocios → marca neutra de la plataforma, nunca el logo de un cliente", async () => {
    const markup = await authHtml([honeycat, { id: "org_1", metadata: null }]);
    expect(markup).not.toContain("Honeycat");
    expect(markup).toContain(DEFAULT_BRANDING.name);
    expect(markup).toContain(
      `--zx-accent:${resolveAccentSet(DEFAULT_BRANDING.accent, "light").accent}`
    );
  });

  it("nombre de dos palabras: la segunda pinta en el color de la marca", async () => {
    const zen = {
      id: "org_9",
      metadata: JSON.stringify({ branding: { name: "Dental Zen", accent: "#3f6b66" } }),
    };
    const markup = await authHtml([zen]);
    expect(markup).toMatch(/Dental <span class="zx-tech">Zen<\/span>/);
  });

  it("el acento se calcula para fondo claro aunque el negocio guarde uno oscuro", async () => {
    // #111 es tan oscuro que el set de tema claro lo oscurece aún más; lo que
    // importa es que la tarjeta clara no reciba el aclarado del tema oscuro.
    const oscuro = {
      id: "org_9",
      metadata: JSON.stringify({ branding: { name: "Noche", accent: "#111111" } }),
    };
    const markup = await authHtml([oscuro]);
    expect(markup).toContain(
      `--zx-accent:${resolveAccentSet("#111111", "light").accent}`
    );
    expect(markup).not.toContain(
      `--zx-accent:${resolveAccentSet("#111111", "dark").accent}`
    );
  });
});

describe("ninguna página impone otra marca en la pestaña", () => {
  /**
   * `metadata.title` de una página PISA el del layout raíz. Dos páginas traían
   * el nombre del estudio que hizo el starter, así que en esas dos secciones la
   * pestaña dejaba de mostrar el negocio del dueño. La defensa es leer el
   * árbol: si alguien vuelve a escribir una empresa a mano, esto truena.
   */
  function titulosDePagina(): { archivo: string; titulo: string }[] {
    const salida: { archivo: string; titulo: string }[] = [];
    const pila = [path.join(process.cwd(), "src", "app")];
    while (pila.length > 0) {
      const dir = pila.pop()!;
      for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, entrada.name);
        if (entrada.isDirectory()) {
          pila.push(ruta);
          continue;
        }
        if (!/(?:^|[\\/])page\.tsx$/.test(ruta)) continue;
        const fuente = fs.readFileSync(ruta, "utf8");
        const m = /metadata\s*=\s*{[^}]*?title:\s*(["'`])([^"'`]*)\1/.exec(fuente);
        if (m) salida.push({ archivo: path.relative(process.cwd(), ruta), titulo: m[2]! });
      }
    }
    return salida;
  }

  it("los títulos de página son solo la sección, sin empresa", () => {
    const titulos = titulosDePagina();
    expect(titulos.length).toBeGreaterThan(0);
    for (const { archivo, titulo } of titulos) {
      expect(titulo, archivo).not.toMatch(/zorro|lumark|vocero/i);
      expect(titulo, archivo).not.toContain("|");
    }
  });

  it("la plantilla del layout sigue añadiendo el negocio a esas secciones", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbReturning([honeycat]);
    const { title } = await generateMetadata();
    const plantilla = (title as { template: string }).template;
    expect(plantilla).toContain("Honeycat");
    for (const { archivo, titulo } of titulosDePagina()) {
      expect(plantilla.replace("%s", titulo), archivo).toBe(`${titulo} — Honeycat`);
    }
  });
});
