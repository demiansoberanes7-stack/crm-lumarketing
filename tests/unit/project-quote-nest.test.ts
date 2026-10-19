import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectError } from "@/server/projects/errors";

/**
 * Anidar una cotización a un proyecto YA creado. Antes el vínculo solo se
 * escribía al crear el proyecto desde la cotización, así que un proyecto
 * existente no tenía forma de recibir una cotización posterior.
 */

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

let selectQueue: unknown[][] = [];
let insertReturned: unknown[] = [];
let deleteReturned: unknown[] = [];

function selectChain() {
  const box: Record<string, unknown> = {};
  for (const method of ["from", "where"]) box[method] = () => box;
  box.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  box.orderBy = () => Promise.resolve(selectQueue.shift() ?? []);
  box.then = (resolve: (value: unknown) => void) =>
    Promise.resolve(selectQueue.shift() ?? []).then(resolve);
  return box;
}

beforeEach(() => {
  selectQueue = [];
  insertReturned = [{ id: "pq_1" }];
  deleteReturned = [{ id: "pq_1" }];
  mocks.getDb.mockReturnValue({
    select: () => selectChain(),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(insertReturned),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(deleteReturned),
      }),
    }),
  });
});

const QUOTE = { id: "q_1", quoteNumber: "COT-0042", archivedAt: null };

function quoteRow(row: unknown | null) {
  selectQueue.push(row ? [row] : []);
}

describe("linkProjectQuote", () => {
  it("anida y devuelve el vínculo nuevo", async () => {
    quoteRow(QUOTE);
    selectQueue.push([]); // sin vínculo previo
    const { linkProjectQuote } = await import("@/server/projects/quotes");
    await expect(linkProjectQuote("org_1", "prj_1", "q_1")).resolves.toEqual({
      alreadyLinked: false,
    });
  });

  it("es idempotente: re-anidar en el mismo proyecto no duplica ni falla", async () => {
    quoteRow(QUOTE);
    selectQueue.push([{ projectId: "prj_1" }]);
    const { linkProjectQuote } = await import("@/server/projects/quotes");
    await expect(linkProjectQuote("org_1", "prj_1", "q_1")).resolves.toEqual({
      alreadyLinked: true,
    });
  });

  it("rechaza anidar en otro proyecto con 409 y el folio", async () => {
    quoteRow(QUOTE);
    selectQueue.push([{ projectId: "prj_OTRO" }]);
    const { linkProjectQuote } = await import("@/server/projects/quotes");
    const err = await linkProjectQuote("org_1", "prj_1", "q_1").catch((e) => e);
    expect(err).toBeInstanceOf(ProjectError);
    expect((err as ProjectError).status).toBe(409);
    expect((err as Error).message).toContain("COT-0042");
  });

  it("una cotización inexistente o de otra org es 404", async () => {
    quoteRow(null);
    const { linkProjectQuote } = await import("@/server/projects/quotes");
    const err = await linkProjectQuote("org_1", "prj_1", "q_ajena").catch((e) => e);
    expect(err).toBeInstanceOf(ProjectError);
    expect((err as ProjectError).status).toBe(404);
  });

  it("una cotización archivada no se anida (422)", async () => {
    quoteRow({ ...QUOTE, archivedAt: new Date() });
    const { linkProjectQuote } = await import("@/server/projects/quotes");
    const err = await linkProjectQuote("org_1", "prj_1", "q_1").catch((e) => e);
    expect((err as ProjectError).status).toBe(422);
  });

  it("si otra pestaña ganó el índice único, 409 en vez de un vínculo fantasma", async () => {
    quoteRow(QUOTE);
    selectQueue.push([]);
    insertReturned = [];
    const { linkProjectQuote } = await import("@/server/projects/quotes");
    const err = await linkProjectQuote("org_1", "prj_1", "q_1").catch((e) => e);
    expect((err as ProjectError).status).toBe(409);
  });
});

describe("unlinkProjectQuote", () => {
  it("borra el vínculo existente", async () => {
    const { unlinkProjectQuote } = await import("@/server/projects/quotes");
    await expect(unlinkProjectQuote("org_1", "prj_1", "q_1")).resolves.toBeUndefined();
  });

  it("desanidar algo que no estaba anidado es 404, no un éxito silencioso", async () => {
    deleteReturned = [];
    const { unlinkProjectQuote } = await import("@/server/projects/quotes");
    const err = await unlinkProjectQuote("org_1", "prj_1", "q_1").catch((e) => e);
    expect((err as ProjectError).status).toBe(404);
  });
});
