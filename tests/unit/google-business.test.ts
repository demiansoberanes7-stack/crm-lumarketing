import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  googleBusinessDisabledResponse,
  googleBusinessEnabled,
  parseGoogleBusinessFlag,
} from "@/server/google-business/flag";
import { capabilitiesFor, textFits } from "@/server/channels/capabilities";
import { parseChannels, enabledChannels } from "@/server/channels/enabled";
import { parseStarRating } from "@/server/google-business/google-api";
import { reviewMessageText } from "@/server/google-business/sync";

describe("bandera GOOGLE_BUSINESS (ADR-001)", () => {
  it("apagada por defecto: solo los valores ON cuentan", () => {
    expect(parseGoogleBusinessFlag(undefined)).toBe(false);
    expect(parseGoogleBusinessFlag("")).toBe(false);
    expect(parseGoogleBusinessFlag("off")).toBe(false);
    expect(parseGoogleBusinessFlag("on")).toBe(true);
    expect(parseGoogleBusinessFlag(" ON ")).toBe(true);
    expect(parseGoogleBusinessFlag("sí")).toBe(true);
  });

  it("lee process.env directo, igual que AGENDA", () => {
    const original = process.env.GOOGLE_BUSINESS;
    process.env.GOOGLE_BUSINESS = "on";
    expect(googleBusinessEnabled()).toBe(true);
    process.env.GOOGLE_BUSINESS = undefined;
    expect(googleBusinessEnabled()).toBe(false);
    if (original === undefined) delete process.env.GOOGLE_BUSINESS;
    else process.env.GOOGLE_BUSINESS = original;
  });

  it("superficie apagada responde 404 y no 403", () => {
    expect(googleBusinessDisabledResponse().status).toBe(404);
  });
});

describe("canal google_business", () => {
  it("no viaja en CHANNELS: tiene bandera propia", () => {
    const on = parseChannels("whatsapp,instagram,messenger,tiktok,google_business");
    // parseChannels lo conoce (está en el catálogo), pero enabledChannels es
    // quien decide — y lo decide por GOOGLE_BUSINESS, no por CHANNELS.
    expect(on.has("google_business")).toBe(true);
  });

  it("sin ventana de 24 h, 4096 bytes, sin media, sin recibos", () => {
    const caps = capabilitiesFor("google_business");
    expect(caps.windowMs).toBeNull();
    expect(caps.maxTextBytes).toBe(4096);
    expect(caps.outboundMedia).toBe(false);
    expect(caps.deliveryReceipts).toBe(false);
  });

  it("el límite de 4096 es en bytes (Google corta por caracteres, pero no arriesgamos)", () => {
    expect(textFits("google_business", "a".repeat(4096))).toBe(true);
    expect(textFits("google_business", "a".repeat(4097))).toBe(false);
  });
});

describe("estrellas y texto de reseña", () => {
  it("normaliza el starRating de la API (ONE..FIVE)", () => {
    expect(parseStarRating("FIVE")).toBe(5);
    expect(parseStarRating("ONE")).toBe(1);
    expect(parseStarRating("banana")).toBe(0);
    expect(parseStarRating(undefined)).toBe(0);
  });

  it("el mensaje entrante lleva estrellas, nombre y comentario", () => {
    const text = reviewMessageText({
      name: "accounts/1/locations/2/reviews/3",
      reviewerName: "María",
      rating: 4,
      comment: "Muy buen servicio",
      createTime: "2026-01-01T00:00:00Z",
      updateTime: null,
      replyComment: null,
    });
    expect(text).toContain("★★★★");
    expect(text).toContain("María");
    expect(text).toContain("Muy buen servicio");
  });

  it("una reseña sin comentario muestra igual al reviewer", () => {
    const text = reviewMessageText({
      name: "accounts/1/locations/2/reviews/4",
      reviewerName: null,
      rating: 1,
      comment: null,
      createTime: "2026-01-01T00:00:00Z",
      updateTime: null,
      replyComment: null,
    });
    expect(text).toContain("★");
    expect(text).toContain("Reseña anónima");
  });
});

describe("enabledChannels con la bandera", () => {
  const ORIGINAL = { ...process.env };
  beforeAll(() => {
    // getEnv valida TODO el esquema en el primer call: el mínimo de la app.
    process.env.APP_BASE_URL ??= "http://localhost:3000";
    process.env.DATABASE_URL ??= "postgres://root:t@localhost:5432/t";
    process.env.BETTER_AUTH_SECRET ??= "secret-de-test-suficiente";
    process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
    process.env.META_WEBHOOK_VERIFY_TOKEN ??= "verify-test";
  });
  beforeEach(() => {
    process.env.CHANNELS = "instagram";
    process.env.GOOGLE_BUSINESS = "on";
  });
  afterEach(() => {
    process.env.CHANNELS = ORIGINAL.CHANNELS;
    process.env.GOOGLE_BUSINESS = ORIGINAL.GOOGLE_BUSINESS;
  });

  it("con GOOGLE_BUSINESS=on el canal se enciende aunque no esté en CHANNELS", () => {
    const on = enabledChannels();
    expect(on.has("google_business")).toBe(true);
    expect(on.has("instagram")).toBe(true);
    expect(on.has("tiktok")).toBe(false);
  });
});
