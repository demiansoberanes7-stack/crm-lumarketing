import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeOrigin,
  normalizeWebchatSettings,
  webchatSnippet,
  WEBCHAT_DEFAULT,
  WEBCHAT_KEY_PATTERN,
  type WebchatSettings,
} from "@/lib/webchat";

/**
 * Chat del sitio: es la única superficie PÚBLICA que escribe en la Bandeja, así
 * que sus guardas se prueban antes que su camino feliz. Una llave desconocida
 * no debe caer en «la primera organización», un origen fuera de la lista no
 * debe poder mandar mensajes y un cuerpo gigante no debe llegar al insert.
 */

const KEY = "wc_0123456789abcdef01234567";
const VISITOR = "abcdef0123456789";

const h = vi.hoisted(() => ({
  found: null as null | { organizationId: string; settings: WebchatSettings },
  ingested: [] as {
    organizationId: string;
    identity: { identity: string; channel: string; profileName: string | null };
    waMessageId: string;
    text: string | null;
  }[],
  agentTurns: [] as string[],
  distributed: { allowed: true },
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void> | void) => {
    void fn();
  },
}));

vi.mock("@/server/webchat/settings", () => ({
  findWebchatOrganization: async () => h.found,
}));

vi.mock("@/server/inbox/ingest", () => ({
  ingestInboundMessage: async (input: (typeof h.ingested)[number]) => {
    h.ingested.push(input);
    return { conversationId: "conv_1", messageId: "msg_1" };
  },
}));

vi.mock("@/server/ai/trigger", () => ({
  maybeRunAgentTurn: async (conversationId: string) => {
    h.agentTurns.push(conversationId);
  },
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkDistributedRateLimit: async () => h.distributed,
    checkRateLimit: () => h.distributed,
  };
});

const { GET, POST } = await import("@/app/api/webchat/[publicKey]/messages/route");
const { GET: CONFIG } = await import("@/app/api/webchat/[publicKey]/route");

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://crm.test/api/webchat/${KEY}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ publicKey: KEY }) };

function enabledSettings(overrides: Partial<WebchatSettings> = {}): WebchatSettings {
  return { ...WEBCHAT_DEFAULT, enabled: true, publicKey: KEY, ...overrides };
}

beforeEach(() => {
  h.found = { organizationId: "org_1", settings: enabledSettings() };
  h.ingested.length = 0;
  h.agentTurns.length = 0;
  h.distributed = { allowed: true };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("configuración del chat del sitio", () => {
  it("sin nada guardado usa los valores por defecto y queda apagado", () => {
    const settings = normalizeWebchatSettings(undefined);
    expect(settings.enabled).toBe(false);
    expect(settings.publicKey).toBe("");
    expect(settings.title).toBe(WEBCHAT_DEFAULT.title);
    expect(settings.welcome).toBe(WEBCHAT_DEFAULT.welcome);
  });

  it("acepta la llave del servidor y descarta cualquier otra cosa", () => {
    expect(normalizeWebchatSettings({ publicKey: KEY }).publicKey).toBe(KEY);
    // Mayúsculas se normalizan; una llave con forma rara se vacía en vez de
    // guardarse a medias (una llave inválida rompe el snippet sin avisar).
    expect(normalizeWebchatSettings({ publicKey: KEY.toUpperCase() }).publicKey).toBe(KEY);
    expect(normalizeWebchatSettings({ publicKey: "wc_zzz" }).publicKey).toBe("");
    expect(WEBCHAT_KEY_PATTERN.test(KEY)).toBe(true);
  });

  it("los orígenes se completan con https, se deduplican y se acotan a 10", () => {
    const settings = normalizeWebchatSettings({
      allowedOrigins: [
        "midominio.com",
        "HTTPS://MiDominio.com/",
        "https://otro.mx/ruta",
        "",
        "no es una url",
      ],
    });
    expect(settings.allowedOrigins).toEqual(["https://midominio.com", "https://otro.mx"]);
    const many = normalizeWebchatSettings({
      allowedOrigins: Array.from({ length: 30 }, (_, i) => `sitio${i}.com`),
    });
    expect(many.allowedOrigins).toHaveLength(10);
  });

  it("normalizeOrigin rechaza esquemas que no son http(s)", () => {
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("  ")).toBeNull();
  });

  it("el snippet apunta al script del CRM y lleva la llave en data-key", () => {
    expect(webchatSnippet("https://crm.lumarketing.digital/", KEY)).toBe(
      `<script src="https://crm.lumarketing.digital/widget/webchat.js" data-key="${KEY}" async></script>`
    );
  });
});

describe("POST público del chat: guardas", () => {
  it("una llave desconocida responde 404 y no toca la ingesta", async () => {
    h.found = null;
    const res = await POST(post({ visitorId: VISITOR, text: "hola" }), ctx);
    expect(res.status).toBe(404);
    expect(h.ingested).toHaveLength(0);
  });

  it("un chat apagado responde 404 aunque la llave exista", async () => {
    h.found = { organizationId: "org_1", settings: enabledSettings({ enabled: false }) };
    const res = await POST(post({ visitorId: VISITOR, text: "hola" }), ctx);
    expect(res.status).toBe(404);
    expect(h.ingested).toHaveLength(0);
  });

  it("un origen fuera de la lista blanca responde 403", async () => {
    h.found = {
      organizationId: "org_1",
      settings: enabledSettings({ allowedOrigins: ["https://minegocio.mx"] }),
    };
    const res = await POST(
      post({ visitorId: VISITOR, text: "hola" }, { origin: "https://otro.mx" }),
      ctx
    );
    expect(res.status).toBe(403);
    expect(h.ingested).toHaveLength(0);
  });

  it("el origen permitido sí pasa", async () => {
    h.found = {
      organizationId: "org_1",
      settings: enabledSettings({ allowedOrigins: ["https://minegocio.mx"] }),
    };
    const res = await POST(
      post({ visitorId: VISITOR, text: "hola" }, { origin: "https://minegocio.mx" }),
      ctx
    );
    expect(res.status).toBe(202);
  });

  it("un cuerpo por encima del límite responde 413 antes de parsear", async () => {
    const res = await POST(post({ visitorId: VISITOR, text: "a".repeat(9000) }), ctx);
    expect(res.status).toBe(413);
    expect(h.ingested).toHaveLength(0);
  });

  it("un JSON inválido responde 422", async () => {
    const res = await POST(post("{no es json"), ctx);
    expect(res.status).toBe(422);
  });

  it("un identificador de visitante raro responde 422", async () => {
    const res = await POST(post({ visitorId: "../../etc/passwd", text: "hola" }), ctx);
    expect(res.status).toBe(422);
    expect(h.ingested).toHaveLength(0);
  });

  it("el límite de texto es en BYTES: los acentos cuentan doble", async () => {
    // 1800 caracteres pasan el máximo de zod (2000) pero son 3600 bytes.
    const res = await POST(post({ visitorId: VISITOR, text: "é".repeat(1800) }), ctx);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "text_too_long" } });
    expect(h.ingested).toHaveLength(0);
  });

  it("si se agota el límite por visitante responde 429", async () => {
    h.distributed = { allowed: false };
    const res = await POST(post({ visitorId: VISITOR, text: "hola" }), ctx);
    expect(res.status).toBe(429);
    expect(h.ingested).toHaveLength(0);
  });
});

describe("POST público del chat: camino feliz", () => {
  it("ingesta como canal webchat con identidad propia y lanza el turno del agente", async () => {
    const res = await POST(
      post({ visitorId: VISITOR, text: "  ¿Tienen envío?  ", clientMessageId: "abc123" }),
      ctx
    );
    expect(res.status).toBe(202);

    expect(h.ingested).toHaveLength(1);
    const input = h.ingested[0]!;
    expect(input.organizationId).toBe("org_1");
    expect(input.identity).toMatchObject({
      identity: `web:${VISITOR}`,
      channel: "webchat",
      profileName: "Visitante del sitio",
    });
    // Idempotencia: el mismo clientMessageId produce el mismo wa_message_id.
    expect(input.waMessageId).toBe(`wc:${VISITOR}:abc123`);
    expect(input.text).toBe("¿Tienen envío?");

    expect(h.agentTurns).toEqual(["conv_1"]);
  });
});

describe("GET público del hilo: guardas", () => {
  it("rechaza un visitante mal formado sin consultar la base", async () => {
    const res = await GET(
      new Request(`https://crm.test/api/webchat/${KEY}/messages?visitor=x`),
      ctx
    );
    expect(res.status).toBe(422);
  });

  it("una llave desconocida responde 404", async () => {
    h.found = null;
    const res = await GET(
      new Request(`https://crm.test/api/webchat/${KEY}/messages?visitor=${VISITOR}`),
      ctx
    );
    expect(res.status).toBe(404);
  });
});

describe("config pública del widget", () => {
  it("devuelve título y bienvenida para un chat encendido", async () => {
    const res = await CONFIG(
      new Request(`https://crm.test/api/webchat/${KEY}`),
      ctx
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const data = (await res.json()) as { enabled: boolean; title: string };
    expect(data.enabled).toBe(true);
    expect(data.title).toBe(WEBCHAT_DEFAULT.title);
  });

  it("un chat apagado responde 404 para que el lanzador se retire", async () => {
    h.found = { organizationId: "org_1", settings: enabledSettings({ enabled: false }) };
    const res = await CONFIG(
      new Request(`https://crm.test/api/webchat/${KEY}`),
      ctx
    );
    expect(res.status).toBe(404);
  });
});
