import { describe, expect, it } from "vitest";
import { classifyBroadcastConversation } from "@/server/broadcasts/audience";
import { createBroadcastSchema, previewBroadcastSchema } from "@/server/broadcasts/filters";

const now = new Date("2026-10-09T12:00:00.000Z");
const whatsapp = { channel: "whatsapp" as const, provider: "meta" as const };

describe("broadcast recipient eligibility (WhatsApp)", () => {
  it("skips contacts without a real WhatsApp conversation", () => {
    expect(classifyBroadcastConversation(null, whatsapp, now)).toEqual({
      conversationId: null,
      status: "skipped",
      skipReason: "no_whatsapp_conversation",
    });
  });

  it("excludes free-form sends outside the WhatsApp 24-hour window", () => {
    expect(classifyBroadcastConversation({
      id: "cv_1",
      channel: "whatsapp",
      isTest: false,
      lastInboundAt: new Date("2026-10-08T11:59:59.999Z"),
    }, whatsapp, now)).toMatchObject({ status: "skipped", skipReason: "window_closed" });
  });

  it("queues an open WhatsApp session and keeps WAHA's no-window behavior", () => {
    const recent = {
      id: "cv_1",
      channel: "whatsapp",
      isTest: false,
      lastInboundAt: new Date("2026-10-09T11:30:00.000Z"),
    };
    expect(classifyBroadcastConversation(recent, whatsapp, now)).toMatchObject({ status: "queued", conversationId: "cv_1" });
    expect(
      classifyBroadcastConversation(
        { ...recent, lastInboundAt: null },
        { channel: "whatsapp", provider: "waha" },
        now
      )
    ).toMatchObject({ status: "queued", conversationId: "cv_1" });
  });
});

describe("broadcast recipient eligibility (un canal por campaña)", () => {
  const ig = { channel: "instagram" as const, provider: "meta" as const };

  it("una conversación de otro canal no califica para la campaña", () => {
    expect(
      classifyBroadcastConversation(
        { id: "cv_1", channel: "whatsapp", isTest: false, lastInboundAt: now },
        ig,
        now
      )
    ).toEqual({
      conversationId: null,
      status: "skipped",
      skipReason: "no_instagram_conversation",
    });
  });

  it("Instagram respeta su ventana de 24 h aunque el último entrante sea reciente para WhatsApp", () => {
    expect(
      classifyBroadcastConversation(
        {
          id: "cv_ig",
          channel: "instagram",
          isTest: false,
          lastInboundAt: new Date("2026-10-08T11:59:59.999Z"),
        },
        ig,
        now
      )
    ).toMatchObject({ status: "skipped", skipReason: "window_closed" });
  });

  it("TikTok usa su ventana de 48 h", () => {
    const tt = { channel: "tiktok" as const, provider: "meta" as const };
    const conversation = {
      id: "cv_tt",
      channel: "tiktok",
      isTest: false,
      // 36 h antes: dentro de las 48 h de TikTok, fuera de las 24 h.
      lastInboundAt: new Date("2026-10-08T00:00:00.000Z"),
    };
    expect(classifyBroadcastConversation(conversation, tt, now)).toMatchObject({ status: "queued" });
    expect(
      classifyBroadcastConversation(
        { ...conversation, lastInboundAt: new Date("2026-10-06T00:00:00.000Z") },
        tt,
        now
      )
    ).toMatchObject({ status: "skipped", skipReason: "window_closed" });
  });

  it("Messenger califica con su conversación abierta", () => {
    expect(
      classifyBroadcastConversation(
        {
          id: "cv_ms",
          channel: "messenger",
          isTest: false,
          lastInboundAt: new Date("2026-10-09T11:30:00.000Z"),
        },
        { channel: "messenger", provider: "meta" },
        now
      )
    ).toMatchObject({ status: "queued", conversationId: "cv_ms" });
  });
});

describe("payload de campaña: un canal obligatorio y válido", () => {
  it("acepta los cuatro canales de chat y rechaza el resto", () => {
    for (const channel of ["whatsapp", "instagram", "messenger", "tiktok"]) {
      const parsed = createBroadcastSchema.safeParse({
        name: "Hola",
        messageText: "Mensaje",
        channel,
        filters: {},
      });
      expect(parsed.success, channel).toBe(true);
    }
    for (const channel of ["email", "comments", "google_business", "otro"]) {
      const parsed = createBroadcastSchema.safeParse({
        name: "Hola",
        messageText: "Mensaje",
        channel,
        filters: {},
      });
      expect(parsed.success, channel).toBe(false);
    }
  });

  it("sin canal en el payload cae a WhatsApp (compatibilidad con clientes viejos)", () => {
    const parsed = createBroadcastSchema.parse({ name: "Hola", messageText: "Mensaje", filters: {} });
    expect(parsed.channel).toBe("whatsapp");
    const preview = previewBroadcastSchema.parse({ stageId: "st_1" });
    expect(preview.channel).toBe("whatsapp");
  });
});
