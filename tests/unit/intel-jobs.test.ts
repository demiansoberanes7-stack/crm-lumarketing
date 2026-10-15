import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Jobs de ingesta INTEL: el candado anti-duplicados (índice único parcial →
 * 23505 ⇒ null ⇒ 409 en la ruta), la expiración de huérfanos, el avance por
 * nicho y el cierre de cada corrida. El runner GT se prueba con dependencias
 * mockeadas: lo que importa aquí es la contabilidad del job.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  updateCalls: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
  insertValues: [] as Array<Record<string, unknown>>,
  insertThrows: null as unknown,
  selectRows: [] as unknown[][],
  listActiveTerms: vi.fn(),
  runGtIngest: vi.fn(),
  markGtSynced: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

vi.mock("@/server/intel/terms", () => ({ listActiveTerms: mocks.listActiveTerms }));
vi.mock("@/server/intel/service", () => ({ runGtIngest: mocks.runGtIngest }));
vi.mock("@/server/intel/geo", () => ({ runGeoIngest: vi.fn() }));
vi.mock("@/server/intel/credentials", () => ({ markGtSynced: mocks.markGtSynced }));

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "orderBy"]) c[m] = () => c;
  c.where = (w: unknown) => {
    c.__where = w;
    return c;
  };
  c.limit = () => Promise.resolve(rows);
  (c as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return c;
}

function buildDb() {
  return {
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (w: unknown) => {
          mocks.updateCalls.push({ set: v, where: w });
          return Promise.resolve([]);
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          if (mocks.insertThrows) return Promise.reject(mocks.insertThrows);
          mocks.insertValues.push(v);
          return Promise.resolve([
            {
              ...v,
              status: "running",
              total: 0,
              completed: 0,
              result: null,
              error: null,
              createdAt: new Date(),
              finishedAt: null,
            },
          ]);
        },
      }),
    }),
    select: () => chain(mocks.selectRows.shift() ?? []),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateCalls.length = 0;
  mocks.insertValues.length = 0;
  mocks.insertThrows = null;
  mocks.selectRows.length = 0;
  mocks.getDb.mockReturnValue(buildDb());
});

describe("createIntelJob — candado anti-duplicados", () => {
  it("un segundo job igual (23505) devuelve null en vez de lanzar", async () => {
    const { createIntelJob } = await import("@/server/intel/jobs");
    mocks.insertThrows = { code: "23505" };
    const job = await createIntelJob({ organizationId: "org_1", kind: "gt_all" });
    expect(job).toBeNull();
  });

  it("reconoce el 23505 envuelto en cause", async () => {
    const { createIntelJob } = await import("@/server/intel/jobs");
    mocks.insertThrows = Object.assign(new Error("insert"), { cause: { code: "23505" } });
    const job = await createIntelJob({ organizationId: "org_1", kind: "geo", termId: "itr_1" });
    expect(job).toBeNull();
  });

  it("crea el job y ANTES libera huérfanos running de la misma org/kind", async () => {
    const { createIntelJob } = await import("@/server/intel/jobs");
    const job = await createIntelJob({ organizationId: "org_1", kind: "gt_all" });
    expect(job?.status).toBe("running");

    expect(mocks.updateCalls).toHaveLength(1);
    const stale = mocks.updateCalls[0]!;
    expect(stale.set).toMatchObject({ status: "error" });
    const dialect = new PgDialect();
    const staleWhere = dialect.sqlToQuery(stale.where as never);
    expect(staleWhere.sql).toContain('"intel_job"."organization_id"');
    expect(staleWhere.sql).toContain('"intel_job"."status"');
    expect(staleWhere.params).toContain("org_1");
    expect(staleWhere.params).toContain("running");
    expect(staleWhere.params).toContain("gt_all");

    expect(mocks.insertValues).toHaveLength(1);
    expect(mocks.insertValues[0]).toMatchObject({
      organizationId: "org_1",
      kind: "gt_all",
      termId: null,
    });
  });
});

describe("cierre de jobs", () => {
  it("finish/fail solo tocan jobs running (no resucitan un job expirado)", async () => {
    const { finishIntelJob, failIntelJob } = await import("@/server/intel/jobs");
    await finishIntelJob("ijb_1", { ok: true });
    await failIntelJob("ijb_2", "boom");

    expect(mocks.updateCalls).toHaveLength(2);
    for (const call of mocks.updateCalls) {
      const dialect = new PgDialect();
      const where = dialect.sqlToQuery(call.where as never);
      expect(where.sql).toContain('"intel_job"."id"');
      expect(where.sql).toContain('"intel_job"."status"');
      expect(where.params).toContain("running");
    }
    expect(mocks.updateCalls[0]!.set).toMatchObject({ status: "done" });
    expect(mocks.updateCalls[1]!.set).toMatchObject({ status: "error", error: "boom" });
  });
});

describe("runGtAllJob — contabilidad del avance", () => {
  it("reporta n/total por nicho y cierra con el resumen", async () => {
    const { runGtAllJob } = await import("@/server/intel/jobs");
    mocks.listActiveTerms.mockResolvedValue([
      { id: "itr_1", name: "cámaras", geo: "MX" },
      { id: "itr_2", name: "redes", geo: "MX" },
      { id: "itr_3", name: "solar", geo: "MX" },
    ]);
    mocks.runGtIngest
      .mockResolvedValueOnce({ ok: true, points: 30 })
      .mockResolvedValueOnce({ ok: false, reason: "sin datos" })
      .mockResolvedValueOnce({ ok: true, points: 30 });

    await runGtAllJob({ jobId: "ijb_1", organizationId: "org_1" });

    const progress = mocks.updateCalls.filter((c) => "completed" in c.set);
    expect(progress.map((c) => c.set.completed)).toEqual([0, 1, 2, 3]);
    for (const p of progress) expect(p.set.total).toBe(3);

    const done = mocks.updateCalls.find((c) => c.set.status === "done");
    expect(done?.set.result).toMatchObject({ gtIngested: 2, gtFailed: 1, total: 3 });
    expect(mocks.markGtSynced).toHaveBeenCalledWith("org_1");
  });

  it("una excepción del runner deja el job en error (no queda colgado)", async () => {
    const { runGtAllJob } = await import("@/server/intel/jobs");
    mocks.listActiveTerms.mockRejectedValue(new Error("bd caída"));

    await runGtAllJob({ jobId: "ijb_1", organizationId: "org_1" });

    const fail = mocks.updateCalls.find((c) => c.set.status === "error");
    expect(fail?.set.error).toBe("bd caída");
  });
});
