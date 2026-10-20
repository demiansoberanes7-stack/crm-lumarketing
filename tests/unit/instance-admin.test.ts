import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Servicio de administración de negocios de la instancia.
 *
 * Se prueba con un falso de Drizzle que entrega filas por cola y registra
 * escrituras. Lo que importa aquí no es el SQL exacto, sino las decisiones que
 * pueden costar datos o dejar a alguien fuera: quién puede resetear, qué se
 * revoca, qué se borra en cascada y qué cuenta sobrevive por tener otro negocio.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  removeMedia: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: mocks.getDb,
}));

vi.mock("better-auth/crypto", () => ({
  hashPassword: async (password: string) => `hash:${password}`,
  verifyPassword: async ({ hash, password }: { hash: string; password: string }) =>
    hash === `hash:${password}`,
}));

vi.mock("@/server/media-path", () => ({
  removeOrganizationMedia: mocks.removeMedia,
}));

import { schema } from "@/lib/db";
import {
  deleteInstanceOrganization,
  InstanceAdminError,
  listInstanceOrganizations,
  resetMemberPassword,
} from "@/server/auth/instance-admin";

let selectQueue: unknown[][] = [];
let inserts: { table: unknown; values: unknown }[] = [];
let updates: { table: unknown; values: unknown }[] = [];
let deletes: unknown[] = [];
let deleteReturningQueue: unknown[][] = [];

function selectChain() {
  const box: Record<string, unknown> = {};
  for (const method of [
    "from",
    "where",
    "innerJoin",
    "leftJoin",
    "groupBy",
    "orderBy",
    "limit",
    "for",
  ]) {
    box[method] = () => box;
  }
  box.then = (
    resolve: (value: unknown) => void,
    reject?: (reason: unknown) => void
  ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
  return box;
}

function fakeDb() {
  const db: Record<string, unknown> = {
    select: () => selectChain(),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          updates.push({ table, values });
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Promise.resolve([]);
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletes.push(table);
        return {
          returning: () => Promise.resolve(deleteReturningQueue.shift() ?? []),
          then: (resolve: (value: unknown) => void) =>
            Promise.resolve([]).then(resolve),
        };
      },
    }),
  };
  db.transaction = (cb: (tx: unknown) => Promise<unknown>) => cb(db);
  return db;
}

function rowsInsertedInto(table: unknown): Record<string, unknown>[] {
  const rows = inserts.filter((i) => i.table === table).map((i) => i.values);
  return rows as Record<string, unknown>[];
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  inserts = [];
  updates = [];
  deletes = [];
  deleteReturningQueue = [];
  mocks.getDb.mockImplementation(fakeDb);
  mocks.removeMedia.mockResolvedValue(true);
});

describe("listInstanceOrganizations", () => {
  it("anida cuentas, conteos y protecciones por negocio", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    selectQueue.push(
      [
        { id: "org_main", name: "Principal", slug: "principal", createdAt, members: 2 },
        { id: "org_luna", name: "Dulce Luna", slug: "honeycat", createdAt, members: 1 },
      ],
      [
        { organizationId: "org_main", userId: "u_member", name: "Dany", email: "dany@x.mx", role: "member", memberCreatedAt: createdAt },
        { organizationId: "org_main", userId: "u_owner", name: "Axel", email: "axel@x.mx", role: "owner", memberCreatedAt: createdAt },
        { organizationId: "org_luna", userId: "u_luna", name: "Luna", email: "luna@x.mx", role: "owner", memberCreatedAt: createdAt },
      ],
      [{ organizationId: "org_main", n: 4 }],
      [{ organizationId: "org_main", n: 2 }, { organizationId: "org_luna", n: 7 }],
      [{ organizationId: "org_luna", n: 1 }],
      []
    );

    const result = await listInstanceOrganizations({
      userId: "u_owner",
      organizationId: "org_main",
    });

    expect(result.viewerUserId).toBe("u_owner");
    expect(result.viewerOrganizationId).toBe("org_main");
    const main = result.organizations[0]!;
    const honey = result.organizations[1]!;
    expect(main).toMatchObject({
      id: "org_main",
      isPrincipal: true,
      canDelete: false,
      members: 2,
      stats: { contacts: 4, conversations: 2, quotes: 0, projects: 0 },
    });
    // El owner va primero aunque su membresía se haya creado después.
    expect(main.people.map((p) => p.userId)).toEqual(["u_owner", "u_member"]);
    expect(honey).toMatchObject({
      id: "org_luna",
      isPrincipal: false,
      canDelete: true,
      members: 1,
      stats: { contacts: 0, conversations: 7, quotes: 1, projects: 0 },
    });
  });
});

describe("resetMemberPassword", () => {
  const actor = { userId: "u_owner", organizationId: "org_main" };
  const input = {
    organizationId: "org_luna",
    userId: "u_luna",
    password: "nueva-clave-123",
  };

  function queueHappyPath() {
    selectQueue.push(
      [{ organizationName: "Dulce Luna", email: "luna@x.mx" }],
      [{ email: "owner@x.mx" }],
      [{ id: "mem_1" }],
      [{ id: "acc_1" }]
    );
    deleteReturningQueue.push(
      [{ id: "s1" }, { id: "s2" }],
      [{ id: "t1" }],
      []
    );
  }

  it("actualiza el hash y revoca sesiones y tokens MCP", async () => {
    queueHappyPath();

    const result = await resetMemberPassword(actor, input);

    expect(result).toEqual({
      email: "luna@x.mx",
      sessionsRevoked: 2,
      tokensRevoked: 1,
    });
    expect(JSON.stringify(result)).not.toContain("hash:");

    const accountUpdate = updates.find((u) => u.table === schema.account);
    expect(accountUpdate?.values).toMatchObject({
      password: "hash:nueva-clave-123",
    });
    expect(deletes).toEqual(
      expect.arrayContaining([
        schema.session,
        schema.mcpAccessToken,
        schema.mcpAuthorizationCode,
      ])
    );

    const audit = rowsInsertedInto(schema.instanceAdminAudit)[0]!;
    expect(audit).toMatchObject({
      action: "member.password.reset",
      actorUserId: "u_owner",
      actorEmail: "owner@x.mx",
      targetOrganizationId: "org_luna",
      targetOrganizationName: "Dulce Luna",
      targetUserId: "u_luna",
      targetUserEmail: "luna@x.mx",
    });
    expect(audit.metadata).toEqual({ sessionsRevoked: 2, tokensRevoked: 1 });
  });

  it("si no había credencial local, la crea", async () => {
    selectQueue.push(
      [{ organizationName: "Dulce Luna", email: "luna@x.mx" }],
      [{ email: "owner@x.mx" }],
      [{ id: "mem_1" }],
      []
    );
    deleteReturningQueue.push([], [], []);

    await resetMemberPassword(actor, input);

    const account = rowsInsertedInto(schema.account)[0];
    expect(account).toMatchObject({
      userId: "u_luna",
      providerId: "credential",
      accountId: "u_luna",
      password: "hash:nueva-clave-123",
    });
  });

  it("una cuenta de otro negocio no se puede tocar", async () => {
    selectQueue.push([]);

    await expect(resetMemberPassword(actor, input)).rejects.toMatchObject({
      status: 404,
      code: "member_not_found",
    });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("si la membresía desaparece antes del commit, no escribe nada", async () => {
    selectQueue.push(
      [{ organizationName: "Dulce Luna", email: "luna@x.mx" }],
      [{ email: "owner@x.mx" }],
      []
    );

    await expect(resetMemberPassword(actor, input)).rejects.toMatchObject({
      status: 404,
      code: "member_not_found",
    });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("no acepta contraseñas fuera del rango", async () => {
    await expect(
      resetMemberPassword(actor, { ...input, password: "corta" })
    ).rejects.toBeInstanceOf(InstanceAdminError);
    expect(selectQueue).toHaveLength(0);
  });
});

describe("deleteInstanceOrganization", () => {
  const actor = { userId: "u_owner", organizationId: "org_main" };
  const input = { organizationId: "org_luna", confirmName: "Dulce Luna" };

  it("borra el negocio, sus cuentas exclusivas y la media", async () => {
    selectQueue.push(
      [{ email: "owner@x.mx" }],
      [{ id: "org_luna", name: "Dulce Luna" }],
      [{ id: "org_main" }],
      [{ n: 2 }],
      [{ userId: "u_luna" }, { userId: "u_shared" }],
      [
        { userId: "u_luna", n: 1 },
        { userId: "u_shared", n: 2 },
      ],
      [{ n: 3 }],
      [{ n: 4 }],
      [{ n: 1 }],
      [{ n: 2 }]
    );

    const result = await deleteInstanceOrganization(actor, input);

    expect(result).toEqual({
      organizationName: "Dulce Luna",
      usersDeleted: 1,
      stats: {
        contacts: 3,
        conversations: 4,
        quotes: 1,
        projects: 2,
        members: 2,
      },
      mediaRemoved: true,
    });
    expect(deletes).toEqual(
      expect.arrayContaining([schema.organization, schema.user])
    );
    expect(mocks.removeMedia).toHaveBeenCalledWith("org_luna");

    const audit = rowsInsertedInto(schema.instanceAdminAudit)[0]!;
    expect(audit).toMatchObject({
      action: "organization.delete",
      targetOrganizationId: "org_luna",
      targetOrganizationName: "Dulce Luna",
    });
    expect(audit.metadata).toMatchObject({
      contacts: 3,
      conversations: 4,
      quotes: 1,
      projects: 2,
      members: 2,
      usersDeleted: 1,
    });
  });

  it("nunca borra al operador aunque sea su única membresía", async () => {
    selectQueue.push(
      [{ email: "owner@x.mx" }],
      [{ id: "org_luna", name: "Dulce Luna" }],
      [{ id: "org_main" }],
      [{ n: 2 }],
      [{ userId: "u_owner" }],
      [{ userId: "u_owner", n: 1 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }]
    );

    const result = await deleteInstanceOrganization(actor, input);
    expect(result.usersDeleted).toBe(0);
  });

  it("protege el negocio principal", async () => {
    selectQueue.push(
      [{ email: "owner@x.mx" }],
      [{ id: "org_main", name: "Principal" }],
      [{ id: "org_main" }]
    );

    await expect(
      deleteInstanceOrganization(
        { userId: "u_owner", organizationId: "org_other" },
        { organizationId: "org_main", confirmName: "Principal" }
      )
    ).rejects.toMatchObject({ status: 400, code: "principal_organization" });
    expect(deletes).toHaveLength(0);
  });

  it("protege el negocio de la sesión activa", async () => {
    selectQueue.push(
      [{ email: "owner@x.mx" }],
      [{ id: "org_main", name: "Principal" }]
    );

    await expect(
      deleteInstanceOrganization(actor, {
        organizationId: "org_main",
        confirmName: "Principal",
      })
    ).rejects.toMatchObject({ status: 400, code: "active_organization" });
    expect(deletes).toHaveLength(0);
  });

  it("exige el nombre exacto", async () => {
    selectQueue.push(
      [{ email: "owner@x.mx" }],
      [{ id: "org_luna", name: "Dulce Luna" }],
      [{ id: "org_main" }],
      [{ n: 2 }]
    );

    await expect(
      deleteInstanceOrganization(actor, {
        organizationId: "org_luna",
        confirmName: "honeycat",
      })
    ).rejects.toMatchObject({ status: 422, code: "confirm_name_mismatch" });
    expect(deletes).toHaveLength(0);
  });

  it("no permite quedarse sin ningún negocio", async () => {
    selectQueue.push(
      [{ email: "owner@x.mx" }],
      [{ id: "org_luna", name: "Dulce Luna" }],
      [{ id: "org_main" }],
      [{ n: 1 }]
    );

    await expect(deleteInstanceOrganization(actor, input)).rejects.toMatchObject({
      status: 400,
      code: "last_organization",
    });
  });
});
