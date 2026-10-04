import { describe, expect, it } from "vitest";
import { z } from "zod";
import { randomUuid } from "../../src/lib/utils";

describe("randomUuid", () => {
  it("genera un UUID v4 válido y distinto en cada llamada", () => {
    const primero = randomUuid();
    const segundo = randomUuid();

    expect(primero).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(segundo).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(primero).not.toBe(segundo);
  });

  it("sirve como requestId: z.string().uuid() lo acepta", () => {
    expect(z.string().uuid().safeParse(randomUuid()).success).toBe(true);
  });
});
