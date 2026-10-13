import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El webhook de Zernio reparte comment.received por plataforma (017): antes,
 * Messenger e Instagram descartaban ese evento en su normalizador de mensajes
 * y el comentario nunca llegaba a la Bandeja. Aquí se prueba la puerta que
 * decide si ese evento se ingiere (y con qué plataforma) sin tocar la BD.
 */
const { ingestComment, ingestMessage, messengerCreds, instagramCreds, commentsEnabled } =
  vi.hoisted(() => ({
    ingestComment: vi.fn(async () => {}),
    ingestMessage: vi.fn(async () => {}),
    messengerCreds: vi.fn(),
    instagramCreds: vi.fn(),
    commentsEnabled: { value: true },
  }));

vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: () => commentsEnabled.value,
  channelDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/comments/sync", () => ({
  ingestZernioCommentWebhook: ingestComment,
}));
vi.mock("@/server/messenger/credentials", () => ({
  getMessengerCredentialsByAccountRef: messengerCreds,
  getMessengerCredentialsByPageId: vi.fn(),
}));
vi.mock("@/server/instagram/credentials", () => ({
  getInstagramCredentialsByAccountRef: instagramCreds,
  getInstagramCredentialsByIgUserId: vi.fn(),
}));
vi.mock("@/server/inbox/ingest", () => ({
  ingestInboundMessage: ingestMessage,
}));
vi.mock("@/server/messenger/send", () => ({
  fetchMessengerProfileName: vi.fn(async () => null),
}));

import { processZernioMessengerEvent } from "@/server/messenger/ingest";
import { processZernioEvent } from "@/server/instagram/ingest";

const fbComment = {
  event: "comment.received",
  account: { id: "account_1", platform: "facebook" },
  comment: {
    id: "comment_1",
    platform: "facebook",
    platformPostId: "post_1",
    text: "Buen día",
    author: { id: "author_1", name: "Cliente" },
  },
  post: { platformPostId: "post_1", content: "Catálogo" },
};

const fbMessage = {
  event: "message.received",
  account: { id: "account_1", platform: "facebook" },
  message: {
    id: "msg_1",
    direction: "incoming",
    text: "Hola",
    sentAt: "2026-10-12T18:00:00.000Z",
    sender: { id: "psid_1", name: "Cliente" },
    conversationId: "conv_1",
  },
};

const igComment = {
  ...fbComment,
  account: { id: "ig_account", platform: "instagram" },
  comment: { ...fbComment.comment, platform: "instagram" },
};

beforeEach(() => {
  ingestComment.mockClear();
  ingestMessage.mockClear();
  messengerCreds.mockReset();
  instagramCreds.mockReset();
  commentsEnabled.value = true;
  messengerCreds.mockResolvedValue({ organizationId: "org_ms", source: "zernio" });
  instagramCreds.mockResolvedValue({ organizationId: "org_ig", source: "zernio" });
});

describe("comment.received en el canal Messenger", () => {
  it("inger el comentario de Facebook con su organización", async () => {
    await processZernioMessengerEvent(fbComment);
    expect(ingestComment).toHaveBeenCalledWith("org_ms", fbComment, "messenger");
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it("no ingiere nada si el canal de Comentarios está apagado", async () => {
    commentsEnabled.value = false;
    await processZernioMessengerEvent(fbComment);
    expect(ingestComment).not.toHaveBeenCalled();
  });

  it("no ingiere nada si la cuenta no está conectada en esta instancia", async () => {
    messengerCreds.mockResolvedValue(null);
    await processZernioMessengerEvent(fbComment);
    expect(ingestComment).not.toHaveBeenCalled();
  });

  it("no ingiere nada si la conexión es de Meta (no de Zernio)", async () => {
    messengerCreds.mockResolvedValue({ organizationId: "org_ms", source: "meta" });
    await processZernioMessengerEvent(fbComment);
    expect(ingestComment).not.toHaveBeenCalled();
  });

  it("los DMs siguen por su camino normal", async () => {
    await processZernioMessengerEvent(fbMessage);
    expect(ingestComment).not.toHaveBeenCalled();
    expect(ingestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_ms", waMessageId: "fb_msg_1" })
    );
  });
});

describe("comment.received en el canal Instagram", () => {
  it("inger el comentario con su organización", async () => {
    await processZernioEvent(igComment);
    expect(ingestComment).toHaveBeenCalledWith("org_ig", igComment, "instagram");
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it("no ingiere nada si el canal de Comentarios está apagado", async () => {
    commentsEnabled.value = false;
    await processZernioEvent(igComment);
    expect(ingestComment).not.toHaveBeenCalled();
  });

  it("los DMs siguen por su camino normal", async () => {
    await processZernioEvent({
      event: "message.received",
      account: { id: "ig_account", platform: "instagram" },
      message: {
        id: "ig_msg_1",
        direction: "incoming",
        text: "Hola",
        sentAt: "2026-10-12T18:00:00.000Z",
        sender: { id: "igsid_1", name: "Cliente" },
        conversationId: "conv_ig",
      },
    });
    expect(ingestComment).not.toHaveBeenCalled();
    expect(ingestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_ig", waMessageId: "ig_ig_msg_1" })
    );
  });
});
