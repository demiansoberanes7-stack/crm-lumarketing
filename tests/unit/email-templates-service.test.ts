import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmailTemplate,
  deleteEmailTemplate,
  EmailTemplateError,
  getEmailTemplate,
  listEmailTemplates,
} from "@/server/email-campaigns/templates";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

let listRows: unknown[] = [];
let countRows: unknown[] = [];
let detailRows: unknown[] = [];
let deletedRows: unknown[] = [];
const inserts: Record<string, unknown>[] = [];

function thenable(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const select = vi.fn((fields: Record<string, unknown>) => {
  if ("total" in fields) return thenable(countRows);
  if ("html" in fields) return thenable(detailRows);
  return thenable(listRows);
});

const insert = vi.fn(() => ({
  values: (values: Record<string, unknown>) => {
    inserts.push(values);
    return Promise.resolve();
  },
}));

const deleteFn = vi.fn(() => ({
  where: vi.fn(() => ({
    returning: vi.fn(() => Promise.resolve(deletedRows)),
  })),
}));

beforeEach(() => {
  mocks.getDb.mockReturnValue({ select, insert, delete: deleteFn });
  listRows = [];
  countRows = [];
  detailRows = [];
  deletedRows = [];
  inserts.length = 0;
  select.mockClear();
  insert.mockClear();
  deleteFn.mockClear();
});

describe("plantillas de correo", () => {
  it("lista las del negocio sin el HTML y serializa la fecha", async () => {
    listRows = [{
      id: "etpl_1",
      name: "Octubre",
      subject: "Hola {{nombre}}",
      htmlLength: "1234",
      createdAt: new Date("2026-10-22T10:00:00.000Z"),
    }];

    const [template] = await listEmailTemplates("org_1");

    expect(template).toEqual({
      id: "etpl_1",
      name: "Octubre",
      subject: "Hola {{nombre}}",
      htmlLength: 1234,
      createdAt: "2026-10-22T10:00:00.000Z",
    });
  });

  it("abre una plantilla de la organización y trata un id ajeno como inexistente", async () => {
    detailRows = [{
      id: "etpl_1",
      name: "Octubre",
      subject: "Hola",
      html: "<p>Hola {{nombre}}</p>",
      createdAt: new Date("2026-10-22T10:00:00.000Z"),
    }];

    expect(await getEmailTemplate("org_1", "etpl_1")).toMatchObject({
      html: "<p>Hola {{nombre}}</p>",
      htmlLength: "<p>Hola {{nombre}}</p>".length,
    });

    detailRows = [];
    expect(await getEmailTemplate("org_1", "etpl_de_otro")).toBeNull();
  });

  it("crea la plantilla con su negocio y autor, y devuelve la longitud", async () => {
    countRows = [{ total: 2 }];

    const created = await createEmailTemplate({
      organizationId: "org_1",
      actorUserId: "user_1",
      data: { name: "Octubre", subject: "Hola {{nombre}}", html: "<p>Hola</p>" },
    });

    expect(created).toMatchObject({
      name: "Octubre",
      subject: "Hola {{nombre}}",
      htmlLength: "<p>Hola</p>".length,
    });
    expect(created.id).toMatch(/^etpl_/);
    expect(inserts[0]).toMatchObject({
      organizationId: "org_1",
      name: "Octubre",
      subject: "Hola {{nombre}}",
      html: "<p>Hola</p>",
      createdBy: "user_1",
    });
  });

  it("no guarda más plantillas al llegar al tope", async () => {
    countRows = [{ total: 100 }];

    await expect(
      createEmailTemplate({
        organizationId: "org_1",
        actorUserId: "user_1",
        data: { name: "Octubre", subject: "Hola", html: "<p>Hola</p>" },
      })
    ).rejects.toBeInstanceOf(EmailTemplateError);
    expect(inserts).toHaveLength(0);
  });

  it("borrar devuelve si la plantilla era del negocio", async () => {
    deletedRows = [{ id: "etpl_1" }];
    expect(await deleteEmailTemplate("org_1", "etpl_1")).toBe(true);

    deletedRows = [];
    expect(await deleteEmailTemplate("org_1", "etpl_de_otro")).toBe(false);
  });
});
