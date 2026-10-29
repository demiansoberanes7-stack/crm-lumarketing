import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 017 — La entrega del webhook de Messenger, no solo la URL.
 *
 * El síntoma que originó esto: Zernio mostraba `message.received` en su panel,
 * el CRM decía «Messenger conectado» y la bandeja seguía vacía. La causa no
 * estaba en el CRM — el endpoint registrado en Zernio apuntaba a otro host, así
 * que ninguna entrega tocaba la base. Con esto el CRM pregunta a Zernio qué
 * tiene registrado, lo corrige y lo prueba.
 */

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getEnv: vi.fn(),
  isChannelEnabled: vi.fn(),
  getMessengerCredentialsByOrg: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
  getSessionOrNull: vi.fn(),
  UnauthorizedError: class extends Error {},
  getOrphanSession: vi.fn(),
}));
vi.mock("@/server/diagnostics/logger", () => ({ recordDiagnostic: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: mocks.getEnv }));
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: mocks.isChannelEnabled,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/messenger/credentials", () => ({
  getMessengerCredentialsByOrg: mocks.getMessengerCredentialsByOrg,
}));

import { GET, POST } from "@/app/api/settings/messenger/webhook/route";
import {
  deliveryState,
  isCrmWebhookUrl,
  mergeEvents,
  pickWebhookToRepair,
  sameWebhookUrl,
  type ZernioWebhook,
} from "@/server/zernio/delivery";

const EXPECTED =
  "https://crm.lumarketing.digital/api/webhooks/messenger/token-de-prueba-123456";

const OLD_HOST = "https://158.23.57.229/api/webhooks/messenger/token-de-prueba-123456";

function webhook(overrides: Partial<ZernioWebhook> = {}): ZernioWebhook {
  return {
    id: "wh_1",
    name: "Zorro Tech",
    url: EXPECTED,
    events: ["message.received"],
    isActive: true,
    failureCount: 0,
    lastFiredAt: null,
    ...overrides,
  };
}

type Call = { url: string; method: string; body: unknown; auth: string | null };

let calls: Call[] = [];
let listResponse: unknown = { webhooks: [] };
let testStatus = 200;
let logsResponse: unknown = { logs: [] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Zernio falso: solo lo que usan estas rutas. */
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  calls.push({
    url,
    method,
    body,
    auth: new Headers(init?.headers).get("authorization"),
  });

  if (url.includes("/webhooks/logs")) return json(logsResponse);

  if (url.endsWith("/webhooks/test")) {
    return testStatus >= 400
      ? json({ success: false, message: "Test webhook failed" }, testStatus)
      : json({ success: true, message: "Test webhook sent successfully" });
  }

  if (url.endsWith("/webhooks/settings")) {
    if (method === "GET") return json(listResponse);
    const created =
      method === "POST"
        ? webhook({ id: "wh_new", url: (body as { url: string }).url })
        : webhook({
            id: (body as { webhookId: string }).webhookId,
            url: (body as { url: string }).url,
            events: (body as { events: string[] }).events,
            isActive: (body as { isActive: boolean }).isActive,
          });
    return json({ success: true, webhook: { ...created, secret: "no-debe-salir" } });
  }

  return json({ error: "ruta no esperada" }, 404);
}

beforeEach(() => {
  calls = [];
  listResponse = { webhooks: [] };
  testStatus = 200;
  logsResponse = { logs: [] };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));

  mocks.getEnv.mockReturnValue({
    APP_BASE_URL: "https://crm.lumarketing.digital/",
    META_WEBHOOK_VERIFY_TOKEN: "token-de-prueba-123456",
    META_APP_SECRET: undefined,
  });
  mocks.isChannelEnabled.mockReturnValue(true);
  mocks.requireSession.mockResolvedValue({
    userId: "u1",
    organizationId: "org_1",
    role: "owner",
  });
  mocks.getMessengerCredentialsByOrg.mockResolvedValue({
    id: "cred_1",
    organizationId: "org_1",
    source: "zernio",
    pageId: null,
    pageName: "Zorro Tech",
    accountRef: "6ac84cc9d463ba5f67d3b486",
    webhookSecret: null,
    status: "connected",
    token: "sk_test_1234567890",
  });
});

describe("helpers del endpoint", () => {
  it("reconoce la URL exacta aunque cambie el espaciado", () => {
    expect(sameWebhookUrl(` ${EXPECTED} `, EXPECTED)).toBe(true);
    expect(sameWebhookUrl(OLD_HOST, EXPECTED)).toBe(false);
  });

  it("identifica un endpoint como del CRM por la ruta, no por el host", () => {
    expect(isCrmWebhookUrl(OLD_HOST)).toBe(true);
    expect(isCrmWebhookUrl("https://zernio.com/dashboard")).toBe(false);
    expect(isCrmWebhookUrl("no-es-una-url")).toBe(false);
  });

  it("corrige el endpoint viejo en vez de crear un segundo", () => {
    const old = webhook({ id: "wh_old", url: OLD_HOST });
    const other = webhook({ id: "wh_other", url: "https://otro-crm.example/api/otra-ruta" });
    expect(pickWebhookToRepair([other, old], EXPECTED)?.id).toBe("wh_old");
  });

  it("prefiere el endpoint que ya coincide exactamente", () => {
    const exact = webhook({ id: "wh_exact" });
    const old = webhook({ id: "wh_old", url: OLD_HOST });
    expect(pickWebhookToRepair([old, exact], EXPECTED)?.id).toBe("wh_exact");
  });

  it("no toca endpoints que no son del CRM", () => {
    const other = webhook({ id: "wh_other", url: "https://otro-crm.example/api/otra-ruta" });
    expect(pickWebhookToRepair([other], EXPECTED)).toBeNull();
    expect(deliveryState(null, EXPECTED)).toBe("missing");
  });

  it("no pisa eventos que el dueño ya tenía suscritos", () => {
    expect(mergeEvents(["post.published"], ["message.received", "comment.received"])).toEqual([
      "post.published",
      "message.received",
      "comment.received",
    ]);
  });

  it("distingue desactivado de apuntando a otro sitio", () => {
    expect(deliveryState(webhook({ isActive: false }), EXPECTED)).toBe("inactive");
    expect(deliveryState(webhook({ url: OLD_HOST }), EXPECTED)).toBe("wrong_url");
    expect(deliveryState(webhook(), EXPECTED)).toBe("ok");
  });
});

describe("GET /api/settings/messenger/webhook", () => {
  it("dice que el endpoint apunta a otro host, y no filtra la llave ni el secreto", async () => {
    listResponse = { webhooks: [{ ...webhook({ url: OLD_HOST }), secret: "no-debe-salir" }] };

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.state).toBe("wrong_url");
    expect(body.endpoint.url).toBe(OLD_HOST);
    expect(body.expectedUrl).toBe(EXPECTED);
    expect(JSON.stringify(body)).not.toContain("sk_test_1234567890");
    expect(JSON.stringify(body)).not.toContain("no-debe-salir");
  });

  it("no confunde un fallo de consulta con «todo bien»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "restricted key", code: "insufficient_permissions" }, 403))
    );

    const res = await GET();
    const body = await res.json();

    expect(body.checked).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.state).toBeUndefined();
  });

  it("con la configuración correcta informa el último mensaje entrante", async () => {
    listResponse = { webhooks: [webhook()] };
    logsResponse = {
      logs: [
        {
          event: "message.received",
          status: "success",
          statusCode: 200,
          attemptNumber: 1,
          createdAt: "2026-10-29T02:36:05.000Z",
        },
      ],
    };

    const body = await (await GET()).json();

    expect(body.state).toBe("ok");
    expect(body.lastInbound.status).toBe("success");
    expect(body.lastInbound.statusCode).toBe(200);
  });
});

describe("POST /api/settings/messenger/webhook", () => {
  it("corrige la URL, reactiva y prueba la entrega", async () => {
    listResponse = {
      webhooks: [
        {
          ...webhook({ id: "wh_old", url: OLD_HOST, isActive: false, failureCount: 20 }),
          secret: "no-debe-salir",
        },
      ],
    };
    logsResponse = {
      logs: [{ test: true, event: "webhook.test", status: "success", statusCode: 200 }],
    };

    const res = await POST();
    const body = await res.json();

    expect(body.repaired).toBe(true);
    expect(body.action).toBe("updated");
    expect(body.previousUrl).toBe(OLD_HOST);
    expect(body.fixed).toEqual(["url", "isActive", "events"]);
    expect(body.test.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain("sk_test_1234567890");
    expect(JSON.stringify(body)).not.toContain("no-debe-salir");

    const put = calls.find((c) => c.method === "PUT");
    expect(put?.url).toContain("/webhooks/settings");
    expect((put?.body as Record<string, unknown>).webhookId).toBe("wh_old");
    expect((put?.body as Record<string, unknown>).url).toBe(EXPECTED);
    expect((put?.body as Record<string, unknown>).isActive).toBe(true);
    expect((put?.body as Record<string, unknown>).events).toEqual([
      "message.received",
      "comment.received",
    ]);

    const test = calls.find((c) => c.url.endsWith("/webhooks/test"));
    expect((test?.body as Record<string, unknown>).webhookId).toBe("wh_old");
  });

  it("da de alta el endpoint cuando no existe, con el secreto que el CRM espera", async () => {
    mocks.getMessengerCredentialsByOrg.mockResolvedValue({
      id: "cred_1",
      organizationId: "org_1",
      source: "zernio",
      pageId: null,
      pageName: "Zorro Tech",
      accountRef: "6ac84cc9d463ba5f67d3b486",
      webhookSecret: "secreto-del-crm",
      status: "connected",
      token: "sk_test_1234567890",
    });
    logsResponse = {
      logs: [{ test: true, event: "webhook.test", status: "success", statusCode: 200 }],
    };

    const body = await (await POST()).json();

    expect(body.repaired).toBe(true);
    expect(body.action).toBe("created");
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/webhooks/settings"));
    expect((create?.body as Record<string, unknown>).url).toBe(EXPECTED);
    expect((create?.body as Record<string, unknown>).secret).toBe("secreto-del-crm");
    expect((create?.body as Record<string, unknown>).name).toContain("crm.lumarketing.digital");
  });

  it("si la entrega de prueba falla, lo dice con el código en vez de fingir éxito", async () => {
    listResponse = { webhooks: [webhook()] };
    testStatus = 500;
    logsResponse = {
      logs: [
        {
          test: true,
          event: "webhook.test",
          status: "failed",
          statusCode: 404,
          errorMessage: "Not Found",
        },
      ],
    };

    const body = await (await POST()).json();

    expect(body.repaired).toBe(true);
    expect(body.test.ok).toBe(false);
    expect(body.test.statusCode).toBe(404);
  });

  it("no llama a Zernio cuando los mensajes vienen de Meta directo", async () => {
    mocks.getMessengerCredentialsByOrg.mockResolvedValue({
      id: "cred_1",
      organizationId: "org_1",
      source: "meta",
      pageId: "123",
      pageName: null,
      accountRef: null,
      webhookSecret: null,
      status: "connected",
      token: "EAAG",
    });

    const res = await POST();

    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("si Zernio no devuelve la lista, no crea un endpoint a ciegas", async () => {
    listResponse = { ok: true };

    const body = await (await POST()).json();

    expect(body.repaired).toBe(false);
    expect(body.error).toContain("lista de webhooks");
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/webhooks/settings"))).toBe(
      false
    );
  });
});
