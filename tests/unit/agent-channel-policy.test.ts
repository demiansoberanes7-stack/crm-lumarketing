import { describe, expect, it } from "vitest";
import {
  isChannelAiDisabled,
  normalizeDisabledChannels,
} from "@/server/ai/channel-policy";

/**
 * `disabledChannels` es una lista negra persistida en `agent_profile`.
 * Lo que aquí se fija: basura en la BD no debe apagar canales por accidente,
 * y el apagado es exacto (apagar TikTok no toca WhatsApp).
 */

describe("normalizeDisabledChannels", () => {
  it("trata como vacío lo que no es una lista", () => {
    expect(normalizeDisabledChannels(null)).toEqual([]);
    expect(normalizeDisabledChannels(undefined)).toEqual([]);
    expect(normalizeDisabledChannels("tiktok")).toEqual([]);
    expect(normalizeDisabledChannels({ 0: "tiktok" })).toEqual([]);
  });

  it("descarta canales desconocidos y valores que no son texto", () => {
    expect(
      normalizeDisabledChannels([
        "tiktok",
        "telegram",
        7,
        null,
        { channel: "instagram" },
      ])
    ).toEqual(["tiktok"]);
  });

  it("deduplica y ordena como la Bandeja", () => {
    expect(
      normalizeDisabledChannels([
        "mercado_libre",
        "tiktok",
        "tiktok",
        "whatsapp",
      ])
    ).toEqual(["whatsapp", "tiktok", "mercado_libre"]);
  });
});

describe("isChannelAiDisabled", () => {
  it("apaga sólo el canal exacto de la lista", () => {
    expect(isChannelAiDisabled(["tiktok"], "tiktok")).toBe(true);
    expect(isChannelAiDisabled(["tiktok"], "instagram")).toBe(false);
  });

  it("una lista ausente, vacía o corrupta no apaga nada", () => {
    expect(isChannelAiDisabled(undefined, "whatsapp")).toBe(false);
    expect(isChannelAiDisabled(null, "whatsapp")).toBe(false);
    expect(isChannelAiDisabled("whatsapp", "whatsapp")).toBe(false);
    expect(isChannelAiDisabled([], "whatsapp")).toBe(false);
  });
});
