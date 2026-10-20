import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    getDb: () => ({ execute: mocks.execute }),
  };
});

import { AUTH_RATE_LIMIT, checkDistributedRateLimit } from "@/lib/rate-limit";

const NOW = new Date("2026-10-20T00:07:58.000Z");

beforeEach(() => {
  mocks.execute.mockReset();
});

describe("rate limit distribuido", () => {
  it("cuenta el resultado como arreglo (postgres.js), no como { rows }", async () => {
    mocks.execute.mockResolvedValue([{ count: 1 }]);
    await expect(
      checkDistributedRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, NOW)
    ).resolves.toEqual({ allowed: true, remaining: AUTH_RATE_LIMIT.max - 1 });
  });

  it("bloquea cuando el contador supera el máximo", async () => {
    mocks.execute.mockResolvedValue([{ count: AUTH_RATE_LIMIT.max + 1 }]);
    await expect(
      checkDistributedRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, NOW)
    ).resolves.toEqual({ allowed: false, remaining: 0 });
  });

  it("envía las fechas codificadas como texto, nunca como Date", async () => {
    mocks.execute.mockResolvedValue([{ count: 1 }]);
    await checkDistributedRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, NOW);

    const query = mocks.execute.mock.calls[0]?.[0];
    const { params } = new PgDialect().sqlToQuery(query);
    const windowStart = new Date(
      Math.floor(NOW.getTime() / AUTH_RATE_LIMIT.windowMs) * AUTH_RATE_LIMIT.windowMs
    );
    expect(params.some((value) => value instanceof Date)).toBe(false);
    expect(params).toContain(windowStart.toISOString());
  });
});
