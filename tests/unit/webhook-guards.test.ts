import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards de entrada de los webhooks públicos: límite de body (413) y rate
 * limit distribuido (429). El rate limit vive en PostgreSQL y aquí se mockea
 * el `execute` para simular el conteo del bucket; una caída de esa tabla debe
 * fallar ABIERTO (los webhooks legítimos no se pierden por un hipo interno).
 */

const h = vi.hoisted(() => ({
  rows: [{ count: 1 }] as Array<{ count: number }>,
  throwOnExecute: false,
  processed: [] as unknown[],
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void> | void) => {
    void fn();
  },
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({
      execute: async () => {
        if (h.throwOnExecute) throw new Error("bd caída");
        return { rows: h.rows };
      },
    }),
  };
});

vi.mock("@/server/inbox/ingest", () => ({
  processMessagesValue: async (value: unknown) => {
    h.processed.push(value);
  },
  processEchoesValue: async (value: unknown) => {
    h.processed.push(value);
  },
}));

const TOKEN = "token-de-prueba-123";

beforeAll(() => {
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");
  vi.stubEnv("BETTER_AUTH_SECRET", "secreto-de-pruebas-1234567890");
  vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", TOKEN);
});

beforeEach(() => {
  h.rows = [{ count: 1 }];
  h.throwOnExecute = false;
  h.processed.length = 0;
});

async function callPost(body: string) {
  const { POST } = await import("@/app/api/webhooks/wa/[webhookToken]/route");
  const req = new Request(`http://localhost:3000/api/webhooks/wa/${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return POST(req, { params: Promise.resolve({ webhookToken: TOKEN }) });
}

describe("rate limit distribuido en el webhook de WhatsApp", () => {
  it("con el bucket lleno responde 429 y no procesa nada", async () => {
    h.rows = [{ count: 121 }];
    const res = await callPost(JSON.stringify({ entry: [] }));
    expect(res.status).toBe(429);
    expect(h.processed).toHaveLength(0);
  });

  it("si la tabla de rate limit cae, el webhook sigue vivo (fail-open)", async () => {
    h.throwOnExecute = true;
    const res = await callPost(JSON.stringify({ entry: [] }));
    expect(res.status).toBe(200);
  });
});

describe("límite de body en el webhook de WhatsApp", () => {
  it("un body mayor a 2 MB responde 413 sin parsear", async () => {
    const res = await callPost("x".repeat(2_000_001));
    expect(res.status).toBe(413);
  });

  it("un body dentro del límite entra y se procesa", async () => {
    const res = await callPost(
      JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { id: "m1" } }] }] })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received?: boolean };
    expect(body.received).toBe(true);
    expect(h.processed).toHaveLength(1);
  });
});
