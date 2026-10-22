import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DELETE, POST } from "@/app/api/prospects/dismiss/route";
import { emailKey, prospectTargetOf } from "@/server/prospects/dismiss";

/**
 * Descartar un prospecto (`/api/prospects/dismiss`).
 *
 * Lo que se jura aquí es que la acción es una MARCA y no un borrado:
 *  - `POST` inserta en `prospect_dismissal` y nada más —ni toca `contact`, ni
 *    `message`, ni `email_message`—;
 *  - redescartar al mismo no duplica (índice único `org, kind, key` y
 *    `on conflict do nothing`);
 *  - `DELETE` quita la marca y su `where` lleva el tenant, para que un miembro
 *    no restaure el descarte de otro negocio;
 *  - una petición ambigua (los dos campos, o ninguno) se rechaza con 422 antes
 *    de escribir: una clave ambigua en esa tabla ocultaría a otro cliente.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class extends Error {},
  requireSession: async () => ({
    userId: "usr_1",
    organizationId: "org_1",
    role: "owner",
  }),
  getSessionOrNull: async () => null,
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: vi.fn(async () => {}),
}));

const state = {
  inserts: [] as Record<string, unknown>[],
  conflictTargets: [] as unknown[],
  deletes: [] as unknown[],
  dismissals: [] as { key: string; createdAt: Date }[],
};

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

beforeEach(() => {
  state.inserts = [];
  state.conflictTargets = [];
  state.deletes = [];
  state.dismissals = [];
  mocks.getDb.mockReturnValue({
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        state.inserts.push(row);
        return {
          onConflictDoNothing: (config: unknown) => {
            const target = (config as { target?: unknown }).target;
            if (target) state.conflictTargets.push(target);
            return Promise.resolve([]);
          },
        };
      },
    }),
    delete: () => ({
      where: (condition: unknown) => {
        state.deletes.push(condition);
        return Promise.resolve([]);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.dismissals),
      }),
    }),
  });
});

function jsonRequest(body: unknown, url = "http://local/api/prospects/dismiss") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("la clave del descarte", () => {
  it("un contacto se marca por su id", () => {
    expect(prospectTargetOf({ contactId: "ct_1" })).toEqual({
      kind: "contact",
      key: "ct_1",
    });
  });

  it("el correo se normaliza: sin espacios y en minúsculas", () => {
    expect(prospectTargetOf({ email: "  Nancy.Covarrubias@Syscom.mx " })).toEqual({
      kind: "email",
      key: "nancy.covarrubias@syscom.mx",
    });
    expect(emailKey(" BOT1@syscom.mx ")).toBe("bot1@syscom.mx");
  });

  it("no se acepta un descarte sin destinatario", () => {
    expect(prospectTargetOf({})).toBeNull();
    expect(prospectTargetOf({ contactId: "", email: "  " })).toBeNull();
  });

  it("ni con los dos campos: la clave quedaría ambigua", () => {
    expect(prospectTargetOf({ contactId: "ct_1", email: "a@b.mx" })).toBeNull();
  });

  it("un valor sin forma de dirección no se guarda", () => {
    expect(prospectTargetOf({ email: "nancy" })).toBeNull();
    // 256 caracteres: rebasa lo que cabe en `key` y lo que un servidor puede
    // poner en `From:`; guardarlo sería un descarte que jamás coincide.
    expect(prospectTargetOf({ email: `${"x".repeat(251)}@y.mx` })).toBeNull();
    expect(prospectTargetOf({ email: `${"x".repeat(249)}@y.mx` })).not.toBeNull();
  });

  it("un id de contacto desbordado se rechaza, no se recorta", () => {
    // Recortarlo guardaría una clave que jamás coincide: imposible de restaurar
    // desde la pantalla y sin sentido en la tabla.
    expect(prospectTargetOf({ contactId: "c".repeat(300) })).toBeNull();
  });
});

describe("POST /api/prospects/dismiss", () => {
  it("guarda la marca con su tenant y su autor", async () => {
    const res = await POST(jsonRequest({ email: "bot1@syscom.mx" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dismissed: true });

    expect(state.inserts).toHaveLength(1);
    const row = state.inserts[0];
    expect(row).toMatchObject({
      organizationId: "org_1",
      kind: "email",
      key: "bot1@syscom.mx",
      dismissedBy: "usr_1",
    });
    expect(String(row?.id)).toMatch(/^pdis_/);
  });

  it("confía en el índice único para no duplicar", async () => {
    await POST(jsonRequest({ contactId: "ct_1" }));
    expect(state.conflictTargets).toHaveLength(1);
    // `on conflict (organization_id, kind, key)` tiene que nombrar JUSTO las
    // columnas del índice único de la migración; si no, Postgres no lo resuelve
    // y el segundo descarte revienta en vez de ignorarse.
    const columns = (state.conflictTargets[0] as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(["organization_id", "kind", "key"]);
  });

  it("rechaza 422 una petición sin prospecto", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(422);
    expect(state.inserts).toEqual([]);
  });

  it("no borra nada del prospecto", async () => {
    await POST(jsonRequest({ contactId: "ct_1" }));
    expect(state.deletes).toEqual([]);
  });
});

describe("DELETE /api/prospects/dismiss", () => {
  it("quita la marca y solo la marca", async () => {
    const req = new Request(
      "http://local/api/prospects/dismiss?email=BOT1%40syscom.mx",
      { method: "DELETE" }
    );
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ restored: true });

    expect(state.deletes).toHaveLength(1);
    expect(state.inserts).toEqual([]);
  });

  it("el borrado exige el tenant y la clave normalizada", async () => {
    const req = new Request(
      "http://local/api/prospects/dismiss?email=Nancy.Covarrubias%40Syscom.mx",
      { method: "DELETE" }
    );
    await DELETE(req);
    const { sql: text, params } = render(state.deletes[0]);
    expect(text).toContain('"prospect_dismissal"."organization_id"');
    expect(text).toContain('"prospect_dismissal"."kind"');
    expect(text).toContain('"prospect_dismissal"."key"');
    expect(params).toContain("org_1");
    expect(params).toContain("nancy.covarrubias@syscom.mx");
  });

  it("sin query no se borra a nadie", async () => {
    const res = await DELETE(
      new Request("http://local/api/prospects/dismiss", { method: "DELETE" })
    );
    expect(res.status).toBe(422);
    expect(state.deletes).toEqual([]);
  });
});
