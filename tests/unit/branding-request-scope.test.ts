import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * La marca del documento según quién está en la sesión.
 *
 * Bug real: con dos negocios en la instancia, el color guardado en Ajustes →
 * Marca dejaba de aplicarse. `getBrandingContext()` sin organización devuelve
 * marca neutra a propósito (el login no puede enseñar el logo de un cliente),
 * pero el layout raíz —único que inyecta las variables CSS del acento, el
 * `<title>` y el favicon— llamaba a esa versión sin sesión también para las
 * páginas ya autenticadas. Aquí se fija que la sesión manda y que la regla
 * pública sigue intacta cuando no la hay.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSessionOrNull: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionOrNull: mocks.getSessionOrNull,
}));

import { accentCssVariables, DEFAULT_BRANDING } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { getBrandingContextForRequest } from "@/server/branding";

const session = { userId: "u_1", organizationId: "org_2", role: "owner" };
const dorado = { branding: { name: "Honeycat", accent: "#b8963e" } };

async function marca() {
  return (await getBrandingContextForRequest()).branding;
}

/** Falso de Drizzle que anota si la consulta filtró por organización. */
let filtrada: boolean;

function selectChain(rows: unknown[]) {
  const box: Record<string, unknown> = {
    from: () => box,
    where: () => {
      filtrada = true;
      return box;
    },
    limit: (n?: number) => Promise.resolve(typeof n === "number" ? rows.slice(0, n) : rows),
  };
  box.then = (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve);
  return box;
}

function dbWith(rows: unknown[]) {
  mocks.getDb.mockImplementation(() => ({ select: () => selectChain(rows) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  filtrada = false;
});

describe("marca del documento con varios negocios en la instancia", () => {
  it("con sesión manda SU negocio, no la marca neutra de la instancia", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbWith([{ id: "org_2", metadata: JSON.stringify(dorado) }]);

    const branding = await marca();
    expect(branding.name).toBe("Honeycat");
    expect(branding.accent).toBe("#b8963e");
    expect(filtrada).toBe(true);
  });

  it("el color recuperado inyecta las variables CSS de los dos temas", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbWith([{ id: "org_2", metadata: JSON.stringify(dorado) }]);

    const css = accentCssVariables((await marca()).accent);
    expect(css).toContain(":root:root{");
    expect(css).toContain(':root:root[data-theme="dark"]{');
  });

  it("sin sesión sigue la regla pública: dos negocios → marca neutra", async () => {
    mocks.getSessionOrNull.mockResolvedValue(null);
    dbWith([
      { id: "org_1", metadata: JSON.stringify(dorado) },
      { id: "org_2", metadata: null },
    ]);

    await expect(marca()).resolves.toEqual(DEFAULT_BRANDING);
    // La ruta pública no filtra: cuenta organizaciones y decide.
    expect(filtrada).toBe(false);
  });

  it("sin sesión y un solo negocio, ese negocio es la marca de la instancia", async () => {
    mocks.getSessionOrNull.mockResolvedValue(null);
    dbWith([{ id: "org_1", metadata: JSON.stringify(dorado) }]);

    expect((await marca()).accent).toBe("#b8963e");
  });

  it("el nombre visible sale de Datos de Empresa, no del nombre de la marca", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbWith([{
      id: "org_2",
      metadata: JSON.stringify({
        branding: { name: "LUMARK", accent: "#b8963e" },
        businessSettings: { companyName: "Honeycat" },
      }),
    }]);

    const branding = await marca();
    expect(branding.name).toBe("Honeycat");
    // El resto de la marca (acento) no se toca.
    expect(branding.accent).toBe("#b8963e");
  });

  it("sin nombre en Datos de Empresa cae al nombre guardado en la marca", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbWith([{
      id: "org_2",
      metadata: JSON.stringify({
        branding: { name: "LUMARK", accent: "#b8963e" },
        businessSettings: { companyName: "   " },
      }),
    }]);

    expect((await marca()).name).toBe("LUMARK");
  });

  it("el negocio en sesión ya no existe → neutra, nunca la fila de un vecino", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbWith([]);

    await expect(marca()).resolves.toEqual(DEFAULT_BRANDING);
  });

  it("metadata corrupta no tumba el layout: normaliza a defaults", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbWith([{ id: "org_2", metadata: "{no es json" }]);

    await expect(marca()).resolves.toEqual(DEFAULT_BRANDING);
  });

  it("si resolver la sesión falla, el layout cae a la marca por defecto", async () => {
    mocks.getSessionOrNull.mockRejectedValue(new Error("db down"));
    await expect(getBrandingContextForRequest()).rejects.toThrow("db down");
    await expect(
      getBrandingContextForRequest().then((c) => c.branding).catch(() => DEFAULT_BRANDING)
    ).resolves.toEqual(DEFAULT_BRANDING);
  });

  it("la URL del icono lleva el negocio: dos marcas iguales no comparten caché", async () => {
    mocks.getSessionOrNull.mockResolvedValue(session);
    dbWith([{ id: "org_2", metadata: JSON.stringify(dorado) }]);

    const ctx = await getBrandingContextForRequest();
    expect(ctx.organizationId).toBe("org_2");
    expect(faviconHref(ctx.branding, ctx.organizationId)).toContain("o=org_2");
    // Misma marca en otro negocio: otra URL, si no el navegador repite logo.
    expect(faviconHref(ctx.branding, "org_2")).not.toBe(faviconHref(ctx.branding, "org_1"));
  });
});
