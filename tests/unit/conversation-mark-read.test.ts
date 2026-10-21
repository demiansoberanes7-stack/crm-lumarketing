import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { updateConversation } from "@/server/inbox/queries";

/**
 * El abanico de «marcar leído».
 *
 * Un hilo de comentarios es una conversación por publicación, así que leer uno
 * limpia los demás. El guard estaba en `markRead !== undefined`, no en
 * `markRead === true`: un PATCH con `markRead: false` (lo que manda cualquier
 * cliente del API o del MCP) escribía el `updatedAt` de TODA la hilera sin
 * limpiar nada, reordenando la bandeja de un solo clic.
 */

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  getDb: mocks.getDb,
}));

let selectQueue: unknown[][] = [];
let selectCount = 0;
let sets: unknown[] = [];
let whereCalls: unknown[] = [];

function render(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never);
}

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "orderBy", "limit"]) {
    chain[method] = () => chain;
  }
  chain.where = () => chain;
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}

const conversationRow = {
  id: "cv_1",
  organizationId: "org_1",
  channel: "comments",
  unreadCount: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  selectQueue = [];
  selectCount = 0;
  sets = [];
  whereCalls = [];
  mocks.getDb.mockReturnValue({
    select: () => {
      selectCount++;
      return thenableChain(selectQueue.shift() ?? []);
    },
    update: () => ({
      set: (values: unknown) => {
        sets.push(values);
        return {
          where: (condition: unknown) => {
            whereCalls.push(condition);
            return Promise.resolve([]);
          },
        };
      },
    }),
  });
});

describe("updateConversation · marcar leído", () => {
  it("con markRead:false NO barre el hilo: actualiza solo esta conversación", async () => {
    // Con el guard viejo (`markRead !== undefined`) estas filas alcanzaban a
    // armar el hilo y el UPDATE salía con `in (cv_1, cv_2)`.
    selectQueue.push(
      [
        { id: "cv_1", identity: "fbc:author_1" },
        { id: "cv_2", identity: "fbc:post_a:author_1" },
      ],
      [conversationRow]
    );
    await updateConversation("org_1", "cv_1", { markRead: false });

    expect(selectCount).toBe(1); // solo la relectura final: nadie buscó el hilo
    expect(sets).toEqual([{ updatedAt: expect.any(Date) }]);
    const { sql: text } = render(whereCalls[0]);
    expect(text).toContain('"conversation"."id" =');
    expect(text).not.toContain("in (");
  });

  it("con markRead:true limpia también las conversaciones viejas del mismo autor", async () => {
    selectQueue.push(
      [
        { id: "cv_1", identity: "fbc:author_1" },
        { id: "cv_2", identity: "fbc:post_a:author_1" },
        { id: "cv_3", identity: "fbc:author_2" },
      ],
      [conversationRow]
    );
    await updateConversation("org_1", "cv_1", { markRead: true });

    expect(sets[0]).toEqual({
      updatedAt: expect.any(Date),
      unreadCount: 0,
    });
    const { sql: text, params } = render(whereCalls[0]);
    expect(text).toContain("in (");
    expect(params).toContain("cv_1");
    expect(params).toContain("cv_2");
    // La persona de otro comentario queda fuera.
    expect(params).not.toContain("cv_3");
  });

  it("un hilo que no es de comentarios marca solo su conversación", async () => {
    selectQueue.push([], [conversationRow]);
    await updateConversation("org_1", "cv_1", { markRead: true });

    const { sql: text } = render(whereCalls[0]);
    expect(text).not.toContain("in (");
  });

  it("apagar la IA de la conversación no barre nada", async () => {
    selectQueue.push([conversationRow]);
    await updateConversation("org_1", "cv_1", { aiEnabled: false });

    expect(sets).toEqual([{ updatedAt: expect.any(Date), aiEnabled: false }]);
    expect(render(whereCalls[0]).sql).not.toContain("in (");
  });

  it("reactivar borra el traspaso y prende la IA", async () => {
    selectQueue.push([conversationRow]);
    await updateConversation("org_1", "cv_1", { reactivate: true });

    expect(sets[0]).toEqual({
      updatedAt: expect.any(Date),
      handoffAt: null,
      handoffReason: null,
      aiEnabled: true,
    });
  });

  it("el UPDATE nunca sale sin el tenant en el WHERE", async () => {
    selectQueue.push([conversationRow]);
    await updateConversation("org_1", "cv_1", { markRead: false });
    const { sql: text, params } = render(whereCalls[0]);
    expect(text).toContain('"conversation"."organization_id"');
    expect(params).toContain("org_1");
  });
});
