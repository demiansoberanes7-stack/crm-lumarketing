import { beforeEach, describe, expect, it, vi } from "vitest";

const { zernioFetch } = vi.hoisted(() => ({ zernioFetch: vi.fn() }));
vi.mock("@/server/zernio", () => ({
  zernioFetch,
  parseZernioEvent: () => null,
  zernioSentAtSeconds: (sentAt?: string) => sentAt ?? "",
  isValidZernioSignature: () => true,
  zernioSignatureFrom: () => null,
}));

import { fetchMessengerComments } from "@/server/comments/fetch";
import { parseZernioCommentEvent } from "@/server/comments/sync";
import { zernioTargetChannel } from "@/server/zernio/dispatch";

const commentEvent = (overrides: Record<string, unknown> = {}) => ({
  event: "comment.received",
  account: { id: "account_1", platform: "facebook" },
  comment: {
    id: "comment_1",
    platform: "facebook",
    platformPostId: "post_1",
    text: "¿Cuánto cuesta?",
    createdAt: "2026-10-12T18:00:00.000Z",
    isReply: false,
    parentCommentId: null,
    author: { id: "author_1", name: "Cliente" },
  },
  post: { platformPostId: "post_1", content: "Nuestro catálogo" },
  ...overrides,
});

describe("comment.received de Zernio: enrutado por plataforma", () => {
  it("reparte Facebook→messenger, Instagram→instagram, TikTok→tiktok", () => {
    expect(zernioTargetChannel(commentEvent())).toBe("messenger");
    expect(
      zernioTargetChannel(commentEvent({ account: { id: "a", platform: "instagram" } }))
    ).toBe("instagram");
    expect(
      zernioTargetChannel(commentEvent({ account: { id: "a", platform: "tiktok" } }))
    ).toBe("tiktok");
  });

  it("otras plataformas de la misma llave siguen fuera", () => {
    expect(
      zernioTargetChannel(commentEvent({ account: { id: "a", platform: "x" } }))
    ).toBeNull();
    expect(zernioTargetChannel(null)).toBeNull();
  });
});

describe("parseZernioCommentEvent (normalización pura)", () => {
  it("Facebook cae en el canal messenger con el comentario completo", () => {
    const parsed = parseZernioCommentEvent(commentEvent());
    expect(parsed?.platform).toBe("messenger");
    expect(parsed?.comment).toMatchObject({
      externalCommentId: "comment_1",
      postExternalId: "post_1",
      postCaption: "Nuestro catálogo",
      authorExternalId: "author_1",
      authorName: "Cliente",
      body: "¿Cuánto cuesta?",
      parentExternalId: null,
    });
    expect(parsed?.comment.commentTime.toISOString()).toBe("2026-10-12T18:00:00.000Z");
  });

  it("Instagram y TikTok conservan su propia plataforma", () => {
    expect(
      parseZernioCommentEvent(
        commentEvent({ comment: { ...commentEvent().comment, platform: "instagram" } })
      )?.platform
    ).toBe("instagram");
    expect(
      parseZernioCommentEvent(
        commentEvent({ comment: { ...commentEvent().comment, platform: "tiktok" } })
      )?.platform
    ).toBe("tiktok");
  });

  it("una respuesta dentro de la hebra guarda el comentario padre", () => {
    const parsed = parseZernioCommentEvent(
      commentEvent({
        comment: {
          ...commentEvent().comment,
          id: "reply_1",
          isReply: true,
          parentCommentId: "comment_1",
        },
      })
    );
    expect(parsed?.comment.parentExternalId).toBe("comment_1");
  });

  it("descarta lo que no es comentario entrante utilizable", () => {
    // El reply del negocio no es un comentario entrante.
    expect(
      parseZernioCommentEvent(
        commentEvent({
          comment: { ...commentEvent().comment, author: { id: "me", isOwnAccount: true } },
        })
      )
    ).toBeNull();
    // Sin texto, sin id, sin autor, sin post o con otro evento: nada que ingerir.
    expect(
      parseZernioCommentEvent(commentEvent({ comment: { ...commentEvent().comment, text: "  " } }))
    ).toBeNull();
    expect(
      parseZernioCommentEvent(commentEvent({ comment: { ...commentEvent().comment, id: undefined } }))
    ).toBeNull();
    expect(
      parseZernioCommentEvent(commentEvent({ comment: { ...commentEvent().comment, author: {} } }))
    ).toBeNull();
    expect(
      parseZernioCommentEvent(
        commentEvent({
          comment: { ...commentEvent().comment, platformPostId: undefined },
          post: { platformPostId: undefined, content: null },
        })
      )
    ).toBeNull();
    expect(parseZernioCommentEvent(commentEvent({ event: "message.received" }))).toBeNull();
    expect(parseZernioCommentEvent(null)).toBeNull();
  });
});

describe("comentarios de Facebook con conexión Messenger vía Zernio", () => {
  const credentials = {
    id: "cred_1",
    organizationId: "org_1",
    source: "zernio" as const,
    pageId: null,
    pageName: "Mi Página",
    accountRef: "account_1",
    webhookSecret: null,
    status: "connected" as const,
    token: "secret",
  };

  beforeEach(() => zernioFetch.mockReset());

  it("lee el hilo por el Inbox API de Zernio, no por Graph", async () => {
    zernioFetch
      .mockResolvedValueOnce({
        data: [{ id: "post_1", platform: "facebook", content: "Catálogo", commentCount: 1 }],
      })
      .mockResolvedValueOnce({
        comments: [
          {
            id: "comment_1",
            message: "¿Cuánto cuesta?",
            createdTime: "2026-10-12T18:00:00.000Z",
            from: { id: "author_1", name: "Cliente" },
            replies: [
              {
                id: "reply_1",
                message: "¿Tienen envío?",
                createdTime: "2026-10-12T18:01:00.000Z",
                from: { id: "author_2", name: "Otra persona" },
              },
            ],
          },
        ],
        pagination: { hasMore: false, cursor: null },
      });

    const result = await fetchMessengerComments(credentials);

    expect(result).toMatchObject({
      comments: [
        {
          externalCommentId: "comment_1",
          postExternalId: "post_1",
          postCaption: "Catálogo",
          authorExternalId: "author_1",
          authorName: "Cliente",
          body: "¿Cuánto cuesta?",
          parentExternalId: null,
        },
        {
          externalCommentId: "reply_1",
          authorExternalId: "author_2",
          body: "¿Tienen envío?",
          parentExternalId: "comment_1",
        },
      ],
    });
    expect(zernioFetch.mock.calls[0]?.[0]).toContain("/inbox/comments?platform=facebook");
    expect(zernioFetch.mock.calls[0]?.[0]).toContain("accountId=account_1");
    expect(zernioFetch.mock.calls[1]?.[0]).toContain("/inbox/comments/post_1?");
  });

  it("si Facebook capa los replies, pide el hilo completo con commentId", async () => {
    zernioFetch
      .mockResolvedValueOnce({
        data: [{ platformPostId: "post_1", content: "Catálogo", commentCount: 2 }],
      })
      .mockResolvedValueOnce({
        comments: [
          {
            id: "comment_1",
            message: "Hola",
            from: { id: "author_1", name: "Cliente" },
            replies: [
              { id: "reply_1", message: "Primer reply", from: { id: "a", name: "A" } },
            ],
            repliesHasMore: true,
          },
        ],
        pagination: { hasMore: false, cursor: null },
      })
      .mockResolvedValueOnce({
        comments: [
          { id: "reply_1", message: "Primer reply", from: { id: "a", name: "A" } },
          { id: "reply_2", message: "Reply capado", from: { id: "b", name: "B" } },
        ],
      });

    const result = await fetchMessengerComments(credentials);

    if ("error" in result) throw new Error(result.error);
    // El hilo completo reentrega reply_1: no debe duplicarse.
    expect(result.comments.map((c) => c.externalCommentId)).toEqual([
      "comment_1",
      "reply_1",
      "reply_2",
    ]);
    expect(zernioFetch.mock.calls[2]?.[0]).toContain("commentId=comment_1");
  });

  it("degrada con un error claro si no hay cuenta enrutable", async () => {
    const result = await fetchMessengerComments({ ...credentials, accountRef: null });
    expect(result).toEqual({
      error: "Messenger conectado vía Zernio no tiene cuenta enrutable para leer comentarios",
    });
    expect(zernioFetch).not.toHaveBeenCalled();
  });
});
