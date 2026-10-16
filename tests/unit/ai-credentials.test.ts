import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  clearAiToken,
  getAiCredentialSummary,
  getAiDbToken,
  saveAiToken,
  verifyAiToken,
} from "@/server/ai/credentials";

/**
 * Clave LLM compartida (agente + copiloto): cifrado triple cipher/iv/tag,
 * prioridad de la clave guardada sobre la variable de entorno, y prueba en
 * vivo contra el proveedor sin lanzar excepciones.
 */

const h = vi.hoisted(() => {
  const state = {
    selectResult: [] as unknown[],
    updates: [] as Record<string, unknown>[],
    fetches: [] as { url: string; init?: RequestInit }[],
    fetchQueue: [] as Response[],
  };

  function chain(rows: unknown[], record?: { set?: (v: Record<string, unknown>) => void }) {
    const proxy: unknown = new Proxy(Promise.resolve(rows), {
      get(target, prop) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const fn = Reflect.get(target, prop);
          return typeof fn === "function" ? fn.bind(target) : fn;
        }
        if (prop === "set") {
          return (v: Record<string, unknown>) => {
            record?.set?.(v);
            return proxy;
          };
        }
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        return () => proxy;
      },
    });
    return proxy;
  }

  const db = {
    select: () => chain(state.selectResult),
    update: () => chain([], { set: (v) => state.updates.push(v) }),
  };
  return { state, db };
});

vi.mock("@/lib/db", () => ({
  getDb: () => h.db,
  schema: {
    agentProfile: {
      organizationId: "organization_id",
      aiToken: "ai_token",
      aiTokenCipher: "ai_token_cipher",
      aiTokenIv: "ai_token_iv",
      aiTokenTag: "ai_token_tag",
    },
  },
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  h.state.fetches.push({ url, init });
  const next = h.state.fetchQueue.shift();
  if (!next) throw new Error(`fetch no preparado para: ${url}`);
  return next;
});

function resJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function enc(plain: string) {
  const e = encryptSecret(plain);
  return { aiTokenCipher: e.cipher, aiTokenIv: e.iv, aiTokenTag: e.tag };
}

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-de-test";
  process.env.OPENROUTER_BASE_URL = "https://llm.test";
});

beforeEach(() => {
  h.state.selectResult = [];
  h.state.updates = [];
  h.state.fetches = [];
  h.state.fetchQueue = [];
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("OPENROUTER_API_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getAiDbToken", () => {
  it("descifra la clave guardada en agent_profile", async () => {
    h.state.selectResult = [enc("sk-real-key-123456")];
    expect(await getAiDbToken("org_1")).toBe("sk-real-key-123456");
  });

  it("devuelve null cuando no hay fila", async () => {
    h.state.selectResult = [];
    expect(await getAiDbToken("org_1")).toBeNull();
  });

  it("devuelve null cuando las columnas están vacías", async () => {
    h.state.selectResult = [{ aiTokenCipher: null, aiTokenIv: null, aiTokenTag: null }];
    expect(await getAiDbToken("org_1")).toBeNull();
  });

  it("devuelve null cuando el cifrado está corrupto (no lanza)", async () => {
    const e = encryptSecret("sk-otra-clave");
    h.state.selectResult = [
      { aiTokenCipher: Buffer.from("basura").toString("base64"), aiTokenIv: e.iv, aiTokenTag: e.tag },
    ];
    expect(await getAiDbToken("org_1")).toBeNull();
  });
});

describe("saveAiToken / clearAiToken", () => {
  it("guarda cifrado: el plaintext jamás llega al set()", async () => {
    h.state.selectResult = [{ aiTokenCipher: null, aiTokenIv: null, aiTokenTag: null }];
    expect(await saveAiToken("org_1", "sk-nueva-clave-123")).toBe(true);
    expect(h.state.updates).toHaveLength(1);
    const set = h.state.updates[0]!;
    expect(JSON.stringify(set)).not.toContain("sk-nueva-clave-123");
    expect(set.aiToken).toBeNull();
    const decrypted = decryptSet(set);
    expect(decrypted).toBe("sk-nueva-clave-123");
  });

  it("devuelve false (sin update) si la organización no tiene perfil", async () => {
    h.state.selectResult = [];
    expect(await saveAiToken("org_sin_perfil", "sk-nueva-clave-123")).toBe(false);
    expect(h.state.updates).toHaveLength(0);
  });

  it("clearAiToken borra las tres columnas", async () => {
    h.state.selectResult = [enc("sk-guardada-9999")];
    expect(await clearAiToken("org_1")).toBe(true);
    expect(h.state.updates).toHaveLength(1);
    expect(h.state.updates[0]).toMatchObject({
      aiTokenCipher: null,
      aiTokenIv: null,
      aiTokenTag: null,
      aiToken: null,
    });
  });
});

function decryptSet(set: Record<string, unknown>): string {
  return decryptSecret({
    cipher: String(set.aiTokenCipher),
    iv: String(set.aiTokenIv),
    tag: String(set.aiTokenTag),
  });
}

describe("getAiCredentialSummary", () => {
  it("la clave guardada (db) tiene prioridad sobre la variable de entorno", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-env-key-1111");
    h.state.selectResult = [enc("sk-db-key-9999")];
    expect(await getAiCredentialSummary("org_1")).toEqual({
      configured: true,
      source: "db",
      last4: "9999",
    });
  });

  it("si no hay clave en BD, usa la variable de entorno", async () => {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-env-key-1111");
    h.state.selectResult = [];
    expect(await getAiCredentialSummary("org_1")).toEqual({
      configured: true,
      source: "env",
      last4: "1111",
    });
  });

  it("sin clave en BD ni entorno → none", async () => {
    h.state.selectResult = [{ aiTokenCipher: null, aiTokenIv: null, aiTokenTag: null }];
    expect(await getAiCredentialSummary("org_1")).toEqual({
      configured: false,
      source: "none",
      last4: null,
    });
  });
});

describe("verifyAiToken (prueba en vivo)", () => {
  it("200 del proveedor → ok, con la clave en el header Authorization", async () => {
    h.state.fetchQueue.push(resJson({ data: [] }));
    const result = await verifyAiToken("sk-probar-123");
    expect(result).toEqual({ ok: true });
    expect(h.state.fetches).toHaveLength(1);
    expect(h.state.fetches[0]!.url).toBe("https://llm.test/v1/models");
    const headers = h.state.fetches[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-probar-123");
  });

  it("401 → ok:false con motivo legible (no lanza)", async () => {
    h.state.fetchQueue.push(resJson({ error: "bad key" }, 401));
    const result = await verifyAiToken("sk-mala");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("401");
  });

  it("500 del proveedor → ok:false con el status", async () => {
    h.state.fetchQueue.push(resJson({}, 500));
    const result = await verifyAiToken("sk-x");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("HTTP 500");
  });

  it("error de red → ok:false, nunca excepción", async () => {
    // fetchMock lanza cuando no hay respuesta en cola
    const result = await verifyAiToken("sk-x");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("No se pudo contactar");
  });
});
