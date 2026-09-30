import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { validateWebhookUrl } from "@/server/webhooks/url";
import {
  deliverWebhook,
  dispatchWebhooks,
  publishWebhook,
} from "@/server/webhooks/dispatcher";
import { encryptSecret } from "@/lib/crypto";

/**
 * Webhooks de salida: lo que `webhook.test.ts` (capa entrante) no cubre —
 * SSRF, firma saliente, filtro de eventos, reintentos y permisos.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const calls = {
    inserts: [] as Row[],
    updates: [] as Row[],
    deletes: [] as number[],
    fetch: [] as { url: string; init: RequestInit }[],
    diagnostics: [] as Row[],
  };

  const state = {
    selectQueue: [] as unknown[][],
    selectResults: [] as unknown[][],
    updateQueue: [] as unknown[][],
    deleteQueue: [] as unknown[][],
    /** Códigos HTTP que devolverá el próximo fetch, en orden. */
    statusQueue: [] as number[],
    db: null as unknown as Record<string, unknown>,
    session: {
      userId: "usr_owner",
      organizationId: "org_1",
      role: "owner" as string,
    },
  };

  /** Cadenas estilo Drizzle (`db.select().from().where()` …) await-eables. */
  function chain(
    rows: unknown[],
    record?: { values?: (v: Row) => void; set?: (v: Row) => void }
  ) {
    // Se captura a sí mismo: los traps se disparan después de construir el
    // Proxy, así que el `const` ya existe cuando el handler lo lee.
    const proxy: unknown = new Proxy(Promise.resolve(rows), {
      get(target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const fn = Reflect.get(target, prop) as (...a: unknown[]) => unknown;
          return fn.bind(target);
        }
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        if (prop === "values" && record?.values) {
          return (v: Row) => {
            record.values?.(v);
            return proxy;
          };
        }
        if (prop === "set" && record?.set) {
          return (v: Row) => {
            record.set?.(v);
            return proxy;
          };
        }
        return () => proxy;
      },
    });
    return proxy;
  }

  const db = {
    select: () => {
      const rows =
        state.selectQueue.shift() ?? state.selectResults.shift() ?? [];
      return chain(rows);
    },
    insert: () => chain([], { values: (v) => calls.inserts.push(v) }),
    update: () => chain(state.updateQueue.shift() ?? [], { set: (v) => calls.updates.push(v) }),
    delete: () => {
      calls.deletes.push(1);
      return chain(state.deleteQueue.shift() ?? []);
    },
    execute: () => chain([]),
  };

  state.db = db;
  return { calls, state, chain, db };
});

vi.mock("@/lib/db", () => ({
  getDb: () => h.state.db,
  schema: { outboundWebhook: {}, outboundDelivery: {} },
}));

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireSession: async () => h.state.session,
    getSessionOrNull: async () => h.state.session,
  };
});

vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: async (event: Row) => {
    h.calls.diagnostics.push(event);
  },
}));

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34" }]),
}));

const fetchMock = vi.fn(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    h.calls.fetch.push({ url: String(input), init: init ?? {} });
    const status = h.state.statusQueue.shift() ?? 200;
    return new Response("ok", { status });
  }
);

beforeAll(() => {
  // getEnv() se memoiza: hay que llenar lo mínimo antes del primer uso.
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-de-test";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

beforeEach(() => {
  h.calls.inserts.length = 0;
  h.calls.updates.length = 0;
  h.calls.deletes.length = 0;
  h.calls.fetch.length = 0;
  h.calls.diagnostics.length = 0;
  h.state.selectQueue = [];
  h.state.selectResults = [];
  h.state.updateQueue = [];
  h.state.deleteQueue = [];
  h.state.statusQueue = [];
  h.state.db = h.db;
  h.state.session = { userId: "usr_owner", organizationId: "org_1", role: "owner" };
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const PUBLIC_IP = "93.184.216.34";

function webhookRow(overrides: Row = {}) {
  return {
    id: "wh_1",
    organizationId: "org_1",
    name: "Destino",
    url: `https://${PUBLIC_IP}/hook`,
    events: ["*"],
    active: true,
    secretCipher: null,
    secretIv: null,
    secretTag: null,
    maxRetries: 0,
    ...overrides,
  };
}

/* ------------------------------------------------------- URL anti-SSRF -- */

describe("validateWebhookUrl (SSRF)", () => {
  it("https a IP pública → acepta", async () => {
    await expect(
      validateWebhookUrl(`https://${PUBLIC_IP}/hook`)
    ).resolves.toBeInstanceOf(URL);
  });

  it("hostname público (DNS) → acepta", async () => {
    await expect(
      validateWebhookUrl("https://ejemplo.com/hook")
    ).resolves.toBeInstanceOf(URL);
  });

  it("http sin lista blanca → rechaza (HTTPS obligatorio)", async () => {
    await expect(
      validateWebhookUrl("http://ejemplo.com/hook")
    ).rejects.toThrow(/HTTPS/);
  });

  it("IP de metadatos de cloud → rechaza", async () => {
    await expect(
      validateWebhookUrl("https://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(/privada|metadatos/);
  });

  it("loopback y red privada → rechazan", async () => {
    await expect(validateWebhookUrl("https://127.0.0.1/h")).rejects.toThrow();
    await expect(validateWebhookUrl("https://10.1.2.3/h")).rejects.toThrow();
    await expect(validateWebhookUrl("https://192.168.1.9/h")).rejects.toThrow();
    await expect(validateWebhookUrl("https://172.16.0.1/h")).rejects.toThrow();
  });

  it("DNS que resuelve a IP privada → rechaza (rebinding)", async () => {
    const { lookup } = await import("node:dns/promises");
    vi.mocked(lookup).mockResolvedValueOnce([
      { address: "10.0.0.7" },
    ] as never);
    await expect(
      validateWebhookUrl("https://atacante.com/hook")
    ).rejects.toThrow(/privada/);
  });

  it("credenciales embebidas en la URL → rechaza", async () => {
    await expect(
      validateWebhookUrl(`https://user:pass@${PUBLIC_IP}/hook`)
    ).rejects.toThrow(/credenciales/);
  });

  it("protocolo raro → rechaza", async () => {
    await expect(validateWebhookUrl(`ftp://${PUBLIC_IP}/hook`)).rejects.toThrow(
      /http/
    );
  });

  it("host en WEBHOOK_TRUSTED_HOSTS → pasa aunque sea privado y http", async () => {
    vi.stubEnv("WEBHOOK_TRUSTED_HOSTS", "n8n.interno");
    await expect(
      validateWebhookUrl("http://n8n.interno:5678/webhook")
    ).resolves.toBeInstanceOf(URL);
    await expect(
      validateWebhookUrl("http://otro.interno/webhook")
    ).rejects.toThrow();
  });
});

/* ---------------------------------------------------------- entrega -- */

describe("deliverWebhook", () => {
  it("HTTP 200 → fila delivered y ok:true", async () => {
    const result = await deliverWebhook(
      webhookRow() as never,
      "contact.created",
      { a: 1 },
      { maxRetries: 0 }
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.attempts).toBe(1);
    expect(h.calls.updates[0]).toMatchObject({ status: "delivered", attempts: 1 });
    expect(h.calls.diagnostics).toHaveLength(0);
  });

  it("HTTP 500 → fila failed, diagnostic_event y ok:false", async () => {
    h.state.statusQueue.push(500);
    const result = await deliverWebhook(
      webhookRow() as never,
      "contact.created",
      {},
      { maxRetries: 0 }
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(h.calls.updates[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(h.calls.diagnostics[0]).toMatchObject({
      source: "webhook",
      code: "webhook_failed",
    });
  });

  it("URL que viola la política → falla sin ni siquiera hacer fetch", async () => {
    const result = await deliverWebhook(
      webhookRow({ url: "https://169.254.169.254/" }) as never,
      "contact.created",
      {},
      { maxRetries: 0 }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/privada|metadatos/);
    expect(h.calls.fetch).toHaveLength(0);
    expect(h.calls.diagnostics[0]).toMatchObject({ code: "webhook_failed" });
  });

  it("nunca sigue una redirección (redirect: manual)", async () => {
    await deliverWebhook(webhookRow() as never, "contact.created", {}, { maxRetries: 0 });
    expect(h.calls.fetch[0]?.init.redirect).toBe("manual");
  });

  it("firma el payload con HMAC-SHA256 verificable por el receptor", async () => {
    const secret = "secreto-de-prueba";
    const enc = encryptSecret(secret);

    await deliverWebhook(
      webhookRow({
        secretCipher: enc.cipher,
        secretIv: enc.iv,
        secretTag: enc.tag,
      }) as never,
      "contact.created",
      { hola: "mundo" },
      { maxRetries: 0 }
    );

    const call = h.calls.fetch[0];
    const body = String(call?.init.body);
    const headers = call?.init.headers as Record<string, string>;
    const expected = createHmac("sha256", secret)
      .update(body, "utf8")
      .digest("hex");
    expect(headers["X-Webhook-Signature"]).toBe(`sha256=${expected}`);
    expect(headers["X-Webhook-Event"]).toBe("contact.created");
    expect(headers["X-Webhook-Delivery"]).toBeTruthy();
  });
});

/* ------------------------------------------------- filtro de eventos -- */

describe("filtro de suscripción", () => {
  it("evento suscrito → entrega; no suscrito → no toca la red", async () => {
    h.state.selectQueue = [[webhookRow({ events: ["quote.created"] })]];
    await dispatchWebhooks("org_1", "contact.created", {});
    expect(h.calls.fetch).toHaveLength(0);

    h.state.selectQueue = [[webhookRow({ events: ["quote.created"] })]];
    await dispatchWebhooks("org_1", "quote.created", {});
    expect(h.calls.fetch).toHaveLength(1);
  });

  it("comodín * lo recibe todo", async () => {
    h.state.selectQueue = [[webhookRow({ events: ["*"] })]];
    await dispatchWebhooks("org_1", "message.outbound", {});
    expect(h.calls.fetch).toHaveLength(1);
  });
});

/* --------------------------------------- publishWebhook nunca revienta -- */

describe("publishWebhook", () => {
  it("es síncrono: devuelve undefined, no deja promesa rechazada y traga el fallo", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);

    h.state.selectQueue = [[webhookRow()]];
    expect(publishWebhook("org_1", "contact.created", {})).toBeUndefined();

    // Caída de BD: se come y termina en diagnóstico, no en el proceso.
    const failing = Promise.reject(new Error("bd caida"));
    failing.catch(() => {}); // ya la consume quien la va a usar
    h.state.db = {
      select: () => h.chain(failing as never),
      insert: () => h.chain([]),
      update: () => h.chain([]),
      delete: () => h.chain([]),
    };
    publishWebhook("org_1", "contact.created", {});

    await new Promise((r) => setTimeout(r, 40));
    process.off("unhandledRejection", onRejection);

    expect(rejections).toHaveLength(0);
    expect(h.calls.diagnostics.at(-1)).toMatchObject({
      code: "webhook_failed",
      source: "webhook",
    });
    h.state.db = h.db;
  });
});

/* -------------------------------------------------------- superficie -- */

describe("superficie de la API", () => {
  it("la ruta legada outbound-webhooks ya no existe", () => {
    const legacy = path.resolve(
      __dirname,
      "../../src/app/api/settings/outbound-webhooks"
    );
    expect(existsSync(legacy)).toBe(false);
  });

  it("miembro sin rol owner → 403 en el CRUD", async () => {
    const { POST } = await import("@/app/api/settings/webhooks/route");
    h.state.session = { userId: "usr_2", organizationId: "org_1", role: "member" };
    const res = await POST(
      new Request("http://x/api/settings/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: "n",
          url: `https://${PUBLIC_IP}/h`,
          events: ["contact.created"],
        }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("eventos fuera del catálogo → 422", async () => {
    const { POST } = await import("@/app/api/settings/webhooks/route");
    const res = await POST(
      new Request("http://x/api/settings/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: "n",
          url: `https://${PUBLIC_IP}/h`,
          events: ["banana.created"],
        }),
      })
    );
    expect(res.status).toBe(422);
  });

  it("URL de red interna → 422 con mensaje claro", async () => {
    const { POST } = await import("@/app/api/settings/webhooks/route");
    const res = await POST(
      new Request("http://x/api/settings/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: "n",
          url: "https://169.254.169.254/",
          events: ["contact.created"],
        }),
      })
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_url");
    expect(body.error.message).toMatch(/privada|metadatos/);
  });

  it("crear un webhook válido → 201", async () => {
    const { POST } = await import("@/app/api/settings/webhooks/route");
    const res = await POST(
      new Request("http://x/api/settings/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name: "Mi destino",
          url: `https://${PUBLIC_IP}/h`,
          events: ["contact.created", "quote.created"],
        }),
      })
    );
    expect(res.status).toBe(201);
    expect(h.calls.inserts[0]).toMatchObject({ organizationId: "org_1" });
  });

  it("DELETE no borra auditoría si no eres owner", async () => {
    const { DELETE } = await import("@/app/api/settings/webhooks/[id]/route");
    h.state.session = { userId: "usr_2", organizationId: "org_1", role: "member" };
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "wh_ajeno" }),
    });
    expect(res.status).toBe(403);
    expect(h.calls.deletes).toHaveLength(0);
  });

  it("DELETE de un id ajeno → 404 sin tocar las entregas", async () => {
    const { DELETE } = await import("@/app/api/settings/webhooks/[id]/route");
    h.state.selectQueue = [];
    const res = await DELETE(new Request("http://x"), {
      params: Promise.resolve({ id: "wh_ajeno" }),
    });
    expect(res.status).toBe(404);
    expect(h.calls.deletes).toHaveLength(0);
  });
});
