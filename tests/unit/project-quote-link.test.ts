import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { GET as getQuotes } from "@/app/api/quotes/route";
import { POST as postProject } from "@/app/api/projects/route";
import { schema } from "@/lib/db";
import { DEFAULT_PROJECT_STAGES } from "@/lib/project-contract";

/**
 * Desplegable de "Nuevo proyecto": las cotizaciones sin proyecto vinculado
 * alimentan el combo, el proyecto hereda el nombre/contacto y queda enlazado
 * en project_quote. Una cotización solo puede tener UN proyecto (409).
 */

const h = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    insertQueue: [] as unknown[][],
    selects: [] as unknown[],
    inserts: [] as { table: unknown; values: Record<string, unknown> | null }[],
    transactions: 0,
    session: { userId: "usr_1", organizationId: "org_1", role: "owner" },
  };

  function chain(rows: unknown[], record?: { setValues?: (v: Record<string, unknown>) => void }) {
    const proxy: unknown = new Proxy(Promise.resolve(rows), {
      get(target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const fn = Reflect.get(target, prop);
          return typeof fn === "function" ? fn.bind(target) : fn;
        }
        if (prop === "where") {
          return (cond: unknown) => {
            state.selects.push(cond);
            return proxy;
          };
        }
        if (prop === "values") {
          return (v: Record<string, unknown>) => {
            record?.setValues?.(v);
            return proxy;
          };
        }
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        return () => proxy;
      },
    });
    return proxy;
  }

  const db = {
    select: () => chain(state.selectQueue.shift() ?? []),
    insert: (table: unknown) => {
      const rec: { table: unknown; values: Record<string, unknown> | null } = { table, values: null };
      state.inserts.push(rec);
      return chain(state.insertQueue.shift() ?? [], { setValues: (v) => { rec.values = v; } });
    },
    execute: async () => [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: async (fn: (tx: any) => Promise<unknown>) => {
      state.transactions += 1;
      return fn(db);
    },
  };
  return { state, db };
});

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: () => h.db,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class extends Error {},
  requireSession: async () => h.state.session,
  getSessionOrNull: async () => h.state.session,
}));

vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: vi.fn(async () => {}) }));

vi.mock("@/server/webhooks/dispatcher", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/webhooks/dispatcher")>(),
  publishWebhook: vi.fn(async () => {}),
}));

function stages() {
  return Array.from({ length: DEFAULT_PROJECT_STAGES.length }, (_, i) => ({ id: `pst_${i}` }));
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.selectQueue = [];
  h.state.insertQueue = [];
  h.state.selects = [];
  h.state.inserts = [];
  h.state.transactions = 0;
  h.state.session = { userId: "usr_1", organizationId: "org_1", role: "owner" };
});

describe("GET /api/quotes?forProject=1 (desplegable de Nuevo proyecto)", () => {
  it("lista cotizaciones con nombre de contacto y filtra las ya vinculadas", async () => {
    h.state.selectQueue = [[{
      id: "qt_1",
      quoteNumber: "COT-0042",
      status: "sent",
      total: 48500,
      currency: "MXN",
      contactId: "ct_1",
      contactName: "María López",
    }]];

    const response = await getQuotes(new Request("http://localhost/api/quotes?forProject=1&limit=100"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.quotes).toHaveLength(1);
    expect(body.quotes[0]).toMatchObject({ quoteNumber: "COT-0042", contactName: "María López" });

    // El WHERE debe excluir archivadas y cotizaciones con proyecto (project_quote).
    const where = h.state.selects[0] as SQL;
    const query = new PgDialect().sqlToQuery(where);
    expect(query.sql).toContain("NOT EXISTS");
    expect(query.sql).toContain("project_quote");
    expect(query.sql).toContain("\"quote\".\"archived_at\" IS NULL");
    expect(query.params).toContain("org_1");
  });
});

describe("POST /api/projects con quoteId", () => {
  it("crea el proyecto, hereda el contacto y lo vincula en project_quote", async () => {
    h.state.selectQueue = [
      [{ contactId: "ct_1", archivedAt: null }], // validación de cotización
      stages(),                                   // etapas
      [],                                         // nextProjectCode
    ];
    h.state.insertQueue = [[], [{ id: "pq_1" }], []]; // proyecto, vínculo (returning), pasos

    const response = await postProject(post({
      name: "COT-0042 — María López",
      projectType: "marketing",
      quoteId: "qt_1",
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(typeof body.projectId).toBe("string");

    expect(h.state.inserts).toHaveLength(3);
    const [projectInsert, linkInsert, stepsInsert] = h.state.inserts;
    expect(projectInsert!.table).toBe(schema.project);
    expect(projectInsert!.values).toMatchObject({ contactId: "ct_1", name: "COT-0042 — María López" });
    expect(linkInsert!.table).toBe(schema.projectQuote);
    expect(linkInsert!.values).toMatchObject({
      organizationId: "org_1",
      quoteId: "qt_1",
      projectId: projectInsert!.values!.id,
    });
    expect(stepsInsert!.table).toBe(schema.projectStep);
  });

  it("modo manual (sin quoteId) sigue creando proyectos sin vínculo", async () => {
    h.state.selectQueue = [stages(), []];
    h.state.insertQueue = [[], []];

    const response = await postProject(post({ name: "Campaña de lanzamiento 2026", projectType: "marketing" }));

    expect(response.status).toBe(201);
    expect(h.state.inserts).toHaveLength(2); // proyecto + pasos, sin project_quote
    expect(h.state.inserts.map((i) => i.table)).not.toContain(schema.projectQuote);
  });

  it("rechaza una cotización de otra organización (422) sin crear nada", async () => {
    h.state.selectQueue = [[]]; // la cotización no existe en esta org

    const response = await postProject(post({ name: "X", quoteId: "qt_ajena" }));

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "project_error",
      message: expect.stringContaining("no pertenece"),
    });
    expect(h.state.transactions).toBe(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it("rechaza una cotización archivada (422)", async () => {
    h.state.selectQueue = [[{ contactId: "ct_1", archivedAt: new Date("2026-01-01") }]];

    const response = await postProject(post({ name: "X", quoteId: "qt_arch" }));

    expect(response.status).toBe(422);
    expect((await response.json()).error.message).toContain("archivada");
    expect(h.state.transactions).toBe(0);
  });

  it("responde 409 si la cotización ya tiene otro proyecto (índice único)", async () => {
    h.state.selectQueue = [
      [{ contactId: "ct_1", archivedAt: null }],
      stages(),
      [],
    ];
    // El insert del vínculo choca con el índice único → onConflictDoNothing → []
    h.state.insertQueue = [[], [], []];

    const response = await postProject(post({ name: "X", quoteId: "qt_1" }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatchObject({
      code: "project_error",
      message: expect.stringContaining("ya tiene un proyecto"),
    });
  });
});
