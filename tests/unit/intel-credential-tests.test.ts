import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as denueTest } from "@/app/api/settings/intel/denue/test/route";
import { POST as youtubeTest } from "@/app/api/settings/intel/youtube/test/route";
import { POST as serpapiTest } from "@/app/api/settings/intel/serpapi/test/route";
import { POST as apifyTest } from "@/app/api/settings/intel/apify/test/route";
import { PUT as intelPut } from "@/app/api/settings/intel/route";
import { encryptSecret } from "@/lib/crypto";

/**
 * Credenciales INTEL: los botones «Probar conexión» deben funcionar cuando la
 * UI envía el campo enmascarado (····), resolviendo el valor real desde BD, y
 * el guardado con campo vacío/enmascarado debe CONSERVAR la credencial en vez
 * de rechazarla o borrarla. Si no hay credencial guardada, el error lo dice.
 */

const h = vi.hoisted(() => {
  const state = {
    selectResult: [] as unknown[],
    updates: [] as Record<string, unknown>[],
    inserts: [] as Record<string, unknown>[],
    fetches: [] as string[],
    fetchQueue: [] as Response[],
    session: {
      userId: "usr_1",
      organizationId: "org_1",
      role: "owner" as string,
    },
  };

  function chain(
    rows: unknown[],
    record?: {
      set?: (v: Record<string, unknown>) => void;
      values?: (v: Record<string, unknown>) => void;
    }
  ) {
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
        if (prop === "values") {
          return (v: Record<string, unknown>) => {
            record?.values?.(v);
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
    update: () =>
      chain([], {
        set: (v) => state.updates.push(v),
      }),
    insert: () =>
      chain([], {
        values: (v) => state.inserts.push(v),
      }),
  };
  return { state, db };
});

vi.mock("@/lib/db", () => ({
  getDb: () => h.db,
  schema: { intelCredentials: { organizationId: "organization_id" } },
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class extends Error {},
  requireSession: async () => h.state.session,
  getSessionOrNull: async () => h.state.session,
}));

vi.mock("@/server/diagnostics/logger", () => ({
  recordDiagnostic: vi.fn(async () => {}),
}));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  h.state.fetches.push(url);
  const next = h.state.fetchQueue.shift();
  if (!next) {
    throw new Error(`fetch no preparado para: ${url}`);
  }
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
  return { cipher: e.cipher, iv: e.iv, tag: e.tag };
}

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(body: unknown): Request {
  return new Request("http://localhost/api/settings/intel", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-token-de-test";
});

beforeEach(() => {
  h.state.selectResult = [];
  h.state.updates = [];
  h.state.inserts = [];
  h.state.fetches = [];
  h.state.fetchQueue = [];
  h.state.session = {
    userId: "usr_1",
    organizationId: "org_1",
    role: "owner",
  };
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  process.env.INTEL = "on";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.INTEL;
});

describe("Probar conexión: YouTube", () => {
  it("clave enmascarada (····) usa la guardada en BD y la envía a Google", async () => {
    const e = enc("AIzaRealKey1234567890");
    h.state.selectResult = [
      {
        youtubeKeyCipher: e.cipher,
        youtubeKeyIv: e.iv,
        youtubeKeyTag: e.tag,
        status: "connected",
      },
    ];
    h.state.fetchQueue.push(resJson({ items: [] }));

    const res = await youtubeTest(
      post("http://localhost/api/settings/intel/youtube/test", {
        youtubeKey: "····Ocso",
      })
    );

    expect(res.status).toBe(200);
    expect(h.state.fetches).toHaveLength(1);
    expect(h.state.fetches[0]).toContain("key=AIzaRealKey1234567890");
    expect(h.state.fetches[0]).not.toContain("····");
    expect(h.state.updates[0]).toMatchObject({ youtubeStatus: "ok" });
  });

  it("enmascarada sin credencial guardada → 422 yt_not_saved y no hay fetch", async () => {
    const res = await youtubeTest(
      post("http://localhost/api/settings/intel/youtube/test", {
        youtubeKey: "····",
      })
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("yt_not_saved");
    expect(body.error.message).toContain("Guarda la API key");
    expect(h.state.fetches).toHaveLength(0);
  });

  it("devuelve el motivo REAL de Google (API v3 no habilitada), no el genérico", async () => {
    const e = enc("AIzaRealKey1234567890");
    h.state.selectResult = [
      { youtubeKeyCipher: e.cipher, youtubeKeyIv: e.iv, youtubeKeyTag: e.tag },
    ];
    h.state.fetchQueue.push(
      resJson(
        {
          error: {
            message:
              "YouTube Data API v3 has not been used in project 123 before or it is disabled.",
          },
        },
        400
      )
    );

    const res = await youtubeTest(
      post("http://localhost/api/settings/intel/youtube/test", {
        youtubeKey: "····Ocso",
      })
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("yt_test_failed");
    expect(body.error.message).toContain("YouTube Data API v3");
    expect(h.state.updates[0]).toMatchObject({ youtubeStatus: "error" });
  });
});

describe("Probar conexión: DENUE (INEGI)", () => {
  it("token enmascarado (····) usa el guardado en BD y consulta con él", async () => {
    const token = "denue-real-token-abc123";
    const e = enc(token);
    h.state.selectResult = [
      { denueTokenCipher: e.cipher, denueTokenIv: e.iv, denueTokenTag: e.tag },
    ];
    h.state.fetchQueue.push(resJson([{ id: 1 }, { id: 2 }, { id: 3 }]));

    const res = await denueTest(
      post("http://localhost/api/settings/intel/denue/test", {
        denueToken: "····",
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, count: 3, censored: false });
    expect(h.state.fetches[0]).toContain(`/${token}`);
    expect(h.state.fetches[0]).not.toContain("····");
    expect(h.state.updates[0]).toMatchObject({ denueStatus: "ok" });
  });

  it("enmascarada sin credencial guardada → 422 denue_not_saved", async () => {
    const res = await denueTest(
      post("http://localhost/api/settings/intel/denue/test", {
        denueToken: "····",
      })
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("denue_not_saved");
    expect(h.state.fetches).toHaveLength(0);
  });

  it("INEGI responde 200 «No autorizado» → el error trae el motivo real", async () => {
    h.state.fetchQueue.push(
      new Response("No autorizado. Utilice una clave válida.", { status: 200 })
    );

    const res = await denueTest(
      post("http://localhost/api/settings/intel/denue/test", {
        denueToken: "denue-token-malo-xyz",
      })
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("denue_test_failed");
    expect(body.error.message).toContain("No autorizado");
    expect(h.state.updates[0]).toMatchObject({ denueStatus: "error" });
  });
});

describe("Probar conexión: SerpApi", () => {
  it("key enmascarada usa la guardada en BD", async () => {
    const e = enc("serp-real-key");
    h.state.selectResult = [
      { serpapiKeyCipher: e.cipher, serpapiKeyIv: e.iv, serpapiKeyTag: e.tag },
    ];
    h.state.fetchQueue.push(
      resJson({
        interest_over_time: {
          timeline_data: [
            {
              timestamp: "1789430400",
              values: [{ query: "tecnología", value: "49", extracted_value: 49 }],
            },
          ],
        },
      })
    );

    const res = await serpapiTest(
      post("http://localhost/api/settings/intel/serpapi/test", {
        serpapiKey: "····abcd",
      })
    );

    expect(res.status).toBe(200);
    expect(h.state.fetches[0]).toContain("api_key=serp-real-key");
    expect(h.state.updates[0]).toMatchObject({ serpapiStatus: "ok" });
  });

  it("enmascarada sin credencial guardada → 422 serpapi_not_saved", async () => {
    const res = await serpapiTest(
      post("http://localhost/api/settings/intel/serpapi/test", {
        serpapiKey: "····abcd",
      })
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("serpapi_not_saved");
    expect(h.state.fetches).toHaveLength(0);
  });
});

describe("Probar conexión: Apify", () => {
  it("token enmascarado usa el guardado en BD", async () => {
    const e = enc("apify-real-token");
    h.state.selectResult = [
      { apifyTokenCipher: e.cipher, apifyTokenIv: e.iv, apifyTokenTag: e.tag },
    ];
    h.state.fetchQueue.push(resJson({ data: { id: "apify~actor" } }));

    const res = await apifyTest(
      post("http://localhost/api/settings/intel/apify/test", {
        apifyToken: "····wxyz",
        apifyActorId: "apify/google-trends-scraper",
      })
    );

    expect(res.status).toBe(200);
    expect(h.state.fetches[0]).toContain("token=apify-real-token");
    expect(h.state.updates[0]).toMatchObject({ apifyStatus: "ok" });
  });

  it("enmascarado sin credencial guardada → 422 apify_not_saved", async () => {
    const res = await apifyTest(
      post("http://localhost/api/settings/intel/apify/test", {
        apifyToken: "····wxyz",
        apifyActorId: "apify/google-trends-scraper",
      })
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("apify_not_saved");
    expect(h.state.fetches).toHaveLength(0);
  });
});

describe("Guardado de credenciales: campo vacío = conservar", () => {
  it("PUT con campos vacíos no borra ni rechaza la credencial existente", async () => {
    const e = enc("denue-token-vigente");
    h.state.selectResult = [
      { denueTokenCipher: e.cipher, denueTokenIv: e.iv, denueTokenTag: e.tag },
    ];

    const res = await intelPut(
      put({ denueToken: "", youtubeKey: "", serpapiKey: "" })
    );

    expect(res.status).toBe(200);
    const setValues = h.state.updates[0]!;
    expect(setValues).not.toHaveProperty("denueTokenCipher");
    expect(setValues).not.toHaveProperty("youtubeKeyCipher");
    expect(setValues).not.toHaveProperty("serpapiKeyCipher");
    expect(h.state.inserts).toHaveLength(0);
    expect(h.state.fetches).toHaveLength(0);
  });

  it("PUT con valor enmascarado (····) también conserva la credencial", async () => {
    const e = enc("denue-token-vigente");
    h.state.selectResult = [
      { denueTokenCipher: e.cipher, denueTokenIv: e.iv, denueTokenTag: e.tag },
    ];

    const res = await intelPut(put({ denueToken: "····" }));

    expect(res.status).toBe(200);
    expect(h.state.updates[0]).not.toHaveProperty("denueTokenCipher");
  });

  it("PUT con token nuevo lo cifra: el texto plano nunca llega a la fila", async () => {
    const e = enc("denue-token-vigente");
    h.state.selectResult = [
      { denueTokenCipher: e.cipher, denueTokenIv: e.iv, denueTokenTag: e.tag },
    ];

    const res = await intelPut(put({ denueToken: "denue-nuevo-999" }));

    expect(res.status).toBe(200);
    const setValues = h.state.updates[0]!;
    expect(setValues.denueTokenCipher).toBeTruthy();
    expect(JSON.stringify(setValues)).not.toContain("denue-nuevo-999");
  });
});
