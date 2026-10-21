import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/rate-limit";
// Rutas importadas desde el principio: `vi.mock` se hoistea por encima de los
// imports, así que ya nacen con la BD y el envío falsos.
import { GET as availability } from "@/app/api/bot/availability/route";
import { POST as sendMessage } from "@/app/api/bot/messages/route";

/**
 * Las dos rutas que usa el cerebro externo también tienen que respetar los
 * interruptores de Ajustes → Agente.
 *
 *  - `GET /api/bot/availability` ESCRIBE (deja la oferta vigente por la que
 *    después se reserva). Con el canal apagado registraba huecos para una
 *    conversación que jamás iba a agendar.
 *  - `POST /api/bot/messages` manda texto al canal sin pasar por el embudo de
 *    formato del agente incluido: el párrafo amontonado llegaba igual al móvil
 *    y un texto largo reventaba contra el tope del canal sin entregar nada.
 */

const KEY = "clave-de-servicio-larga-0123456789abcdef";

const dbState = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const sends = vi.hoisted(() => [] as { text: string; conversationId: string }[]);
const offers = vi.hoisted(() => [] as { conversationId: string; count: number }[]);

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "from", "where", "limit", "orderBy"]) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(dbState.queue.shift() ?? []);
  return { ...actual, getDb: () => builder };
});

vi.mock("@/server/bot/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/bot/auth")>();
  return { ...actual, resolveInstanceOrg: async () => "org_1" };
});

vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error {},
  sendText: async (input: { conversationId: string; text: string }) => {
    sends.push({ conversationId: input.conversationId, text: input.text });
    return { messageId: "msg_1" };
  },
}));

vi.mock("@/server/agenda/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/agenda/settings")>();
  return {
    ...actual,
    getSettings: async () => actual.DEFAULT_CALENDAR_SETTINGS,
  };
});

vi.mock("@/server/agenda/availability", () => ({
  computeAvailability: async () => [],
}));

vi.mock("@/server/agenda/offers", () => ({
  replaceOffers: async (organizationId: string, conversationId: string, slots: unknown[]) => {
    offers.push({ conversationId, count: slots.length });
    return slots.length;
  },
}));

beforeEach(() => {
  vi.stubEnv("BOT_API_KEY", KEY);
  vi.stubEnv("AGENDA", "on");
  resetRateLimit();
  dbState.queue = [];
  sends.length = 0;
  offers.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

const conversation = (patch: Record<string, unknown> = {}) => ({
  id: "cv_1",
  channel: "whatsapp",
  aiEnabled: true,
  handoffAt: null,
  ...patch,
});
const profile = (disabledChannels: string[] = []) => [{ disabledChannels }];

describe("GET /api/bot/availability respeta los interruptores", () => {
  it("canal apagado → 409 y ninguna oferta registrada", async () => {
    dbState.queue = [
      [conversation({ channel: "instagram" })],
      profile(["instagram"]),
    ];
    const res = await availability(
      new Request("http://localhost/api/bot/availability?conversationId=cv_1", {
        headers: { "x-api-key": KEY },
      })
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ai_paused");
    expect(offers).toEqual([]);
  });

  it("handoff activo o IA del chat apagada → 409", async () => {
    dbState.queue = [[conversation({ handoffAt: new Date() })], profile()];
    const paused = await availability(
      new Request("http://localhost/api/bot/availability?conversationId=cv_1", {
        headers: { "x-api-key": KEY },
      })
    );
    expect(paused.status).toBe(409);

    dbState.queue = [[conversation({ aiEnabled: false })], profile()];
    const off = await availability(
      new Request("http://localhost/api/bot/availability?conversationId=cv_1", {
        headers: { "x-api-key": KEY },
      })
    );
    expect(off.status).toBe(409);
    expect(offers).toEqual([]);
  });

  it("sin API key → 401 antes de tocar la BD", async () => {
    const res = await availability(
      new Request("http://localhost/api/bot/availability?conversationId=cv_1")
    );
    expect(res.status).toBe(401);
    expect(dbState.queue).toEqual([]);
  });

  it("con todo encendido la oferta se registra", async () => {
    dbState.queue = [[conversation()], profile()];
    const res = await availability(
      new Request("http://localhost/api/bot/availability?conversationId=cv_1", {
        headers: { "x-api-key": KEY },
      })
    );
    expect(res.status).toBe(200);
    expect(offers).toEqual([{ conversationId: "cv_1", count: 0 }]);
  });
});

describe("POST /api/bot/messages sale por el mismo embudo que el agente", () => {
  function post(text: string, channel = "whatsapp"): Promise<Response> {
    dbState.queue = [[conversation({ channel })], profile()];
    return sendMessage(
      new Request("http://localhost/api/bot/messages", {
        method: "POST",
        headers: { "x-api-key": KEY, "content-type": "application/json" },
        body: JSON.stringify({ conversationId: "cv_1", text }),
      })
    );
  }

  it("un párrafo amontonado llega con renglones al canal", async () => {
    await post("**Fundas** $199   y   Cristales $149. Otra idea aquí.");
    expect(sends).toHaveLength(1);
    const sent = sends[0]!.text;
    expect(sent).not.toContain("**");
    expect(sent).not.toContain("   ");
  });

  it("Instagram no recibe más bytes de los que aguanta", async () => {
    const largo = Array.from({ length: 120 }, (_, i) => `renglon ${i} de prueba`).join("\n");
    const res = await post(largo, "instagram");
    expect(res.status).toBe(200);
    const sent = sends[0]!.text;
    expect(Buffer.byteLength(sent, "utf8")).toBeLessThanOrEqual(1000);
    expect(sent.endsWith("…")).toBe(true);
  });

  it("canal apagado → 409 y nada en el hilo", async () => {
    dbState.queue = [[conversation({ channel: "messenger" })], profile(["messenger"])];
    const res = await sendMessage(
      new Request("http://localhost/api/bot/messages", {
        method: "POST",
        headers: { "x-api-key": KEY, "content-type": "application/json" },
        body: JSON.stringify({ conversationId: "cv_1", text: "hola" }),
      })
    );
    expect(res.status).toBe(409);
    expect(sends).toEqual([]);
  });
});
