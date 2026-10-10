import { describe, expect, it } from "vitest";
import { classifyBroadcastConversation } from "@/server/broadcasts/audience";

const now = new Date("2026-10-09T12:00:00.000Z");

describe("broadcast recipient eligibility", () => {
  it("skips contacts without a real WhatsApp conversation", () => {
    expect(classifyBroadcastConversation(null, "meta", now)).toEqual({
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
    }, "meta", now)).toMatchObject({ status: "skipped", skipReason: "window_closed" });
  });

  it("queues an open WhatsApp session and keeps WAHA's no-window behavior", () => {
    const recent = {
      id: "cv_1",
      channel: "whatsapp",
      isTest: false,
      lastInboundAt: new Date("2026-10-09T11:30:00.000Z"),
    };
    expect(classifyBroadcastConversation(recent, "meta", now)).toMatchObject({ status: "queued", conversationId: "cv_1" });
    expect(classifyBroadcastConversation({ ...recent, lastInboundAt: null }, "waha", now)).toMatchObject({ status: "queued", conversationId: "cv_1" });
  });
});
