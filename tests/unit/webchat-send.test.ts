import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Envío por el chat del sitio: no hay transporte externo. La respuesta queda
 * en la base (el panel del visitante la sondea) y NUNCA debe caer en el camino
 * de WhatsApp — que es lo que pasaba antes de darle su propia rama en
 * `prepareSend`: quien contestaba un chat del sitio recibía «No hay número de
 * WhatsApp conectado».
 */

process.env.APP_BASE_URL = "https://crm.test";
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
process.env.BETTER_AUTH_SECRET = "secreto-de-prueba-0123456789";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-prueba";

const state = vi.hoisted(() => ({
  selects: [] as unknown[][],
  inserts: [] as Record<string, unknown>[],
  events: [] as { type: string }[],
}));

function chain(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "where", "orderBy"]) {
    builder[method] = () => builder;
  }
  builder.limit = () => Promise.resolve(rows);
  (builder as { then: unknown }).then = (resolve: (value: unknown) => void) =>
    resolve(rows);
  return builder;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => chain(state.selects.shift() ?? []),
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          state.inserts.push(values);
          return Promise.resolve();
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }),
  };
});

vi.mock("@/server/events/bus", () => ({
  publish: (_organizationId: string, event: { type: string }) => {
    state.events.push(event);
  },
}));

vi.mock("@/server/webhooks/dispatcher", () => ({
  publishWebhook: () => undefined,
}));

const { sendText, sendStructured } = await import("@/server/inbox/send");

function webchatConversation() {
  return {
    conversation: {
      id: "cv_web",
      organizationId: "org_1",
      contactId: "ct_web",
      channel: "webchat",
      channelThreadRef: null,
      isTest: false,
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
      unreadCount: 1,
    },
    contact: {
      id: "ct_web",
      organizationId: "org_1",
      channel: "webchat",
      waIdentity: "web:abcdef0123456789",
      phone: null,
      waUserId: null,
      name: "Visitante del sitio",
    },
  };
}

function outboundPersisted() {
  return {
    id: "msg_1",
    organizationId: "org_1",
    conversationId: "cv_web",
    direction: "out",
    type: "text",
    text: "Hola, sí tenemos envío",
    status: "sent",
    createdAt: new Date(),
  };
}

beforeEach(() => {
  state.selects.length = 0;
  state.inserts.length = 0;
  state.events.length = 0;
});

describe("envío por el chat del sitio", () => {
  it("persiste la respuesta como mensaje saliente sin tocar ningún transporte", async () => {
    state.selects.push([webchatConversation()], [outboundPersisted()]);

    const result = await sendText({
      conversationId: "cv_web",
      organizationId: "org_1",
      text: "Hola, sí tenemos envío",
    });

    expect(result.messageId).toBe("msg_1");
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      conversationId: "cv_web",
      direction: "out",
      type: "text",
      text: "Hola, sí tenemos envío",
      // El chat no tiene acuses de entrega: la aceptación ES la confirmación.
      status: "sent",
      origin: "operator",
    });
    expect(state.events.map((e) => e.type)).toEqual(["message.new"]);
  });

  it("rechaza un texto por encima del tope del canal antes de persistir", async () => {
    state.selects.push([webchatConversation()]);

    await expect(
      sendText({
        conversationId: "cv_web",
        organizationId: "org_1",
        text: "é".repeat(1500),
      })
    ).rejects.toMatchObject({ code: "meta_error" });

    expect(state.inserts).toHaveLength(0);
  });

  it("no admite ubicaciones ni contactos: el panel del visitante solo pinta texto", async () => {
    state.selects.push([webchatConversation()]);

    await expect(
      sendStructured({
        conversationId: "cv_web",
        organizationId: "org_1",
        kind: "location",
        location: { latitude: 21.019, longitude: -101.257 },
      })
    ).rejects.toMatchObject({ code: "meta_error" });
  });
});
