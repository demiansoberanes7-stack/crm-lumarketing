import { describe, expect, it, vi, afterEach } from "vitest";
import { capabilitiesFor } from "@/server/channels/capabilities";
import { CHANNEL_LABEL, CHANNEL_ORDER } from "@/lib/channels";
import {
  listUnreadPacks,
  listPackMessages,
  refreshAccessToken,
  sendPackMessage,
} from "@/server/mercado-libre/client";
import { mlMessageText } from "@/server/mercado-libre/sync";
import { parseChannels } from "@/server/channels/enabled";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("canal mercado_libre", () => {
  it("está en el catálogo y en el orden de canales", () => {
    expect(CHANNEL_ORDER).toContain("mercado_libre");
    expect(CHANNEL_LABEL.mercado_libre).toBe("Mercado Libre");
  });

  it("declara capacidades sin ventana, texto de 350 y sin media/recibos", () => {
    const caps = capabilitiesFor("mercado_libre");
    expect(caps.windowMs).toBeNull();
    expect(caps.outsideWindow).toBe("none");
    expect(caps.maxTextBytes).toBe(350);
    expect(caps.outboundMedia).toBe(false);
    expect(caps.deliveryReceipts).toBe(false);
  });

  it("se enciende solo si CHANNELS lo incluye (apagado por defecto)", () => {
    expect(parseChannels(undefined).has("mercado_libre")).toBe(false);
    expect(parseChannels("").has("mercado_libre")).toBe(false);
    expect(parseChannels("whatsapp,mercado_libre").has("mercado_libre")).toBe(true);
  });
});

describe("mlMessageText", () => {
  it("usa el cuerpo del mensaje", () => {
    expect(mlMessageText({
      id: "m1",
      from: { user_id: 1, name: "Ana" },
      to: { user_id: 2, name: "Tienda" },
      text: "¿Dónde va mi pedido?",
      date: null,
      attachments: [],
    })).toBe("¿Dónde va mi pedido?");
  });

  it("marca los adjuntos cuando los hay", () => {
    const text = mlMessageText({
      id: "m2",
      from: { user_id: 1, name: null },
      to: { user_id: 2, name: null },
      text: "Adjunto la foto",
      date: null,
      attachments: ["foto.png"],
    });
    expect(text).toBe("Adjunto la foto\n\n[Adjunto: foto.png]");
  });
});

describe("cliente de Mercado Libre", () => {
  it("lista packs pendientes desde resources /packs/{id}", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          { resource: "/packs/2315686468", count: 2 },
          { resource: "/packs/999", count: 1 },
        ],
        userId: 123,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await listUnreadPacks("token");
    expect(result).toEqual({ packIds: ["2315686468", "999"] });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/marketplace/messages/unread");
  });

  it("parsea el historial de un pack y marca adjuntos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        messages: [
          {
            id: "abc123",
            from: { user_id: 523, name: "Comprador" },
            to: { user_id: 441, name: "Vendedor" },
            text: "Hola",
            message_date: { received: "2026-01-02T10:00:00Z" },
            message_attachments: [{ filename: "boleta.pdf" }],
          },
        ],
      }),
    }));
    const result = await listPackMessages("token", "999");
    expect(result).toEqual({
      messages: [
        {
          id: "abc123",
          from: { user_id: 523, name: "Comprador" },
          to: { user_id: 441, name: "Vendedor" },
          text: "Hola",
          date: "2026-01-02T10:00:00Z",
          attachments: ["boleta.pdf"],
        },
      ],
    });
  });

  it("refresca el access token y expone el refresh rotado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "nuevo",
        refresh_token: "rotado",
        expires_in: 21600,
        user_id: 523,
        site_id: "MLM",
      }),
    }));
    const result = await refreshAccessToken({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "viejo",
    });
    expect(result).toEqual({
      token: {
        accessToken: "nuevo",
        refreshToken: "rotado",
        expiresIn: 21600,
        userId: "523",
        siteId: "MLM",
      },
    });
  });

  it("marca authError en 401/403 al enviar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "expired" }),
    }));
    const result = await sendPackMessage("token", "999", "hola");
    expect(result).toEqual({ error: "expired", authError: true });
  });

  it("acepta el envío cuando la API responde 200/201", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    const result = await sendPackMessage("token", "999", "hola");
    expect(result).toEqual({ ok: true });
  });
});
