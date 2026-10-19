import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El clic de «Guardar marca», de punta a punta.
 *
 * El reclamo del dueño fue «guardé Dorado y sigue lima». Lo otro ya está
 * cubierto (el `<style>` que sale del layout); lo que faltaba era la pata de
 * escritura: que el PUT de `/api/settings/branding` deje EN LA BD el color que
 * el formulario mandó y no le robe a otro negocio ni le borre lo que la
 * tarjeta del icono y los PDF guardaron por su cuenta.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireSession: vi.fn(),
  getSessionOrNull: vi.fn(),
  recordDiagnostic: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));
vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  getSessionOrNull: mocks.getSessionOrNull,
  UnauthorizedError: class extends Error {},
  getOrphanSession: vi.fn(),
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: mocks.recordDiagnostic }));

import { PUT } from "@/app/api/settings/branding/route";
import type { Branding } from "@/lib/branding";

const selectQueue: unknown[][] = [];
const escrituras: Record<string, unknown>[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "orderBy"]) {
    chain[method] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const db = {
  select: () => thenableChain(selectQueue.shift() ?? []),
  update: () => ({
    set: (values: Record<string, unknown>) => {
      escrituras.push(values);
      return { where: () => Promise.resolve([]) };
    },
  }),
  insert: () => ({ values: () => Promise.resolve(undefined) }),
};

/** La fila de `organization` como la guarda Better Auth: metadata en JSON. */
function orgRow(branding: Partial<Branding>) {
  return { metadata: JSON.stringify({ branding }) };
}

function put(body: unknown) {
  return PUT(new Request("http://local/api/settings/branding", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

/** Lo que quedó escrito en `organization.metadata`. */
function marcaEscrita(): Branding {
  const meta = JSON.parse(String(escrituras[0]?.metadata)) as { branding: Branding };
  return meta.branding;
}

const completo = {
  name: "Dental Zen",
  accent: "#B8963E",
  currency: "MXN",
};

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue.length = 0;
  escrituras.length = 0;
  mocks.getDb.mockReturnValue(db);
  mocks.requireSession.mockResolvedValue({
    userId: "u_1",
    organizationId: "org_2",
    role: "owner",
  });
});

describe("guardar la marca desde Ajustes → Marca", () => {
  it("el color elegido se escribe normalizado (hex en minúsculas)", async () => {
    selectQueue.push(
      [orgRow({ name: "Dental Zen", accent: "#65a30d", currency: "MXN", favicon: null, pdfColors: { header: "#e87722", accent: "#e87722" } })],
      [orgRow({ name: "Dental Zen", accent: "#65a30d", currency: "MXN", favicon: null, pdfColors: { header: "#e87722", accent: "#e87722" } })]
    );
    await expect(put(completo)).resolves.toMatchObject({ status: 200 });
    expect(escrituras).toHaveLength(1);
    expect(marcaEscrita().accent).toBe("#b8963e");
    expect(marcaEscrita().name).toBe("Dental Zen");
  });

  it("un PUT sin pdfColors ni icono no borra lo que esas tarjetas guardaron", async () => {
    const existentes: Branding = {
      name: "Dental Zen",
      accent: "#3f5972",
      currency: "MXN",
      favicon: { mime: "image/png", version: 4 },
      pdfColors: { header: "#123456", accent: "#654321" },
    };
    selectQueue.push([orgRow(existentes)], [orgRow(existentes)]);
    await expect(put(completo)).resolves.toMatchObject({ status: 200 });

    expect(marcaEscrita().pdfColors).toEqual(existentes.pdfColors);
    expect(marcaEscrita().favicon).toEqual(existentes.favicon);
  });

  it("con el pdfColors sí enviado, ese manda", async () => {
    selectQueue.push(
      [orgRow({ name: "Dental Zen", accent: "#65a30d", currency: "MXN", favicon: null, pdfColors: { header: "#e87722", accent: "#e87722" } })],
      [orgRow({ name: "Dental Zen", accent: "#65a30d", currency: "MXN", favicon: null, pdfColors: { header: "#e87722", accent: "#e87722" } })]
    );
    await expect(put({ ...completo, pdfColors: { header: "#b8963e", accent: "#b8963e" } })).resolves.toMatchObject({ status: 200 });
    expect(marcaEscrita().pdfColors.header).toBe("#b8963e");
  });

  it("un color inválido no escribe nada", async () => {
    selectQueue.push([orgRow({ name: "Dental Zen", accent: "#65a30d", currency: "MXN" })]);
    await expect(put({ ...completo, accent: "rojo" })).resolves.toMatchObject({ status: 422 });
    expect(escrituras).toHaveLength(0);
  });

  it("solo el dueño mueve la marca del negocio", async () => {
    mocks.requireSession.mockResolvedValue({ userId: "u_2", organizationId: "org_2", role: "agent" });
    await expect(put(completo)).resolves.toMatchObject({ status: 403 });
    expect(escrituras).toHaveLength(0);
  });

  it("el GET del formulario responde con la marca del negocio de la sesión", async () => {
    mocks.getSessionOrNull.mockResolvedValue({ userId: "u_1", organizationId: "org_2", role: "owner" });
    selectQueue.push([orgRow({ name: "Dental Zen", accent: "#b8963e", currency: "MXN" })]);
    const { GET } = await import("@/app/api/settings/branding/route");
    const res = await GET();
    const data = (await res.json()) as { branding: Branding; accentSet: { accent: string } };
    expect(data.branding.accent).toBe("#b8963e");
    // La vista previa del formulario usa este set ya resuelto.
    expect(data.accentSet.accent).toBe("#B8963E");
  });
});
